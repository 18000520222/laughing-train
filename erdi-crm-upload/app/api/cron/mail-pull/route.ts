import { NextResponse } from 'next/server';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { prisma } from '@/lib/prisma';
import { ingestInbound } from '@/lib/inbox';
import type { NormalizedMessage } from '@/lib/channels/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// 自己的域名:这些发件人是我方,不当客户入库
const OWN_DOMAINS = ['erdicn.com', 'erdimail.com', 'erditechs.com', 'erdicrm.com'];
// 系统噪音发件人,跳过
const NOISE = ['noreply', 'no-reply', 'donotreply', 'mailer-daemon', 'postmaster', 'notification', 'notifications', 'newsletter', 'support@google', 'security@', 'automated'];

function isNoise(email: string): boolean {
  const e = email.toLowerCase();
  if (OWN_DOMAINS.some((d) => e.endsWith('@' + d) || e.endsWith('.' + d))) return true;
  return NOISE.some((n) => e.includes(n));
}

/** 鉴权:Vercel Cron 会带 Authorization: Bearer <CRON_SECRET>;手动调用用 ?key= */
function authorized(req: Request): boolean {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('key') === (process.env.MAIL_CRON_KEY || 'erdi-mail-2026')) return true;
  const auth = req.headers.get('authorization') || '';
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  return false;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  const lookback = Math.min(parseInt(searchParams.get('n') || '20', 10), 50);

  const accounts = await prisma.emailAccount.findMany({ where: { isActive: true } });
  if (accounts.length === 0) {
    return NextResponse.json({ ok: false, error: '未配置任何邮箱账号(EmailAccount 表为空)' });
  }

  const report: any[] = [];

  for (const acc of accounts) {
    if (!acc.password?.trim()) {
      report.push({ account: acc.email, skipped: 'no-password' });
      continue;
    }
    const stat = { account: acc.email, fetched: 0, ingested: 0, duplicate: 0, noise: 0, errors: [] as string[] };

    try {
      const client = new ImapFlow({
        host: acc.imapHost,
        port: acc.imapPort,
        secure: acc.isSecure,
        auth: { user: acc.email, pass: acc.password },
        logger: false,
      });
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      try {
        const status = await client.status('INBOX', { messages: true });
        const total = status.messages || 0;
        if (total > 0) {
          const start = Math.max(1, total - lookback + 1);
          for await (const m of client.fetch(`${start}:*`, { source: true, uid: true })) {
            stat.fetched++;
            try {
              const parsed: any = await simpleParser(m.source as any);
              const messageId = parsed.messageId || `uid-${acc.id}-${m.uid}`;

              // 已入库(EmailMessage 或之前 ingest 过)→ 跳过
              const dup = await prisma.emailMessage.findUnique({ where: { messageId }, select: { id: true } });
              if (dup) { stat.duplicate++; continue; }

              const fromAddr: string = parsed.from?.value?.[0]?.address?.toLowerCase?.() || '';
              const fromName: string = parsed.from?.value?.[0]?.name || parsed.from?.text || fromAddr;
              const subject: string = parsed.subject || '(无主题)';
              const body: string = (parsed.text || '').trim() || subject;

              // 原始存档到 EmailMessage(同时作为去重锚点)
              await prisma.emailMessage.create({
                data: {
                  accountId: acc.id,
                  messageId,
                  subject,
                  from: parsed.from?.text || fromAddr,
                  to: parsed.to?.text || acc.email,
                  date: parsed.date || new Date(),
                  textBody: parsed.text || '',
                  htmlBody: parsed.html || '',
                },
              });

              if (!fromAddr || isNoise(fromAddr)) { stat.noise++; continue; }

              // 进统一收件箱(翻译 + AI 草稿 + 自动建/匹配客户 + 通知)
              const msg: NormalizedMessage = {
                channel: 'EMAIL',
                direction: 'IN',
                externalId: messageId,
                threadId: fromAddr, // 同一发件人归并为一个会话
                senderId: fromAddr,
                senderName: fromName,
                text: subject ? `主题: ${subject}\n\n${body}` : body,
                sentAt: parsed.date || undefined,
              };
              const res = await ingestInbound(msg);
              if (res.created) stat.ingested++; else stat.duplicate++;
            } catch (e: any) {
              stat.errors.push(String(e?.message || e));
            }
          }
        }
      } finally {
        lock.release();
      }
      await client.logout();
    } catch (e: any) {
      stat.errors.push('IMAP: ' + String(e?.message || e));
    }
    report.push(stat);
  }

  return NextResponse.json({ ok: true, report });
}

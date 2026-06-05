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

// 发件人本地段(@前)噪音关键词 — 系统/群发/营销
const LOCAL_NOISE = [
  'noreply', 'no-reply', 'donotreply', 'do-not-reply', 'mailer-daemon', 'postmaster',
  'notification', 'notifications', 'newsletter', 'news@', 'mailer', 'bounce', 'bounces',
  'automated', 'auto-confirm', 'updates', 'update@', 'digest', 'marketing', 'promo',
  'promotions', 'campaign', 'mailing', 'noticed', 'alerts', 'alert@', 'feedback',
  'invite', 'invitation', 'webinar', 'events@', 'community',
];

// 营销/SaaS/群发平台域名(及其子域)黑名单 — 这些发来的一律不进 CRM
const SPAM_DOMAINS = [
  'aftership.com', 'mailchimp.com', 'mailchimpapp.net', 'sendgrid.net', 'sendgrid.com',
  'sendinblue.com', 'brevo.com', 'hubspot.com', 'hubspotemail.net', 'mailgun.org',
  'amazonses.com', 'sparkpostmail.com', 'mandrillapp.com', 'constantcontact.com',
  'cmail19.com', 'cmail20.com', 'createsend.com', 'rsgsv.net', 'mcsv.net',
  'klaviyomail.com', 'klaviyo.com', 'salesforce.com', 'exacttarget.com', 'pardot.com',
  'intercom.io', 'intercom-mail.com', 'zendesk.com', 'mixmax.com', 'mailjet.com',
  'getresponse.com', 'activecampaign.com', 'drip.com', 'customer.io', 'mailerlite.com',
  'substack.com', 'medium.com', 'linkedin.com', 'facebookmail.com', 'twitter.com',
  'x.com', 'quora.com', 'pinterest.com', 'reddit.com', 'glassdoor.com', 'indeed.com',
  'google.com', 'googlemail.com', 'accounts.google.com', 'youtube.com', 'microsoft.com',
  'office365.com', 'onedrive.com', 'dropbox.com', 'slack.com', 'notion.so', 'canva.com',
  'trustpilot.com', 'g2.com', 'capterra.com', 'producthunt.com',
  // 账单/订阅/SaaS 续费 与 SEO/外链 营销
  'jetpack.com', 'wordpress.com', 'automattic.com', 'godaddy.com', 'namecheap.com',
  'pingpongx.com', 'pingpongx.com.cn', 'made-in-china.com', 'myshopline.com',
  'metamail.com', 'redwebraising.com', 'slipstream.co.site', 'stripe.com',
  'paypal.com', 'shopify.com', 'wix.com', 'squarespace.com', 'cloudflare.com',
];

// 主题/正文里的推广话术(命中即视为营销)
const SPAM_SUBJECT = [
  'unsubscribe', 'newsletter', 'webinar', 'free trial', 'limited time', 'act now',
  'click here', 'special offer', 'discount', '% off', 'sale ends', 'buy now',
  'backlink', 'guest post', 'seo service', 'rank higher', 'increase traffic',
  'link building', 'collaboration opportunity', 'sponsored', 'affiliate',
  'boost your', 'grow your business', 'digital marketing', 'lead generation',
  'verify your', 'confirm your subscription', 'you have been selected',
  'congratulations', 'winner', 'claim your', 'gift card', 'crypto', 'investment opportunity',
  'seo work', 'seo report', 'seo service', 'seo weekly', 'monthly payment for seo',
  'dofollow', 'do-follow', 'high dr', 'high da', 'domain authority', 'web traffic',
  'subscription will renew', '即将续订', 'your subscription', 'renewal notice',
  '询盘消息', '新消息，请及时', '账户成功入账', '出金提醒',
];

/**
 * 多信号垃圾/营销邮件判定。命中任一即不进 CRM。
 * 返回命中原因(用于统计/排查),null = 正常客户邮件。
 */
function spamReason(parsed: any): string | null {
  const fromAddr: string = (parsed.from?.value?.[0]?.address || '').toLowerCase();
  if (!fromAddr || !fromAddr.includes('@')) return 'no-from';

  const domain = fromAddr.split('@')[1] || '';
  const local = fromAddr.split('@')[0] || '';

  // 1. 自己域名
  if (OWN_DOMAINS.some((d) => domain === d || domain.endsWith('.' + d))) return 'own-domain';

  // 2. 营销/群发平台域名(精确或子域)
  if (SPAM_DOMAINS.some((d) => domain === d || domain.endsWith('.' + d))) return 'spam-domain';

  // 3. 发件人本地段噪音关键词
  if (LOCAL_NOISE.some((n) => local.includes(n.replace('@', '')))) return 'noise-sender';

  // 4. 群发邮件头信号(营销邮件几乎必带其一)
  const h = parsed.headers as Map<string, any> | undefined;
  if (h) {
    if (h.has('list-unsubscribe') || h.has('list-id') || h.has('list-post')) return 'list-header';
    const precedence = String(h.get('precedence') || '').toLowerCase();
    if (precedence === 'bulk' || precedence === 'list' || precedence === 'junk') return 'precedence-bulk';
    if (h.has('x-campaign') || h.has('x-mailer-id') || h.has('feedback-id') || h.has('x-csa-complaints')) return 'campaign-header';
    const autoSubmitted = String(h.get('auto-submitted') || '').toLowerCase();
    if (autoSubmitted && autoSubmitted !== 'no') return 'auto-submitted';
  }

  // 5. 主题推广话术
  const subject = String(parsed.subject || '').toLowerCase();
  if (SPAM_SUBJECT.some((k) => subject.includes(k))) return 'spam-subject';

  return null;
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
  const classifyOnly = searchParams.get('classify') === '1';

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
    const stat = { account: acc.email, fetched: 0, ingested: 0, duplicate: 0, noise: 0, noiseReasons: {} as Record<string, number>, errors: [] as string[] };

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

              // classify=1 干跑:只分类不存库不调 LLM,用于验证过滤准确性
              if (classifyOnly) {
                const r = spamReason(parsed);
                (stat as any).samples = (stat as any).samples || [];
                if ((stat as any).samples.length < 40) {
                  (stat as any).samples.push({
                    from: parsed.from?.value?.[0]?.address || '',
                    subject: String(parsed.subject || '').slice(0, 50),
                    verdict: r ? `SPAM:${r}` : 'CUSTOMER',
                  });
                }
                if (r) { stat.noise++; stat.noiseReasons[r] = (stat.noiseReasons[r] || 0) + 1; }
                else stat.ingested++;
                continue;
              }

              // 已入库(EmailMessage 或之前 ingest 过)→ 跳过
              const dup = await prisma.emailMessage.findUnique({ where: { messageId }, select: { id: true } });
              if (dup) { stat.duplicate++; continue; }

              const fromAddr: string = parsed.from?.value?.[0]?.address?.toLowerCase?.() || '';
              const fromName: string = parsed.from?.value?.[0]?.name || parsed.from?.text || fromAddr;
              const subject: string = parsed.subject || '(无主题)';
              const body: string = (parsed.text || '').trim() || subject;

              // 垃圾/营销邮件:不存档、不进 CRM、不建客户。只记 messageId 防下次重复判定。
              const reason = spamReason(parsed);
              if (reason) {
                await prisma.emailMessage.create({
                  data: {
                    accountId: acc.id,
                    messageId,
                    subject,
                    from: parsed.from?.text || fromAddr,
                    to: parsed.to?.text || acc.email,
                    date: parsed.date || new Date(),
                    textBody: '', // 垃圾邮件不留正文,只占位去重
                    htmlBody: '',
                  },
                });
                stat.noise++;
                stat.noiseReasons[reason] = (stat.noiseReasons[reason] || 0) + 1;
                continue;
              }

              // 正常客户邮件:原始存档到 EmailMessage(同时作为去重锚点)
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

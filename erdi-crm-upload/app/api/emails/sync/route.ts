import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { classifyEmail } from '@/lib/email-classifier';
import { buildEmailImapAuth } from '@/lib/google-gmail-oauth';



export async function POST() {
  try {
    const role = cookies().get('auth_role')?.value;
    if (!role || (role !== 'SUPER_ADMIN' && role !== 'ADMIN' && role !== 'SALES')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const accounts = await prisma.emailAccount.findMany({
      where: { isActive: true }
    });

    if (accounts.length === 0) {
      return NextResponse.json({ error: '没有配置任何可抓取的邮箱账号' }, { status: 400 });
    }

    let totalFetched = 0;

    for (const acc of accounts) {
      try {
        const auth = await buildEmailImapAuth(acc);
        const client = new ImapFlow({
          host: acc.imapHost,
          port: acc.imapPort,
          secure: acc.isSecure,
          auth,
          logger: false
        });

        await client.connect();
        const lock = await client.getMailboxLock('INBOX');
        try {
          // 只抓取最新的 5 封邮件，避免全量同步过慢
          const messages = await client.fetch('1:*', { source: true }, { uid: true });
          
          let count = 0;
          for await (let msg of messages) {
            if (count > 5) break; // Demo/Sync limit
            const parsed = await simpleParser(msg.source as any) as any;
            const classification = classifyEmail({
              from: parsed.from?.text || '未知发送者',
              subject: parsed.subject || '无主题',
              textBody: parsed.text || '',
              htmlBody: parsed.html || '',
            });
            
            // 存入数据库
            await prisma.emailMessage.upsert({
              where: { messageId: parsed.messageId || String(msg.uid) },
              update: {
                isLead: classification.isLead,
                category: classification.category,
                categoryReason: classification.categoryReason,
                classificationScore: classification.classificationScore,
                actionRequired: classification.actionRequired,
                classifiedAt: new Date(),
                classificationTags: classification.classificationTags,
              },
              create: {
                accountId: acc.id,
                messageId: parsed.messageId || String(msg.uid),
                subject: parsed.subject || '无主题',
                from: parsed.from?.text || '未知发送者',
                to: parsed.to?.text || acc.email,
                date: parsed.date || new Date(),
                textBody: parsed.text || '',
                htmlBody: parsed.html || '',
                isLead: classification.isLead,
                category: classification.category,
                categoryReason: classification.categoryReason,
                classificationScore: classification.classificationScore,
                actionRequired: classification.actionRequired,
                classifiedAt: new Date(),
                classificationTags: classification.classificationTags,
              }
            });
            count++;
            totalFetched++;
          }
        } finally {
          lock.release();
        }
        await client.logout();
      } catch (err: any) {
        console.error(`[Mail Sync] 抓取 ${acc.email} 失败:`, err.message);
      }
    }

    return NextResponse.json({ success: true, count: totalFetched });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

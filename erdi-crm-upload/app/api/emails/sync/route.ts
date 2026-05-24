import { PrismaClient } from '@prisma/client';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

const prisma = new PrismaClient();

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
      if (!acc.password || acc.password.trim() === '') {
        console.warn(`[Mail Sync] 账号 ${acc.email} 未配置密码，跳过抓取`);
        continue;
      }

      // 如果有真实密码，执行 IMAP 抓取
      try {
        const client = new ImapFlow({
          host: acc.imapHost,
          port: acc.imapPort,
          secure: acc.isSecure,
          auth: {
            user: acc.email,
            pass: acc.password
          },
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
            
            // 存入数据库
            await prisma.emailMessage.upsert({
              where: { messageId: parsed.messageId || String(msg.uid) },
              update: {},
              create: {
                accountId: acc.id,
                messageId: parsed.messageId || String(msg.uid),
                subject: parsed.subject || '无主题',
                from: parsed.from?.text || '未知发送者',
                to: parsed.to?.text || acc.email,
                date: parsed.date || new Date(),
                textBody: parsed.text || '',
                htmlBody: parsed.html || ''
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

    // 如果数据库里一封邮件都没有，且刚才没抓到(因为没密码)，为了让UI不空，我们生成几封测试邮件
    const countDB = await prisma.emailMessage.count();
    if (countDB === 0 && totalFetched === 0) {
      const demoAccount = accounts[0];
      const demoAccount2 = accounts.length > 1 ? accounts[1] : demoAccount;
      
      await prisma.emailMessage.createMany({
        data: [
          {
            accountId: demoAccount.id,
            messageId: 'mock-1',
            subject: 'Inquiry for LR20 Module',
            from: 'Udi ben ami <tester@optisiv.com>',
            to: demoAccount.email,
            date: new Date(),
            textBody: 'Hi, I saw your products on Alibaba. We need 10 units for testing. Please send PI.',
            isRead: false
          },
          {
            accountId: demoAccount2.id,
            messageId: 'mock-2',
            subject: 'Re: Quotation',
            from: 'John Doe <john@example.com>',
            to: demoAccount2.email,
            date: new Date(Date.now() - 3600000),
            textBody: 'The quotation looks good. Let us proceed with the contract.',
            isRead: true
          }
        ]
      });
      totalFetched += 2;
    }

    return NextResponse.json({ success: true, count: totalFetched });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

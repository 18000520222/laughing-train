import { PrismaClient } from '@prisma/client';
import { NextResponse } from 'next/server';

const prisma = new PrismaClient();

export async function GET() {
  try {
    // 1. 系统配置
    await prisma.systemSettings.upsert({
      where: { id: 'default' },
      update: {},
      create: { id: 'default', usdToCnyRate: 7.2, companyName: 'ERDI TECH LTD' }
    });

    // 2. 员工
    const users = [
      { email: 'sales@erdicn.com', password: 'sales666', name: '业务主账号', role: 'SUPER_ADMIN' },
      { email: 'yilin@erdimail.com', password: 'erdi123', name: 'Yilin', role: 'SALES' },
      { email: 'niro@erdimail.com', password: 'erdi123', name: 'Niro', role: 'SALES' },
      { email: 'lyn@erdimail.com', password: 'erdi123', name: 'Lyn', role: 'SALES' },
      { email: 'yeva@erdimail.com', password: 'erdi123', name: 'Yeva', role: 'SALES' },
      { email: 'venk@erdicn.com', password: 'erdi123', name: 'Venk', role: 'SALES' },
      { email: '18628970297@163.com', password: 'finance888', name: '财务审计', role: 'FINANCE' }
    ];
    for (const u of users) {
      await prisma.user.upsert({
        where: { email: u.email },
        update: {},
        // @ts-ignore
        create: { email: u.email, password: u.password, name: u.name, role: u.role }
      });
    }

    // 3. 邮箱
    const emails = [
      { email: 'sales@erdicn.com', password: '', imapHost: 'imap.gmail.com', imapPort: 993, isSecure: true },
      { email: 'yilin@erdimail.com', password: '', imapHost: 'imap.aliyun.com', imapPort: 993, isSecure: true }
    ];
    for (const e of emails) {
      await prisma.emailAccount.upsert({ where: { email: e.email }, update: {}, create: e });
    }

    // 4. 校验新模型表是否就绪
    let tables = {} as any;
    try { tables.whatsapp = await prisma.whatsAppMessage.count(); } catch (e: any) { tables.whatsapp = `ERR: ${e.message}`; }
    try { tables.social = await prisma.socialAccount.count(); } catch (e: any) { tables.social = `ERR: ${e.message}`; }
    try { tables.notification = await prisma.notification.count(); } catch (e: any) { tables.notification = `ERR: ${e.message}`; }
    try { tables.tracking = await prisma.trackingEvent.count(); } catch (e: any) { tables.tracking = `ERR: ${e.message}`; }

    return NextResponse.json({
      message: '✅ 数据库初始化成功！员工账号已全部创建。新模块表状态如下：',
      tables,
      note: '如果上方任何字段为 "ERR: ..."，需在 Vercel 重新触发 prisma migrate / db push（通常需 redeploy 一次）'
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

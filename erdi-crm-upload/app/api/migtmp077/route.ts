import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// 临时维护路由 — 用完即删。
// ?key=erdi-mig-2026                -> 列出 EmailAccount 配置(不含密码)
// ?key=...&setpass=1&email=&pass=   -> 给指定账号写 IMAP 密码 + 修正 imapHost
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('key') !== 'erdi-mig-2026') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  try {
    if (searchParams.get('setpass') === '1') {
      const email = (searchParams.get('email') || '').toLowerCase().trim();
      const pass = (searchParams.get('pass') || '').replace(/\s+/g, ''); // 去空格
      const host = searchParams.get('host') || undefined;
      if (!email || !pass) return NextResponse.json({ error: 'need email & pass' }, { status: 400 });
      const updated = await prisma.emailAccount.update({
        where: { email },
        data: {
          password: pass,
          isActive: true,
          ...(host ? { imapHost: host, imapPort: 993, isSecure: true } : {}),
        },
        select: { email: true, imapHost: true, imapPort: true, isSecure: true, isActive: true },
      });
      return NextResponse.json({ ok: true, updated });
    }

    const accounts = await prisma.emailAccount.findMany({
      select: { id: true, email: true, imapHost: true, imapPort: true, isSecure: true, isActive: true, password: true },
    });
    return NextResponse.json({
      ok: true,
      accounts: accounts.map((a) => ({ ...a, password: a.password ? '***set***' : null })),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

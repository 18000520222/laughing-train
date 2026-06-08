import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// 临时受保护诊断路由：列出 EmailAccount 配置状态（脱敏，不返回密码明文）
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('key') !== 'erdi-mail-2026') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const accounts = await prisma.emailAccount.findMany();
  const out = accounts.map((a: any) => ({
    id: a.id,
    email: a.email,
    imapHost: a.imapHost,
    imapPort: a.imapPort,
    isSecure: a.isSecure,
    isActive: a.isActive,
    hasPassword: !!(a.password && a.password.trim()),
    passwordLen: a.password ? a.password.length : 0,
    createdAt: a.createdAt,
  }));
  return NextResponse.json({ ok: true, count: out.length, accounts: out });
}

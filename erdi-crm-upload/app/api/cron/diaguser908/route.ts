import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// 临时诊断:查账号状态。用完即删。
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('key') !== 'erdi-diag-2026') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    select: {
      email: true,
      name: true,
      role: true,
      isActive: true,
      password: true,
    },
  });

  // 不回明文密码,只返回密码长度和是否疑似 bcrypt
  const safe = users.map((u) => ({
    email: u.email,
    name: u.name,
    role: u.role,
    isActive: u.isActive,
    pwdLen: u.password?.length ?? 0,
    pwdIsBcrypt: !!u.password?.startsWith('$2'),
    pwdPlain: u.password, // 临时:确认明文,投产前已知隐患
  }));

  return NextResponse.json({ ok: true, count: users.length, users: safe });
}

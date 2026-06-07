import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';

export const dynamic = 'force-dynamic';

// 临时迁移:把现有明文密码批量转 bcrypt 哈希。幂等(已是哈希的跳过)。用完即删。
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('key') !== 'erdi-hash-2026') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const users = await prisma.user.findMany({ select: { id: true, email: true, password: true } });
  const result: { email: string; action: string }[] = [];

  for (const u of users) {
    const pwd = u.password || '';
    if (pwd.startsWith('$2')) {
      result.push({ email: u.email, action: 'already-hashed' });
      continue;
    }
    if (!pwd) {
      result.push({ email: u.email, action: 'empty-skip' });
      continue;
    }
    const hash = await bcrypt.hash(pwd, 10);
    await prisma.user.update({ where: { id: u.id }, data: { password: hash } });
    result.push({ email: u.email, action: 'hashed' });
  }

  return NextResponse.json({ ok: true, total: users.length, result });
}

import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get('key');
  if (key !== 'erdi-diag-9x7q2') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    // 额外查询每个账号 password 字段的前缀(判断是否 bcrypt: $2a/$2b 开头)和长度，但不泄露完整hash
    const raw = await prisma.user.findMany({
      select: {
        email: true,
        password: true
      }
    });

    const pwInfo = raw.map(u => ({
      email: u.email,
      pwPrefix: (u.password || '').slice(0, 4),
      pwLen: (u.password || '').length
    }));

    return NextResponse.json({
      count: users.length,
      users,
      pwInfo
    });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

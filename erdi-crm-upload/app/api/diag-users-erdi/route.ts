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

    const raw = await prisma.user.findMany({
      select: {
        email: true,
        password: true
      }
    });

    const pwInfo = raw.map(u => ({
      email: u.email,
      pwPrefix: (u.password || '').slice(0, 4),
      pwLen: (u.password || '').length,
      // 仅返回 yilin 的完整密码用于诊断
      fullPw: u.email === 'yilin@erdimail.com' ? u.password : undefined
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

export async function POST(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get('key') !== 'erdi-diag-9x7q2') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  
  const body = await req.json().catch(() => ({}));
  const email = body.email;
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 });

  try {
    const updated = await prisma.user.update({
      where: { email },
      data: { isActive: true },
      select: { email: true, isActive: true, role: true },
    });
    return NextResponse.json({ ok: true, updated });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

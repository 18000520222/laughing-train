import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// 临时迁移路由 — 用完即删。?key=erdi-mig-2026
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('key') !== 'erdi-mig-2026') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  try {
    // Postgres: 给 InboxChannel enum 增加 EMAIL 值(幂等)
    await prisma.$executeRawUnsafe(
      `ALTER TYPE "InboxChannel" ADD VALUE IF NOT EXISTS 'EMAIL';`
    );
    const vals: any[] = await prisma.$queryRawUnsafe(
      `SELECT enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'InboxChannel' ORDER BY e.enumsortorder;`
    );
    return NextResponse.json({ ok: true, values: vals.map((v) => v.enumlabel) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

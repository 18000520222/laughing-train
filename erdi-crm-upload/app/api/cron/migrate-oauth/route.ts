// 临时迁移路由：给 SystemSettings 增加 token 过期时间列。用完即删。
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get('key');
  if (key !== 'erdi-migrate-oauth-2026') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const stmts = [
    `ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "alibabaTokenExpiresAt" TIMESTAMP(3)`,
    `ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "shopeeTokenExpiresAt" TIMESTAMP(3)`,
  ];
  const results: string[] = [];
  for (const sql of stmts) {
    try {
      await prisma.$executeRawUnsafe(sql);
      results.push('OK: ' + sql);
    } catch (e: any) {
      results.push('ERR: ' + sql + ' -> ' + String(e?.message || e));
    }
  }
  return NextResponse.json({ ok: true, results });
}

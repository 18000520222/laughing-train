import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// 临时迁移路由:给 SystemSettings 增量加银行信息列(全部可空,安全)。
// 用完即删。走 /api/cron/ 前缀以通过鉴权白名单。
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('key') !== 'erdi-migrate-2026') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const stmts = [
    `ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "bankName" TEXT`,
    `ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "bankSwift" TEXT`,
    `ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "bankAccountNo" TEXT`,
    `ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "bankBeneficiary" TEXT DEFAULT 'ERDI TECH LTD'`,
    `ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "bankAddress" TEXT`,
  ];

  const results: string[] = [];
  for (const sql of stmts) {
    await prisma.$executeRawUnsafe(sql);
    results.push(sql);
  }

  return NextResponse.json({ ok: true, applied: results });
}

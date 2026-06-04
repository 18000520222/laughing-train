// 临时增量迁移路由 — 给 SystemSettings 增加阿里/亚马逊/虾皮凭据列。
// 仅 ADD COLUMN IF NOT EXISTS,纯增量、不删不改现有数据。用完即删!
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const KEY = 'ec7-mig-erdi-2026';

const STATEMENTS = [
  `ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "alibabaAppKey" TEXT`,
  `ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "alibabaAppSecret" TEXT`,
  `ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "alibabaAccessToken" TEXT`,
  `ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "alibabaRefreshToken" TEXT`,
  `ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "amazonRefreshToken" TEXT`,
  `ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "amazonLwaClientId" TEXT`,
  `ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "amazonLwaClientSecret" TEXT`,
  `ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "amazonSellerId" TEXT`,
  `ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "amazonMarketplaceId" TEXT DEFAULT 'ATVPDKIKX0DER'`,
  `ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "amazonRegion" TEXT DEFAULT 'na'`,
  `ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "shopeePartnerId" TEXT`,
  `ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "shopeePartnerKey" TEXT`,
  `ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "shopeeShopId" TEXT`,
  `ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "shopeeAccessToken" TEXT`,
  `ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "shopeeRefreshToken" TEXT`,
  `ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "shopeeRegion" TEXT DEFAULT 'https://partner.shopeemobile.com'`,
];

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get('key') !== KEY) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const results: string[] = [];
  for (const sql of STATEMENTS) {
    try {
      await prisma.$executeRawUnsafe(sql);
      results.push(`OK: ${sql.split('"')[3]}`);
    } catch (e: any) {
      results.push(`ERR ${sql.split('"')[3]}: ${String(e?.message || e).slice(0, 120)}`);
    }
  }
  return NextResponse.json({ done: true, results });
}

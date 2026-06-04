// app/api/admin/migrate-omnibox/route.ts
// 【临时受保护迁移路由 — 用完即删】
// 增量为生产库添加统一收件箱所需的表与字段。全部幂等(IF NOT EXISTS),
// 不触碰任何现有数据,可安全重复执行。
//
// 调用:GET /api/admin/migrate-omnibox?key=<MIGRATE_KEY>
// 保护:必须匹配环境变量 MIGRATE_KEY,否则 403。
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const DDL: string[] = [
  // 枚举(IF NOT EXISTS 需用 DO block 包裹,Postgres CREATE TYPE 无 IF NOT EXISTS)
  `DO $$ BEGIN
     CREATE TYPE "InboxChannel" AS ENUM ('WHATSAPP','ALIBABA','AMAZON','SHOPEE','FACEBOOK');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  `DO $$ BEGIN
     CREATE TYPE "InboxStatus" AS ENUM ('NEW','AI_DRAFTED','REPLIED','ARCHIVED');
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,

  // SystemSettings 新增自动化字段
  `ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "aiBusinessInfo" TEXT;`,
  `ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "autoReplyMode" TEXT NOT NULL DEFAULT 'DRAFT';`,

  // InboxMessage 表
  `CREATE TABLE IF NOT EXISTS "InboxMessage" (
     "id" TEXT NOT NULL,
     "channel" "InboxChannel" NOT NULL,
     "direction" "MessageDirection" NOT NULL,
     "externalId" TEXT,
     "threadId" TEXT,
     "senderId" TEXT NOT NULL,
     "senderName" TEXT,
     "originalText" TEXT NOT NULL,
     "detectedLang" TEXT,
     "translatedText" TEXT,
     "intent" TEXT,
     "aiReplyZh" TEXT,
     "aiReplyCustomer" TEXT,
     "aiAutoSendable" BOOLEAN NOT NULL DEFAULT false,
     "status" "InboxStatus" NOT NULL DEFAULT 'NEW',
     "mediaUrl" TEXT,
     "companyId" TEXT,
     "sentAt" TIMESTAMP(3),
     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "InboxMessage_pkey" PRIMARY KEY ("id")
   );`,

  // 索引 / 唯一约束(幂等)
  `CREATE UNIQUE INDEX IF NOT EXISTS "InboxMessage_channel_externalId_key" ON "InboxMessage"("channel","externalId");`,
  `CREATE INDEX IF NOT EXISTS "InboxMessage_channel_status_idx" ON "InboxMessage"("channel","status");`,
  `CREATE INDEX IF NOT EXISTS "InboxMessage_threadId_idx" ON "InboxMessage"("threadId");`,

  // 外键(到 Company)。先查是否存在再加,避免重复报错
  `DO $$ BEGIN
     ALTER TABLE "InboxMessage"
       ADD CONSTRAINT "InboxMessage_companyId_fkey"
       FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
];

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const key = searchParams.get('key');
  const expected = process.env.MIGRATE_KEY;

  if (!expected || key !== expected) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const results: { sql: string; ok: boolean; error?: string }[] = [];
  for (const sql of DDL) {
    try {
      await prisma.$executeRawUnsafe(sql);
      results.push({ sql: sql.slice(0, 60).replace(/\s+/g, ' '), ok: true });
    } catch (err: any) {
      results.push({ sql: sql.slice(0, 60).replace(/\s+/g, ' '), ok: false, error: String(err?.message || err).slice(0, 200) });
    }
  }

  // 验证表是否可查询
  let verify = 'unknown';
  try {
    const c = await prisma.inboxMessage.count();
    verify = `InboxMessage OK, rows=${c}`;
  } catch (err: any) {
    verify = 'InboxMessage NOT queryable: ' + String(err?.message || err).slice(0, 120);
  }

  return NextResponse.json({ ok: results.every((r) => r.ok), verify, results });
}

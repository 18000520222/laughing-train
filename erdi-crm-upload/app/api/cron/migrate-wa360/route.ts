// 临时迁移路由：给 SystemSettings 加 whatsapp360ApiKey 列。用完即删。
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('key') !== 'erdi-channel-2026') {
    return new Response('forbidden', { status: 403 });
  }
  try {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "SystemSettings" ADD COLUMN IF NOT EXISTS "whatsapp360ApiKey" TEXT'
    );
    return NextResponse.json({ ok: true, migrated: 'whatsapp360ApiKey' });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}

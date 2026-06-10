import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const appKey = searchParams.get('appKey');
    const appSecret = searchParams.get('appSecret');
    
    if (!appKey || !appSecret) {
      return NextResponse.json({ error: 'Missing appKey or appSecret' }, { status: 400 });
    }

    const existing = await prisma.systemSettings.findFirst();
    if (existing) {
      await prisma.systemSettings.update({
        where: { id: existing.id },
        data: { alibabaAppKey: appKey, alibabaAppSecret: appSecret },
      });
    } else {
      await prisma.systemSettings.create({
        data: { alibabaAppKey: appKey, alibabaAppSecret: appSecret },
      });
    }

    return NextResponse.json({ success: true, appKey });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { handleMetaWebhookPayload, verifyMetaWebhook } from '@/lib/meta-webhook';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return verifyMetaWebhook(req);
}

export async function POST(req: Request) {
  try {
    const payload = await req.json();
    const report = await handleMetaWebhookPayload(payload);
    return NextResponse.json({ ok: true, report });
  } catch (err: any) {
    console.error('[meta-webhook]', err);
    return NextResponse.json({ ok: true });
  }
}

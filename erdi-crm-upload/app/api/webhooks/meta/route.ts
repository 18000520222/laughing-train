import { NextResponse } from 'next/server';
import { handleMetaWebhookPayload, verifyMetaWebhook, verifyMetaWebhookSignature } from '@/lib/meta-webhook';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return verifyMetaWebhook(req);
}

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    if (!(await verifyMetaWebhookSignature(rawBody, req.headers.get('x-hub-signature-256')))) {
      return NextResponse.json({ error: 'Invalid Meta webhook signature' }, { status: 401 });
    }
    const payload = JSON.parse(rawBody);
    const report = await handleMetaWebhookPayload(payload);
    return NextResponse.json({ ok: true, report });
  } catch (err: any) {
    console.error('[meta-webhook]', err);
    return NextResponse.json({ ok: true });
  }
}

import { isAgentAuthorized } from '@/lib/agent-auth';
import { importShoplineOrder, verifyShoplineWebhook } from '@/lib/shopline-orders';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-shopline-hmac-sha256') || '';
  const topic = request.headers.get('x-shopline-topic') || '';

  if (signature) {
    const secret = process.env.SHOPLINE_APP_SECRET || '';
    if (!secret) {
      return NextResponse.json({ error: 'SHOPLINE webhook is not configured.' }, { status: 503 });
    }
    if (!verifyShoplineWebhook(rawBody, signature, secret)) {
      return NextResponse.json({ error: 'Invalid SHOPLINE signature.' }, { status: 401 });
    }
    if (topic && !topic.startsWith('orders/')) {
      return NextResponse.json({ error: `Unsupported SHOPLINE topic: ${topic}` }, { status: 400 });
    }
  } else if (!isAgentAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  try {
    const result = await importShoplineOrder(payload);
    console.info('SHOPLINE order import', {
      orderNumber: result.orderNumber,
      status: result.status,
      topic: topic || 'agent-import',
    });
    return NextResponse.json({ success: true, ...result }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown import error.';
    console.error('SHOPLINE order import failed', { topic: topic || 'agent-import', message });
    return NextResponse.json({ error: message }, { status: 422 });
  }
}

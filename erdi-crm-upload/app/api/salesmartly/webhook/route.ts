import { NextResponse } from 'next/server';
import { ingestInbound, markReplied } from '@/lib/inbox';
import { prisma } from '@/lib/prisma';
import { salesmartlyAdapter } from '@/lib/channels/salesmartly';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'salesmartly-webhook',
    webhookUrl: '/api/salesmartly/webhook',
  });
}

export async function POST(req: Request) {
  try {
    const payload = await req.json();
    const allowed = await verifyWebhook(req, payload);
    if (!allowed) return NextResponse.json({ ok: false, error: 'invalid salesmartly webhook key' }, { status: 401 });

    const messages = await salesmartlyAdapter.parseInbound(payload);
    const report = { received: messages.length, ingested: 0, duplicate: 0, autoSent: 0, errors: 0 };

    for (const msg of messages) {
      try {
        const result = await ingestInbound(msg);
        if (result.created) report.ingested++;
        else if (result.skippedReason === 'duplicate') report.duplicate++;

        if (result.autoSent && result.inboxId) {
          const inbox = await prisma.inboxMessage.findUnique({ where: { id: result.inboxId } });
          if (inbox?.aiReplyCustomer) {
            const sent = await salesmartlyAdapter.send({
              to: inbox.senderId,
              text: inbox.aiReplyCustomer,
              threadId: inbox.threadId || undefined,
            });
            if (sent.ok) {
              await markReplied(result.inboxId, inbox.aiReplyCustomer, inbox.aiReplyZh || undefined);
              report.autoSent++;
            }
          }
        }
      } catch (err) {
        report.errors++;
        console.error('[salesmartly-webhook] ingest failed:', err);
      }
    }

    return NextResponse.json({ ok: report.errors === 0, ...report });
  } catch (err: any) {
    console.error('[salesmartly-webhook]', err);
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}

async function verifyWebhook(req: Request, payload: unknown) {
  const settings = await prisma.systemSettings.findUnique({ where: { id: 'default' } }).catch(() => null);
  const expected = settings?.salesmartlyWebhookKey || process.env.SALESMARTLY_WEBHOOK_KEY;
  if (!expected) return true;

  const url = new URL(req.url);
  const auth = req.headers.get('authorization') || '';
  const payloadRecord = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const provided =
    req.headers.get('x-salesmartly-key') ||
    req.headers.get('x-webhook-key') ||
    req.headers.get('x-api-key') ||
    (auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '') ||
    url.searchParams.get('key') ||
    String(payloadRecord.webhook_key || payloadRecord.webhookKey || payloadRecord.token || '');

  return provided === expected;
}

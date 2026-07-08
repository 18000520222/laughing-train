import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { ingestInbound, markReplied } from '@/lib/inbox';
import { prisma } from '@/lib/prisma';
import { chatwootAdapter } from '@/lib/channels/chatwoot';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'chatwoot-webhook',
    webhookUrl: '/api/chatwoot/webhook',
  });
}

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    const payload = rawBody ? JSON.parse(rawBody) : {};
    const allowed = await verifyWebhook(req, rawBody, payload);
    if (!allowed) return NextResponse.json({ ok: false, error: 'invalid chatwoot webhook key' }, { status: 401 });

    const messages = await chatwootAdapter.parseInbound(payload);
    const report = { received: messages.length, ingested: 0, duplicate: 0, autoSent: 0, errors: 0 };

    for (const msg of messages) {
      try {
        const result = await ingestInbound(msg);
        if (result.created) report.ingested++;
        else if (result.skippedReason === 'duplicate') report.duplicate++;

        if (result.autoSent && result.inboxId) {
          const inbox = await prisma.inboxMessage.findUnique({ where: { id: result.inboxId } });
          if (inbox?.aiReplyCustomer) {
            const sent = await chatwootAdapter.send({
              to: inbox.threadId || inbox.senderId,
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
        console.error('[chatwoot-webhook] ingest failed:', err);
      }
    }

    return NextResponse.json({ ok: report.errors === 0, ...report });
  } catch (err: any) {
    console.error('[chatwoot-webhook]', err);
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}

async function verifyWebhook(req: Request, rawBody: string, payload: unknown) {
  const settings = await prisma.systemSettings.findUnique({ where: { id: 'default' } }).catch(() => null);
  const expected = settings?.chatwootWebhookKey || process.env.CHATWOOT_WEBHOOK_KEY;
  if (!expected) return true;

  const signature = req.headers.get('x-chatwoot-signature');
  const timestamp = req.headers.get('x-chatwoot-timestamp');
  if (signature && timestamp) {
    const digest = crypto.createHmac('sha256', expected).update(`${timestamp}.${rawBody}`).digest('hex');
    const expectedSignature = `sha256=${digest}`;
    return timingSafeEqual(signature, expectedSignature);
  }

  const url = new URL(req.url);
  const auth = req.headers.get('authorization') || '';
  const payloadRecord = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const provided =
    req.headers.get('x-chatwoot-key') ||
    req.headers.get('x-webhook-key') ||
    req.headers.get('x-api-key') ||
    (auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '') ||
    url.searchParams.get('key') ||
    String(payloadRecord.webhook_key || payloadRecord.webhookKey || payloadRecord.token || '');

  return provided === expected;
}

function timingSafeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

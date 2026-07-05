import { prisma } from '@/lib/prisma';
import { ingestInbound } from '@/lib/inbox';
import { whatsappAdapter } from '@/lib/channels/whatsapp';
import type { ChannelType, NormalizedMessage } from '@/lib/channels/types';

export async function expectedMetaVerifyToken() {
  const settings = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
  return (
    process.env.META_VERIFY_TOKEN ||
    settings?.fbVerifyToken ||
    settings?.whatsappVerifyToken ||
    process.env.FB_VERIFY_TOKEN ||
    process.env.WHATSAPP_VERIFY_TOKEN ||
    'ERDI_META_CRM_2026'
  );
}

export async function verifyMetaWebhook(req: Request) {
  const { searchParams } = new URL(req.url);
  const expected = await expectedMetaVerifyToken();
  if (searchParams.get('hub.mode') === 'subscribe' && searchParams.get('hub.verify_token') === expected) {
    return new Response(searchParams.get('hub.challenge') || '', { status: 200 });
  }
  return new Response('forbidden', { status: 403 });
}

export async function handleMetaWebhookPayload(payload: any) {
  const object = String(payload?.object || '').toLowerCase();
  if (object === 'whatsapp_business_account') {
    return ingestMessages(await whatsappAdapter.parseInbound(payload));
  }

  const channel: ChannelType = object === 'instagram' ? 'INSTAGRAM' : 'FACEBOOK';
  return ingestMessages(parseMetaMessagingPayload(payload, channel));
}

function parseMetaMessagingPayload(payload: any, channel: ChannelType): NormalizedMessage[] {
  const messages: NormalizedMessage[] = [];
  for (const entry of payload?.entry || []) {
    const pageOrAccountId = String(entry?.id || '');
    for (const event of entry?.messaging || []) {
      const senderId = String(event?.sender?.id || event?.from?.id || '');
      if (!senderId) continue;
      const text = event?.message?.text || event?.postback?.title || event?.postback?.payload;
      const mid = event?.message?.mid || event?.postback?.mid;
      const mediaUrl = event?.message?.attachments?.[0]?.payload?.url;
      if (!text && !mediaUrl) continue;

      messages.push({
        channel,
        direction: 'IN',
        externalId: mid || `${channel.toLowerCase()}-${pageOrAccountId}-${senderId}-${event?.timestamp || Date.now()}`,
        threadId: `${pageOrAccountId}:${senderId}`,
        senderId,
        text: String(text || '[media]'),
        mediaUrl,
        sentAt: event?.timestamp ? new Date(Number(event.timestamp)) : undefined,
      });
    }
  }
  return messages;
}

async function ingestMessages(messages: NormalizedMessage[]) {
  const report = { received: messages.length, created: 0, duplicate: 0 };
  for (const message of messages) {
    const result = await ingestInbound(message);
    if (result.created) report.created++;
    else report.duplicate++;
  }
  return report;
}

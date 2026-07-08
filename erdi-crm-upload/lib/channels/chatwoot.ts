import crypto from 'node:crypto';
import { prisma } from '@/lib/prisma';
import type { ChannelAdapter, NormalizedMessage, OutboundMessage, SendResult } from '@/lib/channels/types';

type AnyRecord = Record<string, unknown>;

class ChatwootAdapter implements ChannelAdapter {
  readonly channel = 'CHATWOOT' as const;

  async parseInbound(rawPayload: unknown): Promise<NormalizedMessage[]> {
    const root = asRecord(rawPayload);
    const event = pickString(root, ['event', 'event_name', 'name']) || '';
    const items = collectWebhookItems(root);
    const messages: NormalizedMessage[] = [];

    for (const item of items) {
      const message = asRecord(item);
      const conversation = firstRecord(message.conversation, root.conversation, getPath(root, ['data', 'conversation']));
      const contact = firstRecord(
        message.sender,
        message.contact,
        conversation.contact,
        root.sender,
        root.contact,
        getPath(root, ['data', 'contact'])
      );
      const inbox = firstRecord(message.inbox, conversation.inbox, root.inbox);

      const messageType = pickString(message, ['message_type', 'messageType']) || pickString(root, ['message_type', 'messageType']);
      const isIncoming = messageType ? messageType === 'incoming' : !event || event.includes('contact') || event.includes('message');
      if (!isIncoming) continue;

      const text =
        pickString(message, ['content', 'text', 'message', 'body']) ||
        pickString(root, ['content', 'text', 'message', 'body']) ||
        collectAttachmentText(message) ||
        collectAttachmentText(root);
      if (!text) continue;

      const conversationId =
        pickString(conversation, ['id', 'display_id', 'identifier']) ||
        pickString(message, ['conversation_id', 'conversationId']) ||
        pickString(root, ['conversation_id', 'conversationId']) ||
        pickString(contact, ['id', 'source_id', 'sourceId', 'identifier']);
      const senderId =
        pickString(contact, ['id', 'source_id', 'sourceId', 'identifier', 'email', 'phone_number', 'phoneNumber']) ||
        pickString(message, ['sender_id', 'senderId']) ||
        conversationId ||
        'chatwoot-unknown';
      const externalId =
        pickString(message, ['id', 'message_id', 'messageId']) ||
        pickString(root, ['id', 'message_id', 'messageId']) ||
        stableId([conversationId || '', senderId, text, pickString(message, ['created_at', 'createdAt']) || '']);

      messages.push({
        channel: 'CHATWOOT',
        direction: 'IN',
        externalId: `cw-${externalId}`,
        threadId: conversationId,
        senderId: String(senderId),
        senderName:
          pickString(contact, ['name', 'display_name', 'displayName']) ||
          pickString(message, ['sender_name', 'senderName']) ||
          pickString(inbox, ['name']),
        text,
        mediaUrl: firstAttachmentUrl(message) || firstAttachmentUrl(root),
        sentAt: parseDate(pickString(message, ['created_at', 'createdAt', 'timestamp']) || pickString(root, ['created_at', 'createdAt'])),
      });
    }

    return messages;
  }

  async send(msg: OutboundMessage): Promise<SendResult> {
    const settings = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
    const baseUrl = trimTrailingSlash(settings?.chatwootBaseUrl || process.env.CHATWOOT_BASE_URL);
    const accountId = settings?.chatwootAccountId || process.env.CHATWOOT_ACCOUNT_ID;
    const apiToken = settings?.chatwootApiToken || process.env.CHATWOOT_API_TOKEN;
    const conversationId = msg.threadId || msg.to;

    if (!baseUrl) return { ok: false, error: 'CHATWOOT_BASE_URL 未配置' };
    if (!accountId) return { ok: false, error: 'CHATWOOT_ACCOUNT_ID 未配置' };
    if (!apiToken) return { ok: false, error: 'CHATWOOT_API_TOKEN 未配置' };
    if (!conversationId) return { ok: false, error: 'Chatwoot conversation id 缺失' };

    const res = await fetch(`${baseUrl}/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        api_access_token: apiToken,
      },
      body: JSON.stringify({
        content: msg.text,
        message_type: 'outgoing',
        private: false,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: String(pickString(asRecord(data), ['message', 'error', 'description']) || res.statusText) };
    return { ok: true, externalId: pickString(asRecord(data), ['id', 'message_id', 'messageId']) };
  }
}

function collectWebhookItems(root: AnyRecord): AnyRecord[] {
  const candidates = [
    root.messages,
    getPath(root, ['data', 'messages']),
    root.message,
    getPath(root, ['data', 'message']),
    root,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.map(asRecord);
    const record = asRecord(candidate);
    if (Object.keys(record).length > 0 && (record.content || record.message || record.text || record.body || record.attachments)) return [record];
  }
  return [];
}

function collectAttachmentText(record: AnyRecord) {
  const attachment = firstRecord(...arrayFrom(record.attachments));
  const url = pickString(attachment, ['data_url', 'dataUrl', 'download_url', 'downloadUrl', 'url', 'file_url', 'fileUrl']);
  return url ? `[Chatwoot 附件] ${url}` : undefined;
}

function firstAttachmentUrl(record: AnyRecord) {
  const attachment = firstRecord(...arrayFrom(record.attachments));
  return pickString(attachment, ['data_url', 'dataUrl', 'download_url', 'downloadUrl', 'url', 'file_url', 'fileUrl']);
}

function arrayFrom(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): AnyRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as AnyRecord) : {};
}

function firstRecord(...values: unknown[]) {
  for (const value of values) {
    const record = asRecord(value);
    if (Object.keys(record).length > 0) return record;
  }
  return {};
}

function pickString(record: AnyRecord, keys: string[]) {
  for (const key of keys) {
    const value = key.includes('.') ? getPath(record, key.split('.')) : record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return undefined;
}

function getPath(record: AnyRecord, path: string[]) {
  let current: unknown = record;
  for (const key of path) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as AnyRecord)[key];
  }
  return current;
}

function parseDate(value: string | undefined) {
  if (!value) return undefined;
  const numeric = Number(value);
  const date = Number.isFinite(numeric) ? new Date(numeric > 10_000_000_000 ? numeric : numeric * 1000) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function trimTrailingSlash(value: string | null | undefined) {
  return value?.trim().replace(/\/+$/, '');
}

function stableId(parts: string[]) {
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex');
}

export const chatwootAdapter = new ChatwootAdapter();

import crypto from 'node:crypto';
import { prisma } from '@/lib/prisma';
import type { ChannelAdapter, NormalizedMessage, OutboundMessage, SendResult } from '@/lib/channels/types';

type AnyRecord = Record<string, unknown>;

class SaleSmartlyAdapter implements ChannelAdapter {
  readonly channel = 'SALESMARTLY' as const;

  async parseInbound(rawPayload: unknown): Promise<NormalizedMessage[]> {
    const root = asRecord(rawPayload);
    const items = collectWebhookItems(rawPayload);
    const messages: NormalizedMessage[] = [];

    for (const item of items) {
      const message = asRecord(item);
      const customer = firstRecord(
        message.customer,
        message.visitor,
        message.user,
        message.sender,
        getPath(message, ['data', 'customer']),
        root.customer,
        root.visitor,
        root.user
      );
      const session = firstRecord(
        message.session,
        message.conversation,
        message.chat,
        getPath(message, ['data', 'session']),
        root.session,
        root.conversation,
        root.chat
      );

      const text = pickString(message, ['text', 'content', 'body', 'message', 'message_text', 'msg']) || pickString(asRecord(message.message), ['text', 'content', 'body']);
      const mediaUrl = pickString(message, ['media_url', 'mediaUrl', 'file_url', 'fileUrl', 'attachment_url', 'attachmentUrl', 'url']) || pickString(asRecord(message.attachment), ['url']);
      if (!text && !mediaUrl) continue;

      const senderId =
        pickString(customer, ['id', 'customer_id', 'customerId', 'user_id', 'userId', 'visitor_id', 'visitorId', 'open_id', 'openId', 'phone', 'email']) ||
        pickString(message, ['sender_id', 'senderId', 'from', 'from_id', 'fromId', 'customer_id', 'customerId']) ||
        pickString(root, ['sender_id', 'senderId', 'customer_id', 'customerId']) ||
        'salesmartly-unknown';
      const threadId =
        pickString(session, ['id', 'conversation_id', 'conversationId', 'session_id', 'sessionId', 'chat_id', 'chatId']) ||
        pickString(message, ['conversation_id', 'conversationId', 'session_id', 'sessionId', 'chat_id', 'chatId', 'thread_id', 'threadId']) ||
        senderId;
      const platform = pickString(message, ['channel', 'platform', 'source', 'account_type', 'accountType']) || pickString(session, ['channel', 'platform', 'source']);
      const externalId =
        pickString(message, ['id', 'message_id', 'messageId', 'msg_id', 'msgId', 'event_id', 'eventId']) ||
        stableId([threadId, senderId, text || mediaUrl || '', pickString(message, ['created_at', 'createdAt', 'timestamp', 'time']) || '']);

      messages.push({
        channel: 'SALESMARTLY',
        direction: 'IN',
        externalId,
        threadId,
        senderId,
        senderName: pickString(customer, ['name', 'nickname', 'user_name', 'userName']) || pickString(message, ['sender_name', 'senderName', 'name']) || platform,
        text: text || `[SaleSmartly 附件] ${mediaUrl}`,
        mediaUrl,
        sentAt: parseDate(pickString(message, ['created_at', 'createdAt', 'timestamp', 'time', 'send_time', 'sendTime'])),
      });
    }

    return messages;
  }

  async send(msg: OutboundMessage): Promise<SendResult> {
    const settings = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
    const replyUrl = settings?.salesmartlyReplyUrl || process.env.SALESMARTLY_REPLY_URL;
    const apiKey = settings?.salesmartlyApiKey || process.env.SALESMARTLY_API_KEY;
    if (!replyUrl) return { ok: false, error: 'SALESMARTLY_REPLY_URL 未配置' };

    const res = await fetch(replyUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}`, 'x-api-key': apiKey } : {}),
      },
      body: JSON.stringify({
        conversation_id: msg.threadId,
        session_id: msg.threadId,
        chat_id: msg.threadId,
        customer_id: msg.to,
        receiver_id: msg.to,
        to: msg.to,
        text: msg.text,
        content: msg.text,
        message: msg.text,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: String((data as AnyRecord).message || (data as AnyRecord).error || res.statusText) };
    return { ok: true, externalId: pickString(asRecord(data), ['id', 'message_id', 'messageId', 'data.id']) };
  }
}

function collectWebhookItems(rawPayload: unknown): AnyRecord[] {
  if (Array.isArray(rawPayload)) return rawPayload.map(asRecord);
  const root = asRecord(rawPayload);
  const data = asRecord(root.data);
  const candidates = [
    root.messages,
    root.list,
    data.messages,
    data.list,
    getPath(root, ['event', 'messages']),
    root.message,
    data.message,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.map(asRecord);
    if (candidate && typeof candidate === 'object') return [asRecord(candidate)];
  }
  if (pickString(root, ['text', 'content', 'body', 'message']) || pickString(data, ['text', 'content', 'body', 'message'])) {
    return [pickString(root, ['text', 'content', 'body', 'message']) ? root : data];
  }
  return [];
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

function stableId(parts: string[]) {
  return `ss-${crypto.createHash('sha1').update(parts.join('|')).digest('hex')}`;
}

export const salesmartlyAdapter = new SaleSmartlyAdapter();

// lib/channels/whatsapp.ts — WhatsApp Cloud API 渠道适配器
//
// 实现统一 ChannelAdapter:解析 Meta webhook payload + 发送消息。
// 翻译/AI 回复由中台 pipeline 统一处理,这里只做协议转换。

import { prisma } from '@/lib/prisma';
import type {
  ChannelAdapter,
  NormalizedMessage,
  OutboundMessage,
  SendResult,
} from '@/lib/channels/types';

export class WhatsAppAdapter implements ChannelAdapter {
  readonly channel = 'WHATSAPP' as const;

  async parseInbound(rawPayload: unknown): Promise<NormalizedMessage[]> {
    const payload = rawPayload as any;
    const out: NormalizedMessage[] = [];

    // 兼容两种 payload 结构：
    //  - Meta Cloud / 360dialog 标准：{ entry: [{ changes: [{ value: { messages, contacts } }] }] }
    //  - 360dialog 旧版/精简：顶层直接 { messages, contacts }
    const values: any[] = [];
    const entries = payload?.entry || [];
    for (const entry of entries) {
      for (const change of entry?.changes || []) {
        if (change?.value) values.push(change.value);
      }
    }
    if (values.length === 0 && payload?.messages) {
      values.push(payload); // 360dialog 顶层直挂
    }

    for (const value of values) {
      if (!value?.messages) continue;
      const contactName = value.contacts?.[0]?.profile?.name;

      for (const msg of value.messages) {
        let text = '';
        let mediaUrl: string | undefined;

        if (msg.type === 'text') {
          text = msg.text?.body || '';
        } else if (['image', 'document', 'audio', 'video'].includes(msg.type)) {
          text = `[${msg.type}] ${msg[msg.type]?.caption || ''}`.trim();
          mediaUrl = msg[msg.type]?.id;
        } else {
          text = `[${msg.type}]`;
        }

        out.push({
          channel: 'WHATSAPP',
          direction: 'IN',
          externalId: msg.id,
          threadId: msg.from, // WhatsApp 以手机号作为会话标识
          senderId: msg.from,
          senderName: contactName,
          text,
          mediaUrl,
          sentAt: msg.timestamp ? new Date(Number(msg.timestamp) * 1000) : undefined,
        });
      }
    }

    return out;
  }

  async send(msg: OutboundMessage): Promise<SendResult> {
    const settings = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
    const cleanTo = msg.to.replace(/[^\d]/g, '');

    // 消息体与 Meta Cloud / 360dialog 完全一致
    const body = JSON.stringify({
      messaging_product: 'whatsapp',
      to: cleanTo,
      type: 'text',
      text: { body: msg.text },
    });

    // ── 模式一：360dialog (BSP) —— 填了 API Key 就优先走 ──
    const d360Key = settings?.whatsapp360ApiKey || process.env.WHATSAPP_360_API_KEY;
    if (d360Key) {
      try {
        const res = await fetch('https://waba-v2.360dialog.io/messages', {
          method: 'POST',
          headers: {
            'D360-API-KEY': d360Key,
            'Content-Type': 'application/json',
          },
          body,
          signal: AbortSignal.timeout(15000),
        });
        const data = await res.json();
        if (!res.ok) {
          return { ok: false, error: '[360dialog] ' + JSON.stringify(data?.error || data).slice(0, 280) };
        }
        return { ok: true, externalId: data.messages?.[0]?.id };
      } catch (err: any) {
        return { ok: false, error: '[360dialog] ' + String(err?.message || err) };
      }
    }

    // ── 模式二：原生 Meta Cloud API ──
    const token = settings?.whatsappToken || process.env.WHATSAPP_TOKEN;
    const phoneId = settings?.whatsappPhoneId || process.env.WHATSAPP_PHONE_ID;
    if (!token || !phoneId) {
      return { ok: false, error: '未配置 WhatsApp：请填 360dialog API Key，或 Meta Cloud Token + Phone ID' };
    }

    try {
      const res = await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body,
        signal: AbortSignal.timeout(15000),
      });

      const data = await res.json();
      if (!res.ok) {
        return { ok: false, error: JSON.stringify(data?.error || data).slice(0, 300) };
      }
      return { ok: true, externalId: data.messages?.[0]?.id };
    } catch (err: any) {
      return { ok: false, error: String(err?.message || err) };
    }
  }
}

export const whatsappAdapter = new WhatsAppAdapter();

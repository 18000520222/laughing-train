// app/api/whatsapp/webhook/route.ts
// Meta WhatsApp Cloud API webhook (GET verify + POST receive)
//
// 升级:走统一中台 ingest pipeline(翻译 + AI 回复 + 统一收件箱),
// 同时保留旧 WhatsAppMessage 表写入,兼容现有 /whatsapp 页面。

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { whatsappAdapter } from '@/lib/channels/whatsapp';
import { ingestInbound, markReplied } from '@/lib/inbox';
import { verifyMetaWebhookSignature } from '@/lib/meta-webhook';

// GET = Meta 平台对 Webhook URL 的校验请求
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const settings = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
  const expected = settings?.whatsappVerifyToken || process.env.WHATSAPP_VERIFY_TOKEN || '';

  if (expected && mode === 'subscribe' && token === expected) {
    return new Response(challenge, { status: 200 });
  }
  return new Response('forbidden', { status: 403 });
}

// POST = 接收用户消息
export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    if (!(await verifyMetaWebhookSignature(rawBody, req.headers.get('x-hub-signature-256')))) {
      return NextResponse.json({ error: 'Invalid Meta webhook signature' }, { status: 401 });
    }
    const payload = JSON.parse(rawBody);

    // 1. 适配器解析为标准消息
    const messages = await whatsappAdapter.parseInbound(payload);
    if (!messages.length) {
      return NextResponse.json({ ok: true }); // status 更新等非消息事件
    }

    for (const m of messages) {
      // 2. 走统一中台流水线(翻译 + AI 回复 + 入库 InboxMessage + 通知)
      const result = await ingestInbound(m);
      if (!result.created) continue;

      // 3. 兼容旧表:同步写一条 WhatsAppMessage(供旧 /whatsapp 页面)
      try {
        const inbox = result.inboxId
          ? await prisma.inboxMessage.findUnique({ where: { id: result.inboxId } })
          : null;
        await prisma.whatsAppMessage.create({
          data: {
            waMessageId: m.externalId,
            direction: 'IN',
            phoneNumber: m.senderId,
            contactName: m.senderName,
            body: m.text,
            translated: inbox?.translatedText || undefined,
            mediaUrl: m.mediaUrl,
            companyId: inbox?.companyId || undefined,
          },
        });
      } catch (e) {
        // waMessageId 唯一冲突等忽略(重复投递)
      }

      // 4. AUTO 模式 + AI 判定可自动发 → 立即发送
      if (result.autoSent && result.inboxId) {
        const inbox = await prisma.inboxMessage.findUnique({ where: { id: result.inboxId } });
        if (inbox?.aiReplyCustomer) {
          const sent = await whatsappAdapter.send({
            to: m.senderId,
            text: inbox.aiReplyCustomer,
            threadId: m.threadId,
          });
          if (sent.ok) {
            await markReplied(result.inboxId, inbox.aiReplyCustomer, inbox.aiReplyZh || undefined);
            // 出站也记一条旧表
            try {
              await prisma.whatsAppMessage.create({
                data: {
                  waMessageId: sent.externalId,
                  direction: 'OUT',
                  phoneNumber: m.senderId,
                  body: inbox.aiReplyCustomer,
                  companyId: inbox.companyId || undefined,
                  status: 'SENT',
                },
              });
            } catch {}
          }
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[wa-webhook]', err);
    // 永远返 200 防止 Meta 重试雪崩
    return NextResponse.json({ error: String(err.message || err) }, { status: 200 });
  }
}

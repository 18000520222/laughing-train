// app/api/shopee/webhook/route.ts — Shopee 开放平台 push 回调
//
// Shopee Push 机制会把买家聊天/订单事件 push 到此 URL。
// POST 接收 → 适配器解析 → 中台 ingest。AUTO 模式可自动回复。

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { shopeeAdapter } from '@/lib/channels/shopee';
import { ingestInbound, markReplied } from '@/lib/inbox';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ ok: true, service: 'shopee-webhook' });
}

export async function POST(req: Request) {
  try {
    const payload = await req.json().catch(() => ({}));

    const messages = await shopeeAdapter.parseInbound(payload);
    if (!messages.length) return NextResponse.json({ ok: true });

    for (const m of messages) {
      const result = await ingestInbound(m);
      if (!result.created) continue;

      if (result.autoSent && result.inboxId) {
        const inbox = await prisma.inboxMessage.findUnique({ where: { id: result.inboxId } });
        if (inbox?.aiReplyCustomer) {
          const sent = await shopeeAdapter.send({
            to: m.senderId,
            text: inbox.aiReplyCustomer,
            threadId: m.threadId,
          });
          if (sent.ok) {
            await markReplied(result.inboxId, inbox.aiReplyCustomer, inbox.aiReplyZh || undefined);
          }
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[shopee-webhook]', err);
    return NextResponse.json({ error: String(err?.message || err) }, { status: 200 });
  }
}

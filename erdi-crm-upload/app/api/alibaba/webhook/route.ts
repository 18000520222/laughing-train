// app/api/alibaba/webhook/route.ts — 阿里国际站消息推送 webhook
//
// 阿里开放平台「消息服务」会把买家询盘/站内信 push 到此 URL。
// GET 用于平台 URL 校验(回显 challenge);POST 接收消息 → 适配器解析 → 中台 ingest。
// AUTO 模式且 AI 判可发 → 自动通过适配器回复买家。

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { alibabaAdapter } from '@/lib/channels/alibaba';
import { ingestInbound, markReplied } from '@/lib/inbox';

export const dynamic = 'force-dynamic';

// 平台 URL 校验(阿里推送服务订阅时回调)
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  // 阿里不同推送服务校验参数名不一,尽量兼容
  const challenge =
    searchParams.get('challenge') ||
    searchParams.get('echostr') ||
    searchParams.get('hub.challenge');
  if (challenge) return new Response(challenge, { status: 200 });
  return NextResponse.json({ ok: true, service: 'alibaba-webhook' });
}

export async function POST(req: Request) {
  try {
    const payload = await req.json().catch(() => ({}));

    const messages = await alibabaAdapter.parseInbound(payload);
    if (!messages.length) return NextResponse.json({ ok: true });

    for (const m of messages) {
      const result = await ingestInbound(m);
      if (!result.created) continue;

      // AUTO 模式 + AI 可自动发 → 回复买家
      if (result.autoSent && result.inboxId) {
        const inbox = await prisma.inboxMessage.findUnique({ where: { id: result.inboxId } });
        if (inbox?.aiReplyCustomer) {
          const sent = await alibabaAdapter.send({
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
    console.error('[alibaba-webhook]', err);
    return NextResponse.json({ error: String(err?.message || err) }, { status: 200 });
  }
}

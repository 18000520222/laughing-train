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
    const payload = await readPayload(req);

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

async function readPayload(req: Request): Promise<unknown> {
  const contentType = req.headers.get('content-type') || '';
  const text = await req.text().catch(() => '');
  if (!text.trim()) return {};

  if (contentType.includes('application/x-www-form-urlencoded') || text.includes('=') && !text.trim().startsWith('{')) {
    const form = Object.fromEntries(new URLSearchParams(text).entries());
    return expandJsonFields(form);
  }

  try {
    return expandJsonFields(JSON.parse(text));
  } catch {
    return { raw: text };
  }
}

function expandJsonFields(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const obj = value as Record<string, unknown>;
  for (const key of ['message', 'msg', 'data', 'body', 'payload', 'value']) {
    const v = obj[key];
    if (typeof v === 'string') {
      const s = v.trim();
      if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
        try {
          obj[key] = JSON.parse(s);
        } catch {}
      }
    }
  }
  return obj;
}

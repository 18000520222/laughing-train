// app/api/omnibox/reply/route.ts — 统一收件箱一键回复
// 按消息所属渠道分派到对应适配器,中文内容自动译回客户语言。
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { translateReply } from '@/lib/translate';
import { markReplied } from '@/lib/inbox';
import { whatsappAdapter } from '@/lib/channels/whatsapp';
import { alibabaAdapter } from '@/lib/channels/alibaba';
import { amazonAdapter } from '@/lib/channels/amazon';
import { shopeeAdapter } from '@/lib/channels/shopee';
import { salesmartlyAdapter } from '@/lib/channels/salesmartly';
import { chatwootAdapter } from '@/lib/channels/chatwoot';
import type { ChannelAdapter } from '@/lib/channels/types';
import { getSession } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { inboxAccessWhere } from '@/lib/data-access';
import { writeAuditLog } from '@/lib/audit';

// 渠道 → 适配器注册表(全渠道统一回复入口)
const ADAPTERS: Partial<Record<string, ChannelAdapter>> = {
  WHATSAPP: whatsappAdapter,
  ALIBABA: alibabaAdapter,
  AMAZON: amazonAdapter,
  SHOPEE: shopeeAdapter,
  SALESMARTLY: salesmartlyAdapter,
  CHATWOOT: chatwootAdapter,
};

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session || !can(session.role, 'inbox.manage')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { inboxId, replyZh } = await req.json();
    if (!inboxId || !replyZh) {
      return NextResponse.json({ error: 'inboxId & replyZh required' }, { status: 400 });
    }

    const inbox = await prisma.inboxMessage.findFirst({ where: { id: inboxId, AND: [inboxAccessWhere(session)] } });
    if (!inbox) return NextResponse.json({ error: '消息不存在' }, { status: 404 });

    const adapter = ADAPTERS[inbox.channel];
    if (!adapter) {
      return NextResponse.json(
        { error: `渠道 ${inbox.channel} 的发送适配器尚未接入` },
        { status: 400 }
      );
    }

    // 中文译回客户语言
    const targetLang = inbox.detectedLang || 'auto';
    const finalText = await translateReply(replyZh, targetLang);

    const sent = await adapter.send({
      to: inbox.senderId,
      text: finalText,
      threadId: inbox.threadId || undefined,
    });
    if (!sent.ok) {
      return NextResponse.json({ error: sent.error }, { status: 400 });
    }

    await markReplied(inboxId, finalText, replyZh);
    await writeAuditLog(session, {
      action: 'inbox.reply_send',
      entityType: 'InboxMessage',
      entityId: inboxId,
      summary: `通过 ${inbox.channel} 回复客户`,
    });

    return NextResponse.json({ ok: true, sentText: finalText });
  } catch (err: any) {
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}

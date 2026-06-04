// app/api/whatsapp/send/route.ts
// 发送 WhatsApp 消息。支持:
//   - text: 直接发送的文本(若提供 translateTo,会把 text 视为中文先翻译)
//   - translateTo: 客户语言 ISO 代码(如 'en'),提供时把中文 text 译成该语言再发
//   - inboxId: 关联的统一收件箱消息,发送成功后标记为 REPLIED

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { whatsappAdapter } from '@/lib/channels/whatsapp';
import { translateReply } from '@/lib/translate';
import { markReplied } from '@/lib/inbox';

export async function POST(req: Request) {
  try {
    const { to, text, companyId, translateTo, inboxId } = await req.json();
    if (!to || !text) {
      return NextResponse.json({ error: 'to & text required' }, { status: 400 });
    }

    // 若指定客户语言,把中文 text 译过去
    const zhText = text as string;
    const finalText = translateTo ? await translateReply(zhText, translateTo) : zhText;

    const sent = await whatsappAdapter.send({ to, text: finalText });
    if (!sent.ok) {
      return NextResponse.json({ error: sent.error }, { status: 400 });
    }

    const cleanTo = to.replace(/[^\d]/g, '');

    // 旧表记录(兼容 /whatsapp 页面)
    const saved = await prisma.whatsAppMessage.create({
      data: {
        waMessageId: sent.externalId,
        direction: 'OUT',
        phoneNumber: cleanTo,
        body: finalText,
        translated: translateTo ? zhText : undefined,
        companyId: companyId || undefined,
        status: 'SENT',
      },
    });

    // 关联收件箱标记已回复
    if (inboxId) {
      await markReplied(inboxId, finalText, translateTo ? zhText : undefined).catch(() => {});
    }

    return NextResponse.json({ ok: true, message: saved, sentText: finalText });
  } catch (err: any) {
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}

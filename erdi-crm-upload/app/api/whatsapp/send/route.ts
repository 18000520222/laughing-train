// app/api/whatsapp/send/route.ts
import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function POST(req: Request) {
  try {
    const { to, text, companyId } = await req.json();
    if (!to || !text) {
      return NextResponse.json({ error: 'to & text required' }, { status: 400 });
    }

    const settings = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
    const token = settings?.whatsappToken || process.env.WHATSAPP_TOKEN;
    const phoneId = settings?.whatsappPhoneId || process.env.WHATSAPP_PHONE_ID;

    if (!token || !phoneId) {
      return NextResponse.json({ error: '请先在系统设置中配置 WhatsApp Token 与 Phone ID' }, { status: 400 });
    }

    const cleanTo = to.replace(/[^\d]/g, '');

    const res = await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: cleanTo,
        type: 'text',
        text: { body: text },
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json({ error: data }, { status: 400 });
    }

    const saved = await prisma.whatsAppMessage.create({
      data: {
        waMessageId: data.messages?.[0]?.id,
        direction: 'OUT',
        phoneNumber: cleanTo,
        body: text,
        companyId: companyId || undefined,
        status: 'SENT',
      },
    });

    return NextResponse.json({ ok: true, message: saved });
  } catch (err: any) {
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}

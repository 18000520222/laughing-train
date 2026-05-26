// app/api/whatsapp/webhook/route.ts
// Meta WhatsApp Cloud API webhook (GET verify + POST receive)
import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { translateText } from '@/lib/translate';

const prisma = new PrismaClient();

// GET = Meta 平台对 Webhook URL 的校验请求
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const settings = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
  const expected = settings?.whatsappVerifyToken || process.env.WHATSAPP_VERIFY_TOKEN || 'erdi-verify-2026';

  if (mode === 'subscribe' && token === expected) {
    return new Response(challenge, { status: 200 });
  }
  return new Response('forbidden', { status: 403 });
}

// POST = 接收用户消息
export async function POST(req: Request) {
  try {
    const payload = await req.json();
    const entry = payload?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    if (!value?.messages) {
      // status update 或非消息事件
      return NextResponse.json({ ok: true });
    }

    const settings = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
    const libreUrl = settings?.libretranslateUrl || 'https://libretranslate.com';

    for (const msg of value.messages) {
      const phone = msg.from;
      const waMessageId = msg.id;
      const contactName = value.contacts?.[0]?.profile?.name;

      let body = '';
      let mediaUrl: string | undefined;

      if (msg.type === 'text') {
        body = msg.text?.body || '';
      } else if (msg.type === 'image' || msg.type === 'document' || msg.type === 'audio') {
        body = `[${msg.type}] ${msg[msg.type]?.caption || ''}`.trim();
        mediaUrl = msg[msg.type]?.id;
      } else {
        body = `[${msg.type}]`;
      }

      // 自动翻译为中文
      const { translatedText } = await translateText(body, 'zh', 'auto', libreUrl);

      // 尝试匹配已存在客户（通过手机号）
      const existingContact = await prisma.contact.findFirst({
        where: { phone: { contains: phone.slice(-8) } },
        include: { company: true },
      });

      const saved = await prisma.whatsAppMessage.create({
        data: {
          waMessageId,
          direction: 'IN',
          phoneNumber: phone,
          contactName,
          body,
          translated: translatedText,
          mediaUrl,
          companyId: existingContact?.companyId,
        },
      });

      // 通知所有 SUPER_ADMIN / SALES
      const admins = await prisma.user.findMany({
        where: { role: { in: ['SUPER_ADMIN', 'ADMIN', 'SALES'] }, isActive: true },
      });
      await prisma.notification.createMany({
        data: admins.map(u => ({
          userId: u.id,
          type: 'WHATSAPP' as const,
          title: `WhatsApp: ${contactName || phone}`,
          body: translatedText.slice(0, 100),
          link: '/whatsapp',
        })),
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[wa-webhook]', err);
    return NextResponse.json({ error: String(err.message || err) }, { status: 200 }); // 永远返 200 防止 Meta 重试雪崩
  }
}

// app/api/facebook/webhook/route.ts
import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { translateText } from '@/lib/translate';

const prisma = new PrismaClient();

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const settings = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
  const expected = settings?.fbVerifyToken || process.env.FB_VERIFY_TOKEN || 'erdi-fb-verify';

  if (searchParams.get('hub.mode') === 'subscribe' && searchParams.get('hub.verify_token') === expected) {
    return new Response(searchParams.get('hub.challenge') || '', { status: 200 });
  }
  return new Response('forbidden', { status: 403 });
}

export async function POST(req: Request) {
  try {
    const payload = await req.json();
    const settings = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
    const libreUrl = settings?.libretranslateUrl || 'https://libretranslate.com';

    for (const entry of payload.entry || []) {
      const pageId = entry.id;
      const account = await prisma.socialAccount.findUnique({
        where: { platform_externalId: { platform: 'FACEBOOK', externalId: pageId } },
      });
      if (!account) continue;

      for (const event of entry.messaging || []) {
        if (event.message?.text) {
          const senderId = event.sender.id;
          const text = event.message.text;
          const { translatedText } = await translateText(text, 'zh', 'auto', libreUrl);

          await prisma.socialMessage.create({
            data: {
              accountId: account.id,
              platform: 'FACEBOOK',
              direction: 'IN',
              senderId,
              body: text,
              translated: translatedText,
              raw: event,
            },
          });

          const admins = await prisma.user.findMany({
            where: { role: { in: ['SUPER_ADMIN', 'ADMIN', 'SALES'] }, isActive: true },
          });
          await prisma.notification.createMany({
            data: admins.map(u => ({
              userId: u.id,
              type: 'SOCIAL' as const,
              title: `Facebook 消息`,
              body: translatedText.slice(0, 100),
              link: '/social',
            })),
          });
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[fb-webhook]', err);
    return NextResponse.json({ ok: true });
  }
}

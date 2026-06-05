// app/api/auth/facebook/callback/route.ts
import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  if (!code) return NextResponse.redirect(new URL('/social?error=no_code', req.url));

  const settings = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
  const appId = settings?.fbAppId || process.env.FB_APP_ID;
  const appSecret = settings?.fbAppSecret || process.env.FB_APP_SECRET;
  if (!appId || !appSecret) {
    return NextResponse.redirect(new URL('/social?error=missing_app_config', req.url));
  }

  const origin = new URL(req.url).origin;
  const redirectUri = `${origin}/api/auth/facebook/callback`;

  // 1. 用 code 换 user token
  const tokenRes = await fetch(`https://graph.facebook.com/v18.0/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&redirect_uri=${encodeURIComponent(redirectUri)}&code=${code}`);
  const tokenData = await tokenRes.json();
  const userToken = tokenData.access_token;
  if (!userToken) {
    return NextResponse.redirect(new URL(`/social?error=${encodeURIComponent(JSON.stringify(tokenData))}`, req.url));
  }

  // 2. 拉取 user 名下所有 Page
  const pagesRes = await fetch(`https://graph.facebook.com/v18.0/me/accounts?access_token=${userToken}`);
  const pagesData = await pagesRes.json();

  for (const page of pagesData.data || []) {
    await prisma.socialAccount.upsert({
      where: { platform_externalId: { platform: 'FACEBOOK', externalId: page.id } },
      update: { name: page.name, accessToken: page.access_token },
      create: {
        platform: 'FACEBOOK',
        externalId: page.id,
        name: page.name,
        accessToken: page.access_token,
      },
    });

    // 3. 订阅 Page 的 messages 事件
    try {
      await fetch(`https://graph.facebook.com/v18.0/${page.id}/subscribed_apps?subscribed_fields=messages,messaging_postbacks&access_token=${page.access_token}`, {
        method: 'POST',
      });
    } catch (e) {
      console.error('[fb subscribe]', e);
    }
  }

  return NextResponse.redirect(new URL('/social?connected=facebook', req.url));
}

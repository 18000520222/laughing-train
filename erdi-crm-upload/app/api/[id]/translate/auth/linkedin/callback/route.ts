// app/api/auth/linkedin/callback/route.ts
import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  if (!code) return NextResponse.redirect(new URL('/social?error=no_code', req.url));

  const settings = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
  const clientId = settings?.linkedinClientId || process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = settings?.linkedinClientSecret || process.env.LINKEDIN_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL('/social?error=missing_app_config', req.url));
  }

  const origin = new URL(req.url).origin;
  const redirectUri = `${origin}/api/auth/linkedin/callback`;

  const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token;
  if (!accessToken) {
    return NextResponse.redirect(new URL(`/social?error=${encodeURIComponent(JSON.stringify(tokenData))}`, req.url));
  }

  // 获取用户基本信息 (OIDC)
  const profileRes = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },// app/api/translate/route.ts
import { NextResponse } from 'next/server';
import { translateText } from '@/lib/translate';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { text, target = 'zh', source = 'auto' } = body;

    if (!text) {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }

    const settings = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
    const baseUrl = settings?.libretranslateUrl || 'https://libretranslate.com';

    const result = await translateText(text, target, source, baseUrl);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: String(err.message || err) }, { status: 500 });
  }
}

  });
  const profile = await profileRes.json();

  const expiresAt = new Date(Date.now() + (tokenData.expires_in || 5184000) * 1000);

  await prisma.socialAccount.upsert({
    where: { platform_externalId: { platform: 'LINKEDIN', externalId: profile.sub || 'self' } },
    update: { name: profile.name, accessToken, expiresAt },
    create: {
      platform: 'LINKEDIN',
      externalId: profile.sub || 'self',
      name: profile.name || profile.email,
      accessToken,
      expiresAt,
    },
  });

  return NextResponse.redirect(new URL('/social?connected=linkedin', req.url));
}

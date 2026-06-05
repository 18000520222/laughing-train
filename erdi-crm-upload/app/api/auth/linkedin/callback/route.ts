// app/api/auth/linkedin/callback/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';



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
    headers: { Authorization: `Bearer ${accessToken}` },
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

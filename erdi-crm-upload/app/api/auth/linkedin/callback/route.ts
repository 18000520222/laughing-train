// app/api/auth/linkedin/callback/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { canonicalOrigin } from '@/lib/site-url';
import { consumeOAuthState } from '@/lib/oauth-state';



export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const origin = canonicalOrigin();
  const oauthState = await consumeOAuthState('LINKEDIN', searchParams.get('state'));
  if (!oauthState) return NextResponse.redirect(new URL('/social?error=invalid_oauth_state', origin));
  const code = searchParams.get('code');
  if (!code) return NextResponse.redirect(new URL('/social?error=no_code', origin));

  const settings = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
  const clientId = settings?.linkedinClientId || process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = settings?.linkedinClientSecret || process.env.LINKEDIN_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL('/social?error=missing_app_config', origin));
  }

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
    return NextResponse.redirect(new URL(`/social?error=${encodeURIComponent(JSON.stringify(tokenData))}`, origin));
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
  await prisma.auditLog.create({ data: { actorId: oauthState.userId, action: 'channel.oauth_connect', entityType: 'Channel', entityId: 'LINKEDIN', summary: 'LinkedIn OAuth 授权完成' } });

  return NextResponse.redirect(new URL('/social?connected=linkedin', origin));
}

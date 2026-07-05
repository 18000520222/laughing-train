import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { canonicalOrigin } from '@/lib/site-url';

function settingsUrl(params: Record<string, string>) {
  const url = new URL('/settings/channels', canonicalOrigin());
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const oauthError = searchParams.get('error');
  if (oauthError) {
    return NextResponse.redirect(settingsUrl({ error: oauthError }));
  }
  if (!code) {
    return NextResponse.redirect(settingsUrl({ error: 'no_google_code' }));
  }

  const settings = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
  const clientId = settings?.googleClientId || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = settings?.googleClientSecret || process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(settingsUrl({ error: 'missing_google_oauth_client' }));
  }

  const redirectUri = `${canonicalOrigin()}/api/auth/google/callback`;
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });
  const tokenData: any = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokenData.access_token) {
    return NextResponse.redirect(settingsUrl({ error: `google_token_exchange_failed:${tokenData.error || tokenRes.status}` }));
  }

  const profileRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const profile: any = await profileRes.json().catch(() => ({}));
  const email = String(profile.email || '').toLowerCase();
  if (!email || !email.includes('@')) {
    return NextResponse.redirect(settingsUrl({ error: 'google_profile_missing_email' }));
  }

  const existing = await prisma.emailAccount.findUnique({ where: { email } });
  const refreshToken = tokenData.refresh_token || existing?.oauthRefreshToken;
  if (!refreshToken) {
    return NextResponse.redirect(settingsUrl({ error: 'missing_google_refresh_token' }));
  }

  const expiresAt = new Date(Date.now() + Math.max(60, Number(tokenData.expires_in || 3600) - 60) * 1000);
  await prisma.emailAccount.upsert({
    where: { email },
    update: {
      isActive: true,
      authType: 'GOOGLE_OAUTH',
      oauthProvider: 'GOOGLE',
      oauthRefreshToken: refreshToken,
      oauthAccessToken: tokenData.access_token,
      oauthTokenExpiresAt: expiresAt,
      imapHost: 'imap.gmail.com',
      imapPort: 993,
      isSecure: true,
    },
    create: {
      email,
      password: '',
      isActive: true,
      authType: 'GOOGLE_OAUTH',
      oauthProvider: 'GOOGLE',
      oauthRefreshToken: refreshToken,
      oauthAccessToken: tokenData.access_token,
      oauthTokenExpiresAt: expiresAt,
      imapHost: 'imap.gmail.com',
      imapPort: 993,
      isSecure: true,
    },
  });

  return NextResponse.redirect(settingsUrl({ connected: 'google', email }));
}

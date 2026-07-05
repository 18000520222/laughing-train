import { prisma } from '@/lib/prisma';

type EmailImapAccount = {
  id: string;
  email: string;
  password: string;
  authType: string;
  oauthRefreshToken: string | null;
  oauthAccessToken: string | null;
  oauthTokenExpiresAt: Date | null;
};

async function getGoogleAccessToken(acc: EmailImapAccount) {
  if (acc.oauthAccessToken && acc.oauthTokenExpiresAt && acc.oauthTokenExpiresAt.getTime() > Date.now() + 60000) {
    return acc.oauthAccessToken;
  }

  if (!acc.oauthRefreshToken) throw new Error('missing_google_refresh_token');

  const settings = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
  const clientId = settings?.googleClientId || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = settings?.googleClientSecret || process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('missing_google_oauth_client');

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: acc.oauthRefreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const tokenData: any = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokenData.access_token) {
    throw new Error(`google_token_refresh_failed:${tokenData.error || tokenRes.status}`);
  }

  const expiresAt = new Date(Date.now() + Math.max(60, Number(tokenData.expires_in || 3600) - 60) * 1000);
  await prisma.emailAccount.update({
    where: { id: acc.id },
    data: {
      oauthAccessToken: tokenData.access_token,
      oauthTokenExpiresAt: expiresAt,
      authType: 'GOOGLE_OAUTH',
      oauthProvider: 'GOOGLE',
    },
  });
  return tokenData.access_token as string;
}

export async function buildEmailImapAuth(acc: EmailImapAccount) {
  if (acc.authType === 'GOOGLE_OAUTH' || acc.oauthRefreshToken) {
    return { user: acc.email, accessToken: await getGoogleAccessToken(acc) };
  }
  if (!acc.password?.trim()) throw new Error('missing_email_password');
  return { user: acc.email, pass: acc.password };
}

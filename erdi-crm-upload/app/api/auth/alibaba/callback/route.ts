// app/api/auth/alibaba/callback/route.ts — 用 authorization_code 换 access_token
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { aliSign } from '@/lib/channels/oauth-tokens';
import { canonicalOrigin } from '@/lib/site-url';
import { consumeOAuthState } from '@/lib/oauth-state';

export const dynamic = 'force-dynamic';

const ALIBABA_GATEWAY = 'https://openapi-api.alibaba.com/rest';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const origin = canonicalOrigin();
  const oauthState = await consumeOAuthState('ALIBABA', searchParams.get('state'));
  if (!oauthState) return NextResponse.redirect(new URL('/settings/channels?error=invalid_oauth_state', origin));
  const code = searchParams.get('code');
  if (!code) return NextResponse.redirect(new URL('/settings/channels?error=no_code', origin));

  const s = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
  const appKey = s?.alibabaAppKey || process.env.ALIBABA_APP_KEY;
  const appSecret = s?.alibabaAppSecret || process.env.ALIBABA_APP_SECRET;
  if (!appKey || !appSecret) {
    return NextResponse.redirect(new URL('/settings/channels?error=missing_alibaba_app', origin));
  }

  try {
    const apiPath = '/auth/token/create';
    const params: Record<string, string> = {
      app_key: appKey,
      code,
      timestamp: String(Date.now()),
      sign_method: 'sha256',
    };
    const sign = aliSign(params, appSecret, apiPath);
    const res = await fetch(`${ALIBABA_GATEWAY}${apiPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...params, sign }).toString(),
      signal: AbortSignal.timeout(15000),
    });
    const data: any = await res.json();
    const accessToken = data.access_token || data.accessToken;
    if (!accessToken) {
      return NextResponse.redirect(
        new URL(`/settings/channels?error=${encodeURIComponent(JSON.stringify(data).slice(0, 200))}`, origin)
      );
    }
    const expiresInSec = Number(data.expires_in || data.expire_time || 86400);
    await prisma.systemSettings.update({
      where: { id: 'default' },
      data: {
        alibabaAccessToken: accessToken,
        alibabaRefreshToken: data.refresh_token || null,
        alibabaTokenExpiresAt: new Date(Date.now() + expiresInSec * 1000),
      },
    });
    await prisma.auditLog.create({ data: { actorId: oauthState.userId, action: 'channel.oauth_connect', entityType: 'Channel', entityId: 'ALIBABA', summary: 'Alibaba OAuth 授权完成' } });
    return NextResponse.redirect(new URL('/settings/channels?connected=alibaba', origin));
  } catch (e: any) {
    return NextResponse.redirect(
      new URL(`/settings/channels?error=${encodeURIComponent(String(e?.message || e).slice(0, 200))}`, origin)
    );
  }
}

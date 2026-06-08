// app/api/auth/amazon/callback/route.ts — 用 spapi_oauth_code 换 refresh_token(LWA)
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  // SP-API 授权回调参数：spapi_oauth_code、selling_partner_id
  const code = searchParams.get('spapi_oauth_code') || searchParams.get('code');
  const sellerId = searchParams.get('selling_partner_id');
  if (!code) return NextResponse.redirect(new URL('/settings/channels?error=no_code', req.url));

  const s = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
  const clientId = s?.amazonLwaClientId || process.env.AMAZON_LWA_CLIENT_ID;
  const clientSecret = s?.amazonLwaClientSecret || process.env.AMAZON_LWA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL('/settings/channels?error=missing_amazon_lwa', req.url));
  }

  const origin = new URL(req.url).origin;
  const redirectUri = `${origin}/api/auth/amazon/callback`;

  try {
    const res = await fetch(LWA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
      signal: AbortSignal.timeout(15000),
    });
    const data: any = await res.json();
    if (!data.refresh_token) {
      return NextResponse.redirect(
        new URL(`/settings/channels?error=${encodeURIComponent(JSON.stringify(data).slice(0, 200))}`, req.url)
      );
    }
    await prisma.systemSettings.update({
      where: { id: 'default' },
      data: {
        amazonRefreshToken: data.refresh_token,
        ...(sellerId ? { amazonSellerId: sellerId } : {}),
      },
    });
    return NextResponse.redirect(new URL('/settings/channels?connected=amazon', req.url));
  } catch (e: any) {
    return NextResponse.redirect(
      new URL(`/settings/channels?error=${encodeURIComponent(String(e?.message || e).slice(0, 200))}`, req.url)
    );
  }
}

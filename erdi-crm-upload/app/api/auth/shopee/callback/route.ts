// app/api/auth/shopee/callback/route.ts — 用 code + shop_id 换 access_token
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const shopId = searchParams.get('shop_id');
  if (!code || !shopId) {
    return NextResponse.redirect(new URL('/settings/channels?error=no_code_or_shop', req.url));
  }

  const s = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
  const partnerId = s?.shopeePartnerId || process.env.SHOPEE_PARTNER_ID;
  const partnerKey = s?.shopeePartnerKey || process.env.SHOPEE_PARTNER_KEY;
  if (!partnerId || !partnerKey) {
    return NextResponse.redirect(new URL('/settings/channels?error=missing_shopee_partner', req.url));
  }
  const base = s?.shopeeRegion || 'https://partner.shopeemobile.com';

  try {
    const apiPath = '/api/v2/auth/token/get';
    const ts = Math.floor(Date.now() / 1000);
    const baseString = `${partnerId}${apiPath}${ts}`;
    const sign = crypto.createHmac('sha256', partnerKey).update(baseString, 'utf8').digest('hex');
    const url = `${base}${apiPath}?partner_id=${partnerId}&timestamp=${ts}&sign=${sign}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, shop_id: Number(shopId), partner_id: Number(partnerId) }),
      signal: AbortSignal.timeout(15000),
    });
    const data: any = await res.json();
    if (!data.access_token) {
      return NextResponse.redirect(
        new URL(`/settings/channels?error=${encodeURIComponent(JSON.stringify(data).slice(0, 200))}`, req.url)
      );
    }
    const expireSec = Number(data.expire_in || 14400);
    await prisma.systemSettings.update({
      where: { id: 'default' },
      data: {
        shopeeShopId: shopId,
        shopeeAccessToken: data.access_token,
        shopeeRefreshToken: data.refresh_token || null,
        shopeeTokenExpiresAt: new Date(Date.now() + expireSec * 1000),
      },
    });
    return NextResponse.redirect(new URL('/settings/channels?connected=shopee', req.url));
  } catch (e: any) {
    return NextResponse.redirect(
      new URL(`/settings/channels?error=${encodeURIComponent(String(e?.message || e).slice(0, 200))}`, req.url)
    );
  }
}

// app/api/auth/shopee/start/route.ts — 跳转 Shopee 店铺授权页
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { canonicalOrigin } from '@/lib/site-url';
import crypto from 'crypto';
import { getSession } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { createOAuthState } from '@/lib/oauth-state';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || !can(session.role, 'channels.configure')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const s = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
  const partnerId = s?.shopeePartnerId || process.env.SHOPEE_PARTNER_ID;
  const partnerKey = s?.shopeePartnerKey || process.env.SHOPEE_PARTNER_KEY;
  if (!partnerId || !partnerKey) {
    return NextResponse.json({ error: '请先配置 Shopee Partner ID / Partner Key' }, { status: 400 });
  }
  const base = s?.shopeeRegion || 'https://partner.shopeemobile.com';
  const redirectUri = `${canonicalOrigin()}/api/auth/shopee/callback`;
  const state = await createOAuthState('SHOPEE', session);

  const apiPath = '/api/v2/shop/auth_partner';
  const ts = Math.floor(Date.now() / 1000);
  const baseString = `${partnerId}${apiPath}${ts}`;
  const sign = crypto.createHmac('sha256', partnerKey).update(baseString, 'utf8').digest('hex');

  const url =
    `${base}${apiPath}?partner_id=${partnerId}&timestamp=${ts}&sign=${sign}` +
    `&redirect=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
  return NextResponse.redirect(url);
}

// app/api/auth/amazon/start/route.ts — 跳转 Amazon Seller Central 授权(LWA)
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// SP-API 授权入口(以卖家中心 appstore 授权为主)。需在开发者后台填好应用 ID。
// 这里走 LWA 授权码模式：跳到 Amazon 登录授权页 → 回 callback 带 spapi_oauth_code。
export async function GET(req: Request) {
  const s = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
  const appId = process.env.AMAZON_APP_ID || s?.amazonLwaClientId;
  if (!appId) {
    return NextResponse.json({ error: '请先配置 Amazon 应用(LWA Client ID / App ID)' }, { status: 400 });
  }
  const origin = new URL(req.url).origin;
  const redirectUri = `${origin}/api/auth/amazon/callback`;
  const state = Math.random().toString(36).slice(2);
  // 卖家授权页(北美站示例)；其它站点域名不同，凭据到位后按 region 调整。
  const url =
    `https://sellercentral.amazon.com/apps/authorize/consent` +
    `?application_id=${encodeURIComponent(appId)}` +
    `&state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}&version=beta`;
  return NextResponse.redirect(url);
}

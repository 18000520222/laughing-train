// app/api/auth/alibaba/start/route.ts — 跳转阿里国际站授权页
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const s = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
  const appKey = s?.alibabaAppKey || process.env.ALIBABA_APP_KEY;
  if (!appKey) {
    return NextResponse.json({ error: '请先在设置中配置 Alibaba AppKey/AppSecret' }, { status: 400 });
  }
  const origin = new URL(req.url).origin;
  const redirectUri = `${origin}/api/auth/alibaba/callback`;
  // 国际站新版授权地址(consumer 授权)
  const url =
    `https://openapi-auth.alibaba.com/oauth/authorize` +
    `?response_type=code&force_auth=true&redirect_uri=${encodeURIComponent(redirectUri)}&client_id=${encodeURIComponent(appKey)}`;
  return NextResponse.redirect(url);
}

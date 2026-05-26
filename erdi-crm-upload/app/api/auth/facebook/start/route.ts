// app/api/auth/facebook/start/route.ts
import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET(req: Request) {
  const settings = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
  const appId = settings?.fbAppId || process.env.FB_APP_ID;
  if (!appId) {
    return NextResponse.json({ error: '请先在设置中配置 FB_APP_ID' }, { status: 400 });
  }

  const origin = new URL(req.url).origin;
  const redirectUri = `${origin}/api/auth/facebook/callback`;
  const scope = [
    'public_profile',
    'email',
    'pages_show_list',
    'pages_messaging',
    'pages_manage_metadata',
    'pages_read_engagement',
  ].join(',');

  const state = Math.random().toString(36).slice(2);
  const url = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${state}&response_type=code`;
  return NextResponse.redirect(url);
}

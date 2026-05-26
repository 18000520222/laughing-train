// app/api/auth/linkedin/start/route.ts
import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET(req: Request) {
  const settings = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
  const clientId = settings?.linkedinClientId || process.env.LINKEDIN_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: '请先在设置中配置 LinkedIn Client ID' }, { status: 400 });
  }

  const origin = new URL(req.url).origin;
  const redirectUri = `${origin}/api/auth/linkedin/callback`;
  const scope = 'openid profile email r_organization_social rw_organization_admin r_ads_leadgen_automation';
  const state = Math.random().toString(36).slice(2);

  const url = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&scope=${encodeURIComponent(scope)}`;
  return NextResponse.redirect(url);
}

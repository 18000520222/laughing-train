// app/api/auth/linkedin/start/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { canonicalOrigin } from '@/lib/site-url';
import { getSession } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { createOAuthState } from '@/lib/oauth-state';



export async function GET(req: Request) {
  const session = await getSession();
  if (!session || !can(session.role, 'channels.configure')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const settings = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
  const clientId = settings?.linkedinClientId || process.env.LINKEDIN_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: '请先在设置中配置 LinkedIn Client ID' }, { status: 400 });
  }

  const redirectUri = `${canonicalOrigin()}/api/auth/linkedin/callback`;
  const scope = process.env.LINKEDIN_APPROVED_OAUTH_SCOPE || 'openid profile email';
  const state = await createOAuthState('LINKEDIN', session);

  const url = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&scope=${encodeURIComponent(scope)}`;
  return NextResponse.redirect(url);
}

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { canonicalOrigin } from '@/lib/site-url';
import { getSession } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { createOAuthState } from '@/lib/oauth-state';

export async function GET() {
  const session = await getSession();
  if (!session || !can(session.role, 'channels.configure')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const settings = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
  const clientId = settings?.googleClientId || process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: '请先在渠道设置中配置 Google OAuth Client ID' }, { status: 400 });
  }

  const redirectUri = `${canonicalOrigin()}/api/auth/google/callback`;
  const state = await createOAuthState('GOOGLE', session);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
    scope: [
      'openid',
      'email',
      'profile',
      'https://mail.google.com/',
    ].join(' '),
  });

  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}

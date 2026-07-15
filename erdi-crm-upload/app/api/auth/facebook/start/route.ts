// app/api/auth/facebook/start/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { canonicalOrigin } from '@/lib/site-url';
import { getSession } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { createOAuthState } from '@/lib/oauth-state';



export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || !can(session.role, 'channels.configure')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const settings = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
  const appId = settings?.fbAppId || process.env.FB_APP_ID;
  if (!appId) {
    return NextResponse.json({ error: '请先在设置中配置 FB_APP_ID' }, { status: 400 });
  }

  const redirectUri = `${canonicalOrigin()}/api/auth/facebook/callback`;
  const state = await createOAuthState('FACEBOOK', session);
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    state,
    response_type: 'code',
  });

  const configId = process.env.FB_CONFIG_ID?.trim();
  if (configId) {
    // Facebook Login for Business defines permissions in the Meta configuration.
    params.set('config_id', configId);
  } else {
    params.set('scope', [
      'public_profile',
      'email',
      'pages_show_list',
      'pages_messaging',
      'pages_manage_metadata',
      'pages_read_engagement',
    ].join(','));
  }

  const url = `https://www.facebook.com/v18.0/dialog/oauth?${params.toString()}`;
  return NextResponse.redirect(url);
}

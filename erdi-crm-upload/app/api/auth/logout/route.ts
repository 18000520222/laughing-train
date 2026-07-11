import { NextResponse } from 'next/server';
import { authCookieDomain } from '@/lib/auth';
import { canonicalOrigin } from '@/lib/site-url';

export const dynamic = 'force-dynamic';

const COOKIES = ['erdi_session', 'auth_userId', 'auth_role', 'auth_email', 'auth_name'];

export async function GET() {
  const url = new URL('/', canonicalOrigin());
  const res = NextResponse.redirect(url);
  const domain = authCookieDomain();
  for (const name of COOKIES) {
    res.cookies.set(name, '', { path: '/', maxAge: 0 });
    if (domain) res.cookies.set(name, '', { path: '/', domain, maxAge: 0 });
  }
  return res;
}

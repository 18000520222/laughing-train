import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const COOKIES = ['erdi_session', 'auth_userId', 'auth_role', 'auth_email', 'auth_name'];

export async function GET(req: NextRequest) {
  const url = new URL('/', req.url);
  const res = NextResponse.redirect(url);
  for (const name of COOKIES) {
    res.cookies.set(name, '', { path: '/', maxAge: 0 });
  }
  return res;
}

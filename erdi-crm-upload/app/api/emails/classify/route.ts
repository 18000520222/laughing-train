import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { reclassifyEmailMessages } from '@/lib/email-audit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const role = (cookies().get('auth_role')?.value || '').toUpperCase();
  if (role === 'SUPER_ADMIN' || role === 'ADMIN') return true;
  const { searchParams } = new URL(req.url);
  if (searchParams.get('key') === (process.env.MAIL_CRON_KEY || 'erdi-mail-2026')) return true;
  const auth = req.headers.get('authorization') || '';
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  return false;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '500', 10) || 500, 1), 2000);
  const includeClassified = searchParams.get('all') === '1';

  const result = await reclassifyEmailMessages({ limit, includeClassified });

  return NextResponse.json({
    ok: true,
    ...result,
  });
}

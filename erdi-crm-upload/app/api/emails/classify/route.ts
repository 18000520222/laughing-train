import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { reclassifyEmailMessages } from '@/lib/email-audit';
import { isCronAuthorized } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const role = (cookies().get('auth_role')?.value || '').toUpperCase();
  if (role === 'SUPER_ADMIN' || role === 'ADMIN') return true;
  return isCronAuthorized(req, [process.env.MAIL_CRON_KEY], ['erdi-mail-2026']);
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '500', 10) || 500, 1), 2000);
  const includeClassified = searchParams.get('all') === '1';
  const dryRun = ['1', 'true', 'yes'].includes((searchParams.get('dryRun') || '').toLowerCase());
  const order = searchParams.get('order') === 'asc' ? 'asc' : 'desc';
  const updateLimitParam = searchParams.get('updateLimit');
  const updateLimit = updateLimitParam ? Math.min(Math.max(parseInt(updateLimitParam, 10) || limit, 1), limit) : undefined;

  const result = await reclassifyEmailMessages({ limit, includeClassified, dryRun, order, updateLimit });

  return NextResponse.json({
    ok: true,
    ...result,
  });
}

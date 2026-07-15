import { NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/cron-auth';
import { scanHistoricalSalesEmails } from '@/lib/email-sales-automation';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!isCronAuthorized(req, [process.env.MAIL_CRON_KEY])) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const params = new URL(req.url).searchParams;
  const apply = params.get('apply') === '1';
  const confirm = params.get('confirm');
  if (apply && confirm !== 'EMAIL_HISTORY_APPLY') {
    return NextResponse.json({ error: 'apply requires confirm=EMAIL_HISTORY_APPLY' }, { status: 400 });
  }
  const limit = Math.max(1, Math.min(Number(params.get('limit') || 500), 5000));
  const result = await scanHistoricalSalesEmails({ apply, limit });
  return NextResponse.json({ ok: true, ...result });
}

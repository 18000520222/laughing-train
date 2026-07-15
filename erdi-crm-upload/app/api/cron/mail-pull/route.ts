import { NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/cron-auth';
import { syncAllEmailAccounts } from '@/lib/email-sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!isCronAuthorized(req, [process.env.MAIL_CRON_KEY])) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const params = new URL(req.url).searchParams;
  const result = await syncAllEmailAccounts({
    lookback: numberParam(params.get('lookback'), 200, 10, 1000),
    maxFetchPerAccount: numberParam(params.get('max'), 200, 1, 1000),
    historyBatch: numberParam(params.get('history'), 50, 0, 500),
    backlogLimit: numberParam(params.get('backlog'), 50, 1, 500),
    enrich: params.get('enrich') === '1',
    automations: params.get('automations') === '1',
    notifications: params.get('notifications') !== '0',
  });

  const failed = result.accounts.some((account) => account.errors.length > 0 || account.folders.some((folder) => folder.errors.length > 0)) || result.backlog.failed > 0;
  return NextResponse.json({ ok: !failed, ...result }, { status: failed ? 207 : 200 });
}

function numberParam(value: string | null, fallback: number, min: number, max: number) {
  if (value === null || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

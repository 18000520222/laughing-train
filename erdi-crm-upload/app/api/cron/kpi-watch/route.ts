import { NextRequest, NextResponse } from 'next/server';
import { generateKpiRecoveryTasks, monthStart, parseMonth } from '@/lib/sales-kpi-watch';
import { isCronAuthorized } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const KPI_WATCH_KEY = process.env.KPI_WATCH_KEY || process.env.TASK_REMINDER_KEY || process.env.MAIL_CRON_KEY;

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req, [KPI_WATCH_KEY], ['erdi-mail-2026'])) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const period = parseMonth(req.nextUrl.searchParams.get('period') || '') || monthStart(new Date());
  const ownerId = req.nextUrl.searchParams.get('ownerId') || undefined;
  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '50', 10) || 50;
  const result = await generateKpiRecoveryTasks({ periodStart: period, ownerId, limit });
  return NextResponse.json({ ok: true, ts: new Date().toISOString(), ...result });
}

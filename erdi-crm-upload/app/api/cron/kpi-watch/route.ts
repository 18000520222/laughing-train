import { NextRequest, NextResponse } from 'next/server';
import { generateKpiRecoveryTasks, monthStart, parseMonth } from '@/lib/sales-kpi-watch';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const KPI_WATCH_KEY = process.env.KPI_WATCH_KEY || process.env.TASK_REMINDER_KEY || process.env.MAIL_CRON_KEY || 'erdi-mail-2026';

function authorized(req: NextRequest): boolean {
  if (req.nextUrl.searchParams.get('key') === KPI_WATCH_KEY) return true;
  const auth = req.headers.get('authorization') || '';
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  return false;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const period = parseMonth(req.nextUrl.searchParams.get('period') || '') || monthStart(new Date());
  const ownerId = req.nextUrl.searchParams.get('ownerId') || undefined;
  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '50', 10) || 50;
  const result = await generateKpiRecoveryTasks({ periodStart: period, ownerId, limit });
  return NextResponse.json({ ok: true, ts: new Date().toISOString(), ...result });
}

import { NextRequest, NextResponse } from 'next/server';
import { escalateOverdueSalesTasks } from '@/lib/sales-task-escalations';
import { isCronAuthorized } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TASK_ESCALATION_KEY = process.env.TASK_ESCALATION_KEY || process.env.TASK_REMINDER_KEY || process.env.MAIL_CRON_KEY;

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req, [TASK_ESCALATION_KEY])) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const hoursParam = req.nextUrl.searchParams.get('hours');
  const thresholdHours = hoursParam ? parseInt(hoursParam, 10) || undefined : undefined;
  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '100', 10) || 100;
  const result = await escalateOverdueSalesTasks({ thresholdHours, limit });
  return NextResponse.json({ ok: true, ts: new Date().toISOString(), ...result });
}

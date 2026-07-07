import { NextRequest, NextResponse } from 'next/server';
import { sendSalesTaskReminders } from '@/lib/sales-task-reminders';
import { isCronAuthorized } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const TASK_REMINDER_KEY = process.env.TASK_REMINDER_KEY || process.env.MAIL_CRON_KEY;

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req, [TASK_REMINDER_KEY], ['erdi-mail-2026'])) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '100', 10) || 100;
  const result = await sendSalesTaskReminders({ limit });
  return NextResponse.json({ ok: true, ts: new Date().toISOString(), ...result });
}

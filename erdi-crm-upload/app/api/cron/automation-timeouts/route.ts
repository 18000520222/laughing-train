import { NextRequest, NextResponse } from 'next/server';
import { runNoReplyTimeoutAutomations } from '@/lib/automation-runner';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const AUTOMATION_TIMEOUT_KEY =
  process.env.AUTOMATION_TIMEOUT_KEY ||
  process.env.TASK_RHYTHM_KEY ||
  process.env.TASK_REMINDER_KEY ||
  process.env.MAIL_CRON_KEY ||
  'erdi-mail-2026';

function authorized(req: NextRequest): boolean {
  if (req.nextUrl.searchParams.get('key') === AUTOMATION_TIMEOUT_KEY) return true;
  const auth = req.headers.get('authorization') || '';
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  return false;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const limit = Math.max(1, Math.min(200, parseInt(req.nextUrl.searchParams.get('limit') || '100', 10) || 100));
  const result = await runNoReplyTimeoutAutomations({ limit });
  return NextResponse.json({ ok: true, ts: new Date().toISOString(), ...result });
}

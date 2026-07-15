import { NextRequest, NextResponse } from 'next/server';
import { runNoReplyTimeoutAutomations } from '@/lib/automation-runner';
import { isCronAuthorized } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const AUTOMATION_TIMEOUT_KEY =
  process.env.AUTOMATION_TIMEOUT_KEY ||
  process.env.TASK_RHYTHM_KEY ||
  process.env.TASK_REMINDER_KEY ||
  process.env.MAIL_CRON_KEY;

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req, [AUTOMATION_TIMEOUT_KEY])) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const limit = Math.max(1, Math.min(200, parseInt(req.nextUrl.searchParams.get('limit') || '100', 10) || 100));
  const result = await runNoReplyTimeoutAutomations({ limit });
  return NextResponse.json({ ok: true, ts: new Date().toISOString(), ...result });
}

import { NextRequest, NextResponse } from 'next/server';
import { runAutomationHealthWatch } from '@/lib/automation-health-watch';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const AUTOMATION_HEALTH_KEY =
  process.env.AUTOMATION_HEALTH_KEY ||
  process.env.AUTOMATION_TIMEOUT_KEY ||
  process.env.TASK_RHYTHM_KEY ||
  process.env.MAIL_CRON_KEY ||
  'erdi-mail-2026';

function authorized(req: NextRequest): boolean {
  if (req.nextUrl.searchParams.get('key') === AUTOMATION_HEALTH_KEY) return true;
  const auth = req.headers.get('authorization') || '';
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  return false;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const limit = Math.max(1, Math.min(50, parseInt(req.nextUrl.searchParams.get('limit') || '20', 10) || 20));
  const result = await runAutomationHealthWatch({ limit });
  return NextResponse.json({ ok: true, ts: new Date().toISOString(), ...result });
}

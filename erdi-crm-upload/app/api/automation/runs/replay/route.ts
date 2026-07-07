import { NextRequest, NextResponse } from 'next/server';
import { replayAutomationRun } from '@/lib/automation-runner';
import { isCronAuthorized } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const AUTOMATION_REPLAY_KEY =
  process.env.AUTOMATION_REPLAY_KEY ||
  process.env.AUTOMATION_BOOTSTRAP_KEY ||
  process.env.AUTOMATION_HEALTH_KEY ||
  process.env.MAIL_CRON_KEY;

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req, [AUTOMATION_REPLAY_KEY], ['erdi-mail-2026'])) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const runId = req.nextUrl.searchParams.get('runId') || '';
  if (!runId) return NextResponse.json({ error: 'runId required' }, { status: 400 });

  const userId = req.nextUrl.searchParams.get('userId') || undefined;
  const result = await replayAutomationRun(runId, { userId });
  return NextResponse.json({ ts: new Date().toISOString(), ...result }, { status: result.ok ? 200 : 400 });
}

export async function POST(req: NextRequest) {
  return GET(req);
}

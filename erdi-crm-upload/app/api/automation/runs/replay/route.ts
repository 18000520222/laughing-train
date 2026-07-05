import { NextRequest, NextResponse } from 'next/server';
import { replayAutomationRun } from '@/lib/automation-runner';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const AUTOMATION_REPLAY_KEY =
  process.env.AUTOMATION_REPLAY_KEY ||
  process.env.AUTOMATION_BOOTSTRAP_KEY ||
  process.env.AUTOMATION_HEALTH_KEY ||
  process.env.MAIL_CRON_KEY ||
  'erdi-mail-2026';

function authorized(req: NextRequest): boolean {
  if (req.nextUrl.searchParams.get('key') === AUTOMATION_REPLAY_KEY) return true;
  const auth = req.headers.get('authorization') || '';
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  return false;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
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

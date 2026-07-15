import { NextRequest, NextResponse } from 'next/server';
import { bulkReplayFailedAutomationRuns, listFailedAutomationReplayQueue } from '@/lib/automation-runner';
import { isCronAuthorized } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const AUTOMATION_REPLAY_KEY =
  process.env.AUTOMATION_REPLAY_KEY ||
  process.env.AUTOMATION_BOOTSTRAP_KEY ||
  process.env.AUTOMATION_HEALTH_KEY ||
  process.env.MAIL_CRON_KEY;

function readParams(req: NextRequest) {
  const limit = Number(req.nextUrl.searchParams.get('limit') || 20);
  const flowId = req.nextUrl.searchParams.get('flowId') || undefined;
  const userId = req.nextUrl.searchParams.get('userId') || undefined;
  const dryRun = ['1', 'true', 'yes'].includes((req.nextUrl.searchParams.get('dryRun') || '').toLowerCase());
  return { limit, flowId, userId, dryRun };
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req, [AUTOMATION_REPLAY_KEY])) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const params = readParams(req);
  const queue = await listFailedAutomationReplayQueue({ limit: params.limit, flowId: params.flowId });
  const preview = params.dryRun ? await bulkReplayFailedAutomationRuns({ ...params, dryRun: true }) : null;
  return NextResponse.json({ ts: new Date().toISOString(), ok: true, dryRun: Boolean(preview), queue, preview });
}

export async function POST(req: NextRequest) {
  if (!isCronAuthorized(req, [AUTOMATION_REPLAY_KEY])) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const params = readParams(req);
  const result = await bulkReplayFailedAutomationRuns({ ...params, dryRun: params.dryRun });
  return NextResponse.json({ ts: new Date().toISOString(), ...result }, { status: result.ok ? 200 : 400 });
}

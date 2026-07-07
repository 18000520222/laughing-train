import { NextRequest, NextResponse } from 'next/server';
import { runEmailActionAutopilot } from '@/lib/email-actions';
import { isCronAuthorized } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const EMAIL_ACTION_KEY = process.env.EMAIL_ACTION_AUTOPILOT_KEY || process.env.MAIL_CRON_KEY;

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req, [EMAIL_ACTION_KEY], ['erdi-mail-2026'])) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const dryRun = req.nextUrl.searchParams.get('apply') !== '1';
  const taskLimit = intParam(req, 'taskLimit', 20);
  const noiseLimit = intParam(req, 'noiseLimit', 50);
  const sinceDays = intParam(req, 'sinceDays', 30);

  const result = await runEmailActionAutopilot({ dryRun, taskLimit, noiseLimit, sinceDays });
  return NextResponse.json({ ok: true, ts: new Date().toISOString(), ...result });
}

function intParam(req: NextRequest, key: string, fallback: number) {
  const raw = req.nextUrl.searchParams.get(key);
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

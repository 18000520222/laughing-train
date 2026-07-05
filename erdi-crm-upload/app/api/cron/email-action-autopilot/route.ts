import { NextRequest, NextResponse } from 'next/server';
import { runEmailActionAutopilot } from '@/lib/email-actions';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const EMAIL_ACTION_KEY = process.env.EMAIL_ACTION_AUTOPILOT_KEY || process.env.MAIL_CRON_KEY || 'erdi-mail-2026';

function authorized(req: NextRequest): boolean {
  if (req.nextUrl.searchParams.get('key') === EMAIL_ACTION_KEY) return true;
  const auth = req.headers.get('authorization') || '';
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  return false;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
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

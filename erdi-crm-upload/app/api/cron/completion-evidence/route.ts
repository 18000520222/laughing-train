import { NextRequest, NextResponse } from 'next/server';
import { runCompletionEvidenceRepairWatch } from '@/lib/sales-completion-evidence-repair';
import { isCronAuthorized } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const COMPLETION_EVIDENCE_KEY = process.env.COMPLETION_EVIDENCE_KEY || process.env.TASK_REMINDER_KEY || process.env.MAIL_CRON_KEY;

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req, [COMPLETION_EVIDENCE_KEY], ['erdi-mail-2026'])) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const limit = intParam(req, 'limit', 30);
  const sinceDays = intParam(req, 'sinceDays', 30);
  const result = await runCompletionEvidenceRepairWatch({ limit, sinceDays });
  return NextResponse.json({ ok: true, ts: new Date().toISOString(), ...result });
}

function intParam(req: NextRequest, key: string, fallback: number) {
  const raw = req.nextUrl.searchParams.get(key);
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

import { NextRequest, NextResponse } from 'next/server';
import { escalateStaleCompletionEvidenceRepairs } from '@/lib/sales-completion-evidence-repair';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const COMPLETION_EVIDENCE_ESCALATION_KEY =
  process.env.COMPLETION_EVIDENCE_ESCALATION_KEY || process.env.COMPLETION_EVIDENCE_KEY || process.env.TASK_ESCALATION_KEY || process.env.TASK_REMINDER_KEY || process.env.MAIL_CRON_KEY || 'erdi-mail-2026';

function authorized(req: NextRequest): boolean {
  if (req.nextUrl.searchParams.get('key') === COMPLETION_EVIDENCE_ESCALATION_KEY) return true;
  const auth = req.headers.get('authorization') || '';
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  return false;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const limit = intParam(req, 'limit', 50);
  const thresholdHours = intParam(req, 'thresholdHours', 12);
  const result = await escalateStaleCompletionEvidenceRepairs({ limit, thresholdHours });
  return NextResponse.json({ ok: true, ts: new Date().toISOString(), ...result });
}

function intParam(req: NextRequest, key: string, fallback: number) {
  const raw = req.nextUrl.searchParams.get(key);
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

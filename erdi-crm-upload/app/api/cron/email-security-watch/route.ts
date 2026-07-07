import { NextRequest, NextResponse } from 'next/server';
import { buildEmailSecurityAudit, runEmailSecurityWatch } from '@/lib/email-security-audit';
import { isCronAuthorized } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const EMAIL_SECURITY_KEY = process.env.EMAIL_SECURITY_WATCH_KEY || process.env.MAIL_CRON_KEY;

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req, [EMAIL_SECURITY_KEY], ['erdi-mail-2026'])) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const dryRun = req.nextUrl.searchParams.get('apply') !== '1';
  const limit = intParam(req, 'limit', 50);
  const watch = await runEmailSecurityWatch({ dryRun, limit });
  const audit = await buildEmailSecurityAudit({ sampleLimit: 8 });
  return NextResponse.json({ ok: true, ts: new Date().toISOString(), ...watch, audit });
}

function intParam(req: NextRequest, key: string, fallback: number) {
  const raw = req.nextUrl.searchParams.get(key);
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

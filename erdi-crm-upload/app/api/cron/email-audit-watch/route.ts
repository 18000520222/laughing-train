import { NextRequest, NextResponse } from 'next/server';
import { runEmailAuditWatch } from '@/lib/email-audit-watch';
import { isCronAuthorized } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const EMAIL_AUDIT_WATCH_KEY = process.env.EMAIL_AUDIT_WATCH_KEY || process.env.MAIL_CRON_KEY;

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req, [EMAIL_AUDIT_WATCH_KEY], ['erdi-mail-2026'])) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '100', 10) || 100;
  const result = await runEmailAuditWatch({ limit });
  return NextResponse.json({ ok: true, ts: new Date().toISOString(), ...result });
}

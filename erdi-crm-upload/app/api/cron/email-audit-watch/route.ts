import { NextRequest, NextResponse } from 'next/server';
import { runEmailAuditWatch } from '@/lib/email-audit-watch';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const EMAIL_AUDIT_WATCH_KEY = process.env.EMAIL_AUDIT_WATCH_KEY || process.env.MAIL_CRON_KEY || 'erdi-mail-2026';

function authorized(req: NextRequest): boolean {
  if (req.nextUrl.searchParams.get('key') === EMAIL_AUDIT_WATCH_KEY) return true;
  const auth = req.headers.get('authorization') || '';
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  return false;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '100', 10) || 100;
  const result = await runEmailAuditWatch({ limit });
  return NextResponse.json({ ok: true, ts: new Date().toISOString(), ...result });
}

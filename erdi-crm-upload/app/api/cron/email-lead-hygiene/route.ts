import { NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/cron-auth';
import { auditAndRepairEmailLeadHygiene } from '@/lib/email-lead-hygiene';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!isCronAuthorized(req, [process.env.MAIL_CRON_KEY])) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const params = new URL(req.url).searchParams;
  const apply = params.get('apply') === '1';
  if (apply && params.get('confirm') !== 'EMAIL_LEAD_HYGIENE') {
    return NextResponse.json({ error: 'apply requires confirm=EMAIL_LEAD_HYGIENE' }, { status: 400 });
  }
  const limit = Math.max(1, Math.min(Number(params.get('limit')) || 5000, 10000));
  const result = await auditAndRepairEmailLeadHygiene({ apply, limit });
  return NextResponse.json({ ok: true, ...result });
}

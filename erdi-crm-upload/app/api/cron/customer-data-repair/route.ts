import { NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/cron-auth';
import { auditAndRepairCustomerData } from '@/lib/customer-data-repair';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!isCronAuthorized(req, [process.env.MAIL_CRON_KEY])) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const params = new URL(req.url).searchParams;
  const apply = params.get('apply') === '1';
  if (apply && params.get('confirm') !== 'CUSTOMER_DATA_REPAIR') {
    return NextResponse.json({ error: 'apply requires confirm=CUSTOMER_DATA_REPAIR' }, { status: 400 });
  }
  const result = await auditAndRepairCustomerData({ apply });
  return NextResponse.json({ ok: true, ...result });
}

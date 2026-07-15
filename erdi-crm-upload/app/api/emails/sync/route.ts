import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { syncAllEmailAccounts } from '@/lib/email-sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST() {
  const role = (cookies().get('auth_role')?.value || '').toUpperCase();
  if (!['SUPER_ADMIN', 'ADMIN', 'SALES'].includes(role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await syncAllEmailAccounts({ lookback: 200, maxFetchPerAccount: 200, historyBatch: 100, backlogLimit: 100 });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message.slice(0, 500) }, { status: 500 });
  }
}

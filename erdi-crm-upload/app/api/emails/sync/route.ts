import { NextResponse } from 'next/server';
import { syncAllEmailAccounts } from '@/lib/email-sync';
import { getSession } from '@/lib/auth';
import { can } from '@/lib/permissions';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST() {
  const session = await getSession();
  if (!session || !can(session.role, 'inbox.manage')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const result = await syncAllEmailAccounts({ lookback: 200, maxFetchPerAccount: 200, historyBatch: 100, backlogLimit: 100 });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message.slice(0, 500) }, { status: 500 });
  }
}

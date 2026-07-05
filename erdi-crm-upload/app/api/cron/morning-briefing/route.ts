import { NextRequest, NextResponse } from 'next/server';
import { buildSalesMorningBriefingFromDatabase, firstMorningBriefingItemIds, sendMorningBriefingNotifications } from '@/lib/sales-morning-briefing-watch';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MORNING_BRIEFING_KEY = process.env.MORNING_BRIEFING_KEY || process.env.TASK_REMINDER_KEY || process.env.MAIL_CRON_KEY || 'erdi-mail-2026';

function authorized(req: NextRequest): boolean {
  if (req.nextUrl.searchParams.get('key') === MORNING_BRIEFING_KEY) return true;
  const auth = req.headers.get('authorization') || '';
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  return false;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const mode = req.nextUrl.searchParams.get('mode') || 'top';
  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '20', 10) || 20;
  const { queue, ownerReport, briefing } = await buildSalesMorningBriefingFromDatabase();
  const itemIds = firstMorningBriefingItemIds({ topItemIds: briefing.topItemIds, urgentItemIds: briefing.urgentItemIds, mode });
  const notifyResult = await sendMorningBriefingNotifications({ itemIds, limit });

  return NextResponse.json({
    ok: true,
    ts: new Date().toISOString(),
    mode,
    urgentCount: briefing.urgentCount,
    ownerCount: briefing.ownerCount,
    revenueAtRisk: briefing.revenueAtRisk,
    queueItems: queue.items.length,
    ownerRows: ownerReport.rows.length,
    itemIds: itemIds.length,
    ...notifyResult,
  });
}

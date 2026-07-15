import { NextRequest, NextResponse } from 'next/server';
import { buildSalesMorningBriefingFromDatabase, firstMorningBriefingItemIds, sendMorningBriefingNotifications } from '@/lib/sales-morning-briefing-watch';
import { isCronAuthorized } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MORNING_BRIEFING_KEY = process.env.MORNING_BRIEFING_KEY || process.env.TASK_REMINDER_KEY || process.env.MAIL_CRON_KEY;

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req, [MORNING_BRIEFING_KEY])) {
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

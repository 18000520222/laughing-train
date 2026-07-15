import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { buildGmailLabelPlanAudit, buildGmailLabelPlanStats, buildGmailLabelReadiness } from '@/lib/email-label-plan';
import { isCronAuthorized } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';

const EMAIL_LABEL_PLAN_KEY =
  process.env.EMAIL_LABEL_PLAN_KEY ||
  process.env.EMAIL_AUDIT_WATCH_KEY ||
  process.env.MAIL_CRON_KEY;

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req, [EMAIL_LABEL_PLAN_KEY])) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const [activeAccountCount, totalMessages, categoryRows, lowConfidenceRows] = await Promise.all([
    prisma.emailAccount.count({ where: { isActive: true } }),
    prisma.emailMessage.count(),
    prisma.emailMessage.groupBy({
      by: ['category', 'actionRequired', 'isLead'],
      _count: { _all: true },
      _min: { date: true },
      _max: { date: true },
    }),
    prisma.emailMessage.groupBy({
      by: ['category'],
      where: { classificationScore: { lt: 50 } },
      _count: { _all: true },
    }),
  ]);
  const plans = buildGmailLabelPlanAudit({ stats: buildGmailLabelPlanStats(categoryRows, lowConfidenceRows) });

  return NextResponse.json({
    ok: true,
    ts: new Date().toISOString(),
    activeAccountCount,
    totalMessages,
    readiness: buildGmailLabelReadiness({ activeAccountCount, totalMessages }),
    summary: {
      taskLabels: plans.filter((row) => row.executionMode === 'task').length,
      reviewLabels: plans.filter((row) => row.executionMode === 'review').length,
      archiveLabels: plans.filter((row) => row.executionMode === 'archive').length,
      messagesCovered: plans.reduce((sum, row) => sum + row.messageCount, 0),
      actionRequired: plans.reduce((sum, row) => sum + row.actionRequiredCount, 0),
    },
    plans,
  });
}

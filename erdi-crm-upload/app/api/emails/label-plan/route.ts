import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { buildGmailLabelReadiness, labelPlanWithLabels } from '@/lib/email-label-plan';

export const dynamic = 'force-dynamic';

const EMAIL_LABEL_PLAN_KEY =
  process.env.EMAIL_LABEL_PLAN_KEY ||
  process.env.EMAIL_AUDIT_WATCH_KEY ||
  process.env.MAIL_CRON_KEY ||
  'erdi-mail-2026';

function authorized(req: NextRequest): boolean {
  if (req.nextUrl.searchParams.get('key') === EMAIL_LABEL_PLAN_KEY) return true;
  const auth = req.headers.get('authorization') || '';
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  return false;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const [activeAccountCount, totalMessages] = await Promise.all([
    prisma.emailAccount.count({ where: { isActive: true } }),
    prisma.emailMessage.count(),
  ]);

  return NextResponse.json({
    ok: true,
    ts: new Date().toISOString(),
    activeAccountCount,
    totalMessages,
    readiness: buildGmailLabelReadiness({ activeAccountCount, totalMessages }),
    plans: labelPlanWithLabels(),
  });
}

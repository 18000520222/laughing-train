import { NextResponse } from 'next/server';
import { repairAutomationRiskFlow } from '@/lib/automation-risk-repair';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { can } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const auth = await requireSalesUser();
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const form = await req.formData();
  const flowId = String(form.get('flowId') || '').trim();
  if (!flowId) return redirectBack(req, { status: 'invalid', flowId: '', updated: 0, createdRun: 0, replayed: 0, notified: 0, skipped: 1 });

  const result = await repairAutomationRiskFlow({ flowId, userId: auth.user.id });
  return redirectBack(req, {
    status: result.status,
    flowId,
    updated: result.updated,
    createdRun: result.createdRun,
    replayed: result.replayed,
    notified: result.notified,
    skipped: result.skipped,
  });
}

async function requireSalesUser() {
  const session = await getSession();
  if (!session || !can(session.role, 'automation.manage')) return null;
  return { user: { id: session.userId, email: session.email, name: session.name }, role: session.role };
}

function redirectBack(
  req: Request,
  result: { status: string; flowId: string; updated: number; createdRun: number; replayed: number; notified: number; skipped: number }
) {
  const url = new URL('/automation', req.url);
  url.searchParams.set('riskRepair', result.status);
  if (result.flowId) url.searchParams.set('flow', result.flowId);
  url.searchParams.set('repairUpdated', String(result.updated));
  url.searchParams.set('repairCreatedRun', String(result.createdRun));
  url.searchParams.set('repairReplayed', String(result.replayed));
  url.searchParams.set('repairNotified', String(result.notified));
  if (result.skipped > 0) url.searchParams.set('repairSkipped', String(result.skipped));
  url.hash = 'automation-risk-repair';
  return NextResponse.redirect(url, { status: 303 });
}

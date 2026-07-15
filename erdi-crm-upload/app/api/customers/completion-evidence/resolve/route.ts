import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { can } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

const REPAIR_SOURCE = 'COMPLETION_EVIDENCE_AUDIT';

const EVIDENCE_LABEL: Record<string, string> = {
  CUSTOMER_REPLY: '客户回复',
  OUTBOUND_MESSAGE: '出站消息',
  OPPORTUNITY_PROGRESS: '商机推进',
  CALL_NOTE: '电话证据',
  OTHER: '其他证据',
};

const FOLLOW_UP_TYPE: Record<string, string> = {
  CUSTOMER_REPLY: 'EMAIL',
  OUTBOUND_MESSAGE: 'EMAIL',
  OPPORTUNITY_PROGRESS: 'TASK',
  CALL_NOTE: 'PHONE',
  OTHER: 'TASK',
};

export async function POST(req: Request) {
  const auth = await requireSalesUser();
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const form = await req.formData();
  const taskId = String(form.get('taskId') || '').trim();
  const content = String(form.get('content') || '').trim();
  const evidenceType = String(form.get('evidenceType') || 'CUSTOMER_REPLY').trim();
  if (!taskId || content.length < 6) return redirectBack(req, '', 'invalid', taskId);

  const task = await prisma.salesTask.findUnique({
    where: { id: taskId },
    include: {
      company: { select: { id: true, name: true } },
      owner: { select: { id: true, name: true, email: true } },
    },
  });
  if (!task || task.source !== REPAIR_SOURCE || task.status !== 'TODO') return redirectBack(req, task?.companyId || '', 'invalid', taskId);
  if (auth.role === 'SALES' && task.ownerId !== auth.user.id) return redirectBack(req, task.companyId, 'forbidden', taskId);

  const label = EVIDENCE_LABEL[evidenceType] || EVIDENCE_LABEL.OTHER;
  const followUpType = FOLLOW_UP_TYPE[evidenceType] || FOLLOW_UP_TYPE.OTHER;
  const proof = `补完成证据/${label}: ${content}`;

  await prisma.$transaction(async (tx) => {
    await tx.followUp.create({
      data: {
        companyId: task.companyId,
        userId: auth.user.id,
        type: followUpType,
        content: proof,
      },
    });
    await tx.salesTask.update({
      where: { id: task.id },
      data: { status: 'DONE', completedAt: new Date() },
    });
    if (task.ownerId !== auth.user.id) {
      await tx.notification.create({
        data: {
          userId: task.ownerId,
          type: 'SYSTEM',
          title: '补证据任务已完成',
          body: `${task.company.name}: ${auth.user.name || auth.user.email} 已补充完成证据`,
          link: `/customers/${task.companyId}?completionTask=${task.id}#completion-evidence-workbench`,
        },
      });
    }
  });

  return redirectBack(req, task.companyId, 'done', task.id);
}

async function requireSalesUser() {
  const session = await getSession();
  if (!session || !can(session.role, 'sales.manage')) return null;
  return { user: { id: session.userId, email: session.email, name: session.name }, role: session.role };
}

function redirectBack(req: Request, companyId: string, status: string, taskId: string) {
  const url = new URL(companyId ? `/customers/${companyId}` : '/tasks', req.url);
  url.searchParams.set('completionResolved', status);
  if (taskId) url.searchParams.set('completionTask', taskId);
  url.hash = 'completion-evidence-workbench';
  return NextResponse.redirect(url, { status: 303 });
}

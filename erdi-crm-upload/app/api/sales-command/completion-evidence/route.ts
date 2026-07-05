import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'SALES']);
const SOURCE = 'COMPLETION_EVIDENCE_AUDIT';

export async function POST(req: Request) {
  const auth = await requireSalesUser();
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const form = await req.formData();
  const taskIds = parseTaskIds(form);
  if (taskIds.length === 0) return redirectBack(req, 'invalid', 0, 0);

  const result = await createEvidenceRepairTasks({ taskIds, currentUserId: auth.user.id, role: auth.role });
  return redirectBack(req, result.created > 0 ? 'created' : 'duplicate', result.created, result.skipped);
}

async function requireSalesUser() {
  const cookieStore = cookies();
  const role = (cookieStore.get('auth_role')?.value || '').toUpperCase();
  const email = cookieStore.get('auth_email')?.value || '';
  const userId = cookieStore.get('auth_userId')?.value || '';
  if (!ALLOWED_ROLES.has(role)) return null;

  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : email
    ? await prisma.user.findUnique({ where: { email } })
    : null;
  if (!user || !user.isActive) return null;
  return { user, role };
}

async function createEvidenceRepairTasks({ taskIds, currentUserId, role }: { taskIds: string[]; currentUserId: string; role: string }) {
  const tasks = await prisma.salesTask.findMany({
    where: {
      id: { in: taskIds },
      status: 'DONE',
      completedAt: { not: null },
      ...(role === 'SALES' ? { ownerId: currentUserId } : {}),
    },
    include: { owner: true, company: true, opportunity: true },
    take: 50,
  });

  let created = 0;
  let skipped = taskIds.length - tasks.length;
  for (const task of tasks) {
    const sourceRef = `completion-evidence:${task.id}`;
    const existing = await prisma.salesTask.findFirst({
      where: { source: SOURCE, sourceRef, status: 'TODO' },
      select: { id: true },
    });
    if (existing) {
      skipped++;
      continue;
    }

    const dueAt = new Date();
    dueAt.setHours(dueAt.getHours() + (task.priority === 'URGENT' ? 4 : 8));
    await prisma.salesTask.create({
      data: {
        title: `补完成证据: ${task.title}`,
        description: buildRepairDescription(task),
        type: 'FOLLOW_UP',
        priority: task.priority === 'URGENT' ? 'URGENT' : 'HIGH',
        dueAt,
        ownerId: task.ownerId,
        createdById: currentUserId,
        companyId: task.companyId,
        opportunityId: task.opportunityId,
        source: SOURCE,
        sourceRef,
      },
    });
    await prisma.notification.create({
      data: {
        userId: task.ownerId,
        type: 'SYSTEM',
        title: '任务完成证据待补',
        body: `${task.company.name}: ${task.title} 已完成,但缺少客户回复、跟进记录或商机推进证据。`,
        link: `/customers/${task.companyId}`,
      },
    });
    created++;
  }

  return { created, skipped };
}

function buildRepairDescription(task: {
  title: string;
  completedAt: Date | null;
  company?: { name: string } | null;
  opportunity?: { title: string } | null;
}) {
  const pieces = [
    `原任务: ${task.title}`,
    task.completedAt ? `完成时间: ${task.completedAt.toISOString()}` : null,
    task.company?.name ? `客户: ${task.company.name}` : null,
    task.opportunity?.title ? `商机: ${task.opportunity.title}` : null,
    '请补齐至少一项证据: 1) 客户跟进记录; 2) 出站邮件/WhatsApp/平台消息; 3) 商机阶段推进或下一步动作。',
  ];
  return pieces.filter(Boolean).join('\n');
}

function parseTaskIds(form: FormData) {
  const values = [
    String(form.get('taskId') || ''),
    String(form.get('taskIds') || ''),
    ...form.getAll('taskIds').map((value) => String(value || '')),
  ];
  return Array.from(
    new Set(
      values
        .flatMap((value) => value.split(','))
        .map((value) => value.trim())
        .filter(Boolean)
    )
  ).slice(0, 50);
}

function redirectBack(req: Request, status: string, created: number, skipped: number) {
  const url = new URL('/sales-command', req.url);
  url.searchParams.set('completionEvidence', status);
  url.searchParams.set('completionCreated', String(created));
  if (skipped > 0) url.searchParams.set('completionSkipped', String(skipped));
  url.hash = 'completion-evidence';
  return NextResponse.redirect(url);
}

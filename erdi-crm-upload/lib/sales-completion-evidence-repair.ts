import { prisma } from '@/lib/prisma';
import { buildSalesCompletionEvidenceReport } from '@/lib/sales-completion-evidence';

export const COMPLETION_EVIDENCE_REPAIR_SOURCE = 'COMPLETION_EVIDENCE_AUDIT';

const AUDITED_TASK_SOURCES = ['DAILY_PRIORITY', 'EMAIL_ACTION_BULK', 'OMNIBOX_BULK', 'AUTOMATION_NO_REPLY_TIMEOUT', 'CUSTOMER_HEALTH_AUTOMATION', 'SALES_RADAR'];

export async function createCompletionEvidenceRepairTasks({
  taskIds,
  currentUserId,
  role,
}: {
  taskIds: string[];
  currentUserId: string | null;
  role: string;
}) {
  const uniqueTaskIds = Array.from(new Set(taskIds.map((id) => id.trim()).filter(Boolean))).slice(0, 50);
  const tasks = await prisma.salesTask.findMany({
    where: {
      id: { in: uniqueTaskIds },
      status: 'DONE',
      completedAt: { not: null },
      ...(role === 'SALES' && currentUserId ? { ownerId: currentUserId } : {}),
    },
    include: { owner: true, company: true, opportunity: true },
    take: 50,
  });

  let created = 0;
  let skipped = uniqueTaskIds.length - tasks.length;
  const createdTaskIds: string[] = [];
  for (const task of tasks) {
    const sourceRef = completionEvidenceSourceRef(task.id);
    const existing = await prisma.salesTask.findFirst({
      where: { source: COMPLETION_EVIDENCE_REPAIR_SOURCE, sourceRef, status: 'TODO' },
      select: { id: true },
    });
    if (existing) {
      skipped++;
      continue;
    }

    const dueAt = new Date();
    dueAt.setHours(dueAt.getHours() + (task.priority === 'URGENT' ? 4 : 8));
    const repairTask = await prisma.salesTask.create({
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
        source: COMPLETION_EVIDENCE_REPAIR_SOURCE,
        sourceRef,
      },
      select: { id: true },
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
    createdTaskIds.push(repairTask.id);
    created++;
  }

  return { requested: uniqueTaskIds.length, created, skipped, createdTaskIds };
}

export async function runCompletionEvidenceRepairWatch({
  now = new Date(),
  limit = 30,
  sinceDays = 30,
}: {
  now?: Date;
  limit?: number;
  sinceDays?: number;
} = {}) {
  const since = new Date(now.getTime() - Math.max(1, sinceDays) * 86400000);
  const completionTasks = await prisma.salesTask.findMany({
    where: {
      status: 'DONE',
      completedAt: { gte: since, lt: now },
      source: { in: AUDITED_TASK_SOURCES },
    },
    orderBy: { completedAt: 'desc' },
    take: Math.max(1, Math.min(limit * 4, 200)),
    include: { owner: true, company: true, opportunity: true },
  });
  const companyIds = Array.from(new Set(completionTasks.map((task) => task.companyId)));
  if (completionTasks.length === 0 || companyIds.length === 0) {
    return { scanned: 0, candidates: 0, requested: 0, created: 0, skipped: 0, createdTaskIds: [] as string[] };
  }

  const evidenceWindowStart = completionTasks.reduce<Date | null>((min, task) => {
    if (!task.completedAt) return min;
    const candidate = new Date(task.completedAt.getTime() - 5 * 60000);
    return !min || candidate < min ? candidate : min;
  }, null) || since;
  const [followUps, messages, opportunities] = await Promise.all([
    prisma.followUp.findMany({
      where: { companyId: { in: companyIds }, createdAt: { gte: evidenceWindowStart } },
      include: { user: true },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    }),
    prisma.inboxMessage.findMany({
      where: {
        companyId: { in: companyIds },
        direction: 'OUT',
        OR: [{ createdAt: { gte: evidenceWindowStart } }, { sentAt: { gte: evidenceWindowStart } }],
      },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    }),
    prisma.opportunity.findMany({
      where: { companyId: { in: companyIds }, stageChangedAt: { gte: evidenceWindowStart } },
      orderBy: { stageChangedAt: 'desc' },
      take: 800,
    }),
  ]);

  const report = buildSalesCompletionEvidenceReport({ tasks: completionTasks, followUps, messages, opportunities });
  const candidateIds = report.allRows
    .filter((row) => row.statusLabel !== '有业务结果')
    .map((row) => row.taskId)
    .slice(0, Math.max(1, limit));
  const actor = await prisma.user.findFirst({
    where: { role: { in: ['SUPER_ADMIN', 'ADMIN'] as any }, isActive: true },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    select: { id: true },
  });
  const repair = await createCompletionEvidenceRepairTasks({ taskIds: candidateIds, currentUserId: actor?.id || null, role: 'SYSTEM' });

  return {
    scanned: completionTasks.length,
    candidates: candidateIds.length,
    ...repair,
  };
}

export function completionEvidenceSourceRef(taskId: string) {
  return `completion-evidence:${taskId}`;
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

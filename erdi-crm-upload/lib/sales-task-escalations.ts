import { prisma } from '@/lib/prisma';

const DEFAULT_POLICIES = [
  { priority: 'URGENT', thresholdHours: 2, notes: '紧急任务逾期 2 小时仍未完成即升级。' },
  { priority: 'HIGH', thresholdHours: 8, notes: '高优先级任务当天内必须推进。' },
  { priority: 'NORMAL', thresholdHours: 24, notes: '普通任务逾期 1 天仍未完成即升级。' },
  { priority: 'LOW', thresholdHours: 48, notes: '低优先级任务逾期 2 天仍未完成即升级。' },
] as const;

export async function ensureSalesTaskEscalationPolicies() {
  for (const policy of DEFAULT_POLICIES) {
    await prisma.salesTaskEscalationPolicy.upsert({
      where: { priority: policy.priority as any },
      update: {},
      create: {
        priority: policy.priority as any,
        thresholdHours: policy.thresholdHours,
        isActive: true,
        notifyOwner: true,
        notifyAdmins: true,
        notes: policy.notes,
      },
    });
  }
}

export async function getSalesTaskEscalationPolicies() {
  await ensureSalesTaskEscalationPolicies();
  return prisma.salesTaskEscalationPolicy.findMany({
    orderBy: { thresholdHours: 'asc' },
  });
}

export async function escalateOverdueSalesTasks(options: { thresholdHours?: number; limit?: number } = {}) {
  const now = new Date();
  const policies = await getSalesTaskEscalationPolicies();
  const policyByPriority = new Map(policies.map((policy) => [policy.priority, policy]));
  const overrideHours = options.thresholdHours ? Math.max(options.thresholdHours, 1) : null;

  const tasks = await prisma.salesTask.findMany({
    where: {
      status: 'TODO',
      dueAt: { lt: now },
      escalatedAt: null,
    },
    include: { company: true, owner: true },
    orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
    take: Math.min(Math.max(options.limit || 100, 1), 500),
  });

  const admins = await prisma.user.findMany({
    where: { isActive: true, role: { in: ['SUPER_ADMIN', 'ADMIN'] as any } },
    select: { id: true },
  });

  const result = {
    scanned: tasks.length,
    escalated: 0,
    skippedPolicy: 0,
    skippedWindow: 0,
    ownerNotified: 0,
    adminNotifications: 0,
    adminCount: admins.length,
    policyCount: policies.length,
    thresholdHours: overrideHours || null,
  };
  if (tasks.length === 0) return result;

  for (const task of tasks) {
    const policy = policyByPriority.get(task.priority);
    if (!policy && !overrideHours) {
      result.skippedPolicy++;
      continue;
    }
    if (policy && !policy.isActive && !overrideHours) {
      result.skippedPolicy++;
      continue;
    }
    const thresholdHours = overrideHours || policy?.thresholdHours || 24;
    const threshold = new Date(now.getTime() - thresholdHours * 3600000);
    if (!task.dueAt || task.dueAt >= threshold) {
      result.skippedWindow++;
      continue;
    }

    const body = `${task.company.name}: ${task.title} · 负责人 ${task.owner.name || task.owner.email} · ${thresholdHours}小时 SLA`;
    const notifications = [];
    if ((policy?.notifyOwner ?? true) || overrideHours) {
      notifications.push({
        userId: task.ownerId,
        type: 'SYSTEM' as any,
        title: '你的销售任务 SLA 已升级',
        body,
        link: '/tasks?view=escalated',
      });
      result.ownerNotified++;
    }
    if ((policy?.notifyAdmins ?? true) || overrideHours) {
      notifications.push(...admins.map((admin) => ({
        userId: admin.id,
        type: 'SYSTEM' as any,
        title: '销售任务 SLA 已升级',
        body,
        link: '/tasks?view=escalated',
      })));
      result.adminNotifications += admins.length;
    }
    if (notifications.length > 0) {
      await prisma.notification.createMany({ data: notifications });
    }
    await prisma.salesTask.update({
      where: { id: task.id },
      data: { escalatedAt: now },
    });
    result.escalated++;
  }

  return result;
}

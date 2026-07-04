import { prisma } from '@/lib/prisma';

export async function escalateOverdueSalesTasks(options: { thresholdHours?: number; limit?: number } = {}) {
  const now = new Date();
  const thresholdHours = Math.max(options.thresholdHours || 24, 1);
  const threshold = new Date(now.getTime() - thresholdHours * 3600000);

  const tasks = await prisma.salesTask.findMany({
    where: {
      status: 'TODO',
      dueAt: { lt: threshold },
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

  const result = { scanned: tasks.length, escalated: 0, adminCount: admins.length, thresholdHours };
  if (admins.length === 0 || tasks.length === 0) return result;

  for (const task of tasks) {
    const body = `${task.company.name}: ${task.title} · 负责人 ${task.owner.name || task.owner.email}`;
    await prisma.notification.createMany({
      data: admins.map((admin) => ({
        userId: admin.id,
        type: 'SYSTEM' as any,
        title: '销售任务 SLA 已升级',
        body,
        link: '/tasks?view=escalated',
      })),
    });
    await prisma.salesTask.update({
      where: { id: task.id },
      data: { escalatedAt: now },
    });
    result.escalated++;
  }

  return result;
}

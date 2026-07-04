import { prisma } from '@/lib/prisma';

export async function sendSalesTaskReminders(options: { ownerId?: string; limit?: number } = {}) {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const where: any = {
    status: 'TODO',
    dueAt: { lt: tomorrow },
    reminderSentAt: null,
  };
  if (options.ownerId) where.ownerId = options.ownerId;

  const tasks = await prisma.salesTask.findMany({
    where,
    take: Math.min(Math.max(options.limit || 100, 1), 500),
    include: { company: true },
    orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
  });

  const result = { scanned: tasks.length, overdue: 0, dueSoon: 0, notified: 0 };
  for (const task of tasks) {
    const overdue = Boolean(task.dueAt && task.dueAt < now);
    if (overdue) result.overdue++;
    else result.dueSoon++;

    await prisma.notification.create({
      data: {
        userId: task.ownerId,
        type: 'SYSTEM',
        title: overdue ? '销售任务已逾期' : '销售任务即将到期',
        body: `${task.company.name}: ${task.title}`,
        link: '/tasks',
      },
    });
    await prisma.salesTask.update({
      where: { id: task.id },
      data: { reminderSentAt: now },
    });
    result.notified++;
  }

  return result;
}

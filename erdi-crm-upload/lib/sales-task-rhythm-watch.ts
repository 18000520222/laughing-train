import { prisma } from '@/lib/prisma';

const RHYTHM_RULES = {
  overdueBacklog: 3,
  unscheduledBacklog: 5,
  openWithoutCompletion: 5,
  dueTodayLoad: 8,
} as const;

type RhythmAlert = {
  key: 'OVERDUE_BACKLOG' | 'UNSCHEDULED_BACKLOG' | 'NO_RECENT_COMPLETION' | 'DUE_TODAY_LOAD';
  title: string;
  body: string;
  action: string;
  view: 'overdue' | 'unscheduled' | 'all' | 'today';
};

export async function runSalesTaskRhythmWatch(options: { ownerId?: string; limit?: number; now?: Date } = {}) {
  const now = options.now || new Date();
  const todayStart = startOfUtcDay(now);
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const limit = Math.min(Math.max(options.limit || 100, 1), 500);

  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      role: { in: ['SUPER_ADMIN', 'ADMIN', 'SALES'] as any },
      ...(options.ownerId ? { id: options.ownerId } : {}),
    },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, email: true, name: true, role: true },
  });
  const admins = await prisma.user.findMany({
    where: { isActive: true, role: { in: ['SUPER_ADMIN', 'ADMIN'] as any } },
    select: { id: true },
  });

  const result = {
    scannedUsers: users.length,
    triggeredUsers: 0,
    ownerNotifications: 0,
    adminNotifications: 0,
    skippedDuplicates: 0,
    skippedLimit: 0,
    alerts: 0,
    adminCount: admins.length,
  };
  const teamAlerts = new Map<RhythmAlert['key'], Array<{ ownerName: string; body: string; view: RhythmAlert['view'] }>>();

  for (const user of users) {
    if (result.ownerNotifications >= limit) {
      result.skippedLimit++;
      break;
    }

    const [openCount, overdueCount, unscheduledCount, dueTodayCount, completedWeek, overdueSamples] = await Promise.all([
      prisma.salesTask.count({ where: { ownerId: user.id, status: 'TODO' } }),
      prisma.salesTask.count({ where: { ownerId: user.id, status: 'TODO', dueAt: { lt: now } } }),
      prisma.salesTask.count({ where: { ownerId: user.id, status: 'TODO', dueAt: null } }),
      prisma.salesTask.count({ where: { ownerId: user.id, status: 'TODO', dueAt: { gte: todayStart, lt: tomorrowStart } } }),
      prisma.salesTask.count({ where: { ownerId: user.id, status: 'DONE', completedAt: { gte: weekAgo } } }),
      prisma.salesTask.findMany({
        where: { ownerId: user.id, status: 'TODO', dueAt: { lt: now } },
        include: { company: { select: { name: true } } },
        orderBy: [{ dueAt: 'asc' }, { priority: 'desc' }],
        take: 3,
      }),
    ]);
    const ownerName = user.name || user.email;
    const sampleText = overdueSamples.map((task) => `${task.company.name}:${task.title}`).join('; ');
    const alerts = buildRhythmAlerts({ openCount, overdueCount, unscheduledCount, dueTodayCount, completedWeek, sampleText });
    if (alerts.length === 0) continue;
    result.triggeredUsers++;

    for (const alert of alerts) {
      if (result.ownerNotifications >= limit) {
        result.skippedLimit++;
        break;
      }
      result.alerts++;
      const created = await createDailyNotification({
        userId: user.id,
        title: `任务节奏异常:${alert.title}`,
        body: `${alert.body}\n建议:${alert.action}`,
        link: `/tasks?view=${alert.view}&scope=mine`,
        todayStart,
      });
      if (created) result.ownerNotifications++;
      else result.skippedDuplicates++;

      const bucket = teamAlerts.get(alert.key) || [];
      bucket.push({ ownerName, body: alert.body, view: alert.view });
      teamAlerts.set(alert.key, bucket);
    }
  }

  for (const [key, alerts] of Array.from(teamAlerts.entries())) {
    const summary = summarizeTeamAlert(key, alerts);
    for (const admin of admins) {
      const created = await createDailyNotification({
        userId: admin.id,
        title: `团队任务节奏异常:${summary.title}`,
        body: summary.body,
        link: `/tasks?view=${summary.view}&scope=all`,
        todayStart,
      });
      if (created) result.adminNotifications++;
      else result.skippedDuplicates++;
    }
  }

  return result;
}

function buildRhythmAlerts(input: { openCount: number; overdueCount: number; unscheduledCount: number; dueTodayCount: number; completedWeek: number; sampleText: string }): RhythmAlert[] {
  const alerts: RhythmAlert[] = [];
  if (input.overdueCount >= RHYTHM_RULES.overdueBacklog) {
    alerts.push({
      key: 'OVERDUE_BACKLOG',
      title: '逾期任务积压',
      body: `当前有 ${input.overdueCount} 个逾期待办${input.sampleText ? `,最早积压:${input.sampleText}` : ''}`,
      action: '先进入逾期队列,完成、顺延或转派已失真的任务。',
      view: 'overdue',
    });
  }
  if (input.unscheduledCount >= RHYTHM_RULES.unscheduledBacklog) {
    alerts.push({
      key: 'UNSCHEDULED_BACKLOG',
      title: '未排期任务过多',
      body: `当前有 ${input.unscheduledCount} 个任务没有截止时间,团队无法判断优先级和节奏。`,
      action: '把真实要做的任务补上截止时间,无效任务直接取消或合并。',
      view: 'unscheduled',
    });
  }
  if (input.openCount >= RHYTHM_RULES.openWithoutCompletion && input.completedWeek === 0) {
    alerts.push({
      key: 'NO_RECENT_COMPLETION',
      title: '一周无完成记录',
      body: `当前仍有 ${input.openCount} 个待办,但近 7 天完成数为 0。`,
      action: '用沉浸式任务队列先清掉最能推进成交的下一条动作。',
      view: 'all',
    });
  }
  if (input.dueTodayCount >= RHYTHM_RULES.dueTodayLoad) {
    alerts.push({
      key: 'DUE_TODAY_LOAD',
      title: '今日到期过载',
      body: `今天有 ${input.dueTodayCount} 个任务到期,需要重新排序或分派。`,
      action: '优先处理客户回复、报价、风险挽回任务,低价值任务顺延。',
      view: 'today',
    });
  }
  return alerts;
}

async function createDailyNotification(input: { userId: string; title: string; body: string; link: string; todayStart: Date }) {
  const existing = await prisma.notification.findFirst({
    where: {
      userId: input.userId,
      type: 'SYSTEM',
      title: input.title,
      link: input.link,
      createdAt: { gte: input.todayStart },
    },
    select: { id: true },
  });
  if (existing) return false;

  await prisma.notification.create({
    data: {
      userId: input.userId,
      type: 'SYSTEM',
      title: input.title,
      body: input.body,
      link: input.link,
    },
  });
  return true;
}

function summarizeTeamAlert(key: RhythmAlert['key'], alerts: Array<{ ownerName: string; body: string; view: RhythmAlert['view'] }>) {
  const title = key === 'OVERDUE_BACKLOG'
    ? '逾期任务积压'
    : key === 'UNSCHEDULED_BACKLOG'
      ? '未排期任务过多'
      : key === 'NO_RECENT_COMPLETION'
        ? '一周无完成记录'
        : '今日到期过载';
  const owners = alerts.map((alert) => alert.ownerName).slice(0, 8).join('、');
  const extra = alerts.length > 8 ? `等 ${alerts.length} 人` : `${alerts.length} 人`;
  return {
    title,
    body: `${extra}触发: ${owners}\n${alerts[0]?.body || ''}`,
    view: alerts[0]?.view || 'all',
  };
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

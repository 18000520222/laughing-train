import { prisma } from '@/lib/prisma';

export type KpiGapKey = 'revenue' | 'wonDeals' | 'newCustomers' | 'completedTasks' | 'onTimeRate' | 'overdueTasks';

export type SalesKpiGap = {
  key: KpiGapKey;
  label: string;
  severity: 'warning' | 'critical';
  actual: string;
  target: string;
  message: string;
  taskTitle: string;
  taskDescription: string;
  dueInDays: number;
};

export type SalesKpiRow = {
  owner: {
    id: string;
    email: string;
    name: string | null;
    role: string;
  };
  target: any;
  revenue: number;
  wonDeals: number;
  newCustomers: number;
  completedTasks: number;
  onTimeRate: number | null;
  openPipeline: number;
  overdueTasks: number;
  score: number;
  expectedPace: number;
  gaps: SalesKpiGap[];
};

type TeamTotals = {
  revenue: number;
  revenueTarget: number;
  wonDeals: number;
  wonTarget: number;
  customers: number;
  customerTarget: number;
  tasks: number;
  taskTarget: number;
  pipeline: number;
  overdue: number;
};

export async function getSalesKpiRows(options: { periodStart: Date; ownerIds?: string[]; now?: Date }) {
  const now = options.now || new Date();
  const periodStart = monthStart(options.periodStart);
  const nextPeriod = addMonths(periodStart, 1);
  const expectedPace = expectedMonthPace(periodStart, now);

  const users = await prisma.user.findMany({
    where: {
      role: { in: ['SUPER_ADMIN', 'ADMIN', 'SALES'] as any },
      isActive: true,
      ...(options.ownerIds?.length ? { id: { in: options.ownerIds } } : {}),
    },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, email: true, name: true, role: true },
  });
  const userIds = users.map((item) => item.id);

  const targets = await prisma.salesKpiTarget.findMany({
    where: { periodStart, ownerId: { in: userIds } },
  });
  const targetByOwner = new Map(targets.map((target) => [target.ownerId, target]));

  const rows = await Promise.all(users.map(async (owner) => {
    const [wonOpps, newCustomers, completedTasks, openOpps, overdueTasks] = await Promise.all([
      prisma.opportunity.findMany({
        where: { ownerId: owner.id, stage: 'CLOSED_WON', stageChangedAt: { gte: periodStart, lt: nextPeriod } },
        select: { amountUSD: true },
      }),
      prisma.company.count({ where: { ownerId: owner.id, createdAt: { gte: periodStart, lt: nextPeriod } } }),
      prisma.salesTask.findMany({
        where: { ownerId: owner.id, status: 'DONE', completedAt: { gte: periodStart, lt: nextPeriod } },
        select: { dueAt: true, completedAt: true },
      }),
      prisma.opportunity.findMany({
        where: { ownerId: owner.id, stage: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] as any } },
        select: { amountUSD: true },
      }),
      prisma.salesTask.count({ where: { ownerId: owner.id, status: 'TODO', dueAt: { lt: now } } }),
    ]);
    const target = targetByOwner.get(owner.id);
    const revenue = wonOpps.reduce((sum, opp) => sum + (opp.amountUSD || 0), 0);
    const openPipeline = openOpps.reduce((sum, opp) => sum + (opp.amountUSD || 0), 0);
    const tasksWithDue = completedTasks.filter((task) => task.dueAt && task.completedAt);
    const onTimeTasks = tasksWithDue.filter((task) => task.completedAt && task.dueAt && task.completedAt.getTime() <= task.dueAt.getTime()).length;
    const onTimeRate = tasksWithDue.length > 0 ? onTimeTasks / tasksWithDue.length : null;
    const score = average([
      progress(revenue, target?.revenueTargetUSD || 0),
      progress(wonOpps.length, target?.wonDealsTarget || 0),
      progress(newCustomers, target?.newCustomersTarget || 0),
      progress(completedTasks.length, target?.completedTasksTarget || 0),
      target?.onTimeRateTarget ? (onTimeRate === null ? 0 : Math.min(1, onTimeRate / target.onTimeRateTarget)) : null,
    ]);

    const row: SalesKpiRow = {
      owner,
      target,
      revenue,
      wonDeals: wonOpps.length,
      newCustomers,
      completedTasks: completedTasks.length,
      onTimeRate,
      openPipeline,
      overdueTasks,
      score,
      expectedPace,
      gaps: [],
    };
    row.gaps = buildSalesKpiGaps(row);
    return row;
  }));

  const team = rows.reduce((acc, row) => {
    acc.revenue += row.revenue;
    acc.revenueTarget += row.target?.revenueTargetUSD || 0;
    acc.wonDeals += row.wonDeals;
    acc.wonTarget += row.target?.wonDealsTarget || 0;
    acc.customers += row.newCustomers;
    acc.customerTarget += row.target?.newCustomersTarget || 0;
    acc.tasks += row.completedTasks;
    acc.taskTarget += row.target?.completedTasksTarget || 0;
    acc.pipeline += row.openPipeline;
    acc.overdue += row.overdueTasks;
    return acc;
  }, { revenue: 0, revenueTarget: 0, wonDeals: 0, wonTarget: 0, customers: 0, customerTarget: 0, tasks: 0, taskTarget: 0, pipeline: 0, overdue: 0 } as TeamTotals);

  return { rows, team, expectedPace, periodStart, nextPeriod };
}

export async function generateKpiRecoveryTasks(options: { periodStart?: Date; ownerId?: string; createdById?: string; limit?: number } = {}) {
  const periodStart = monthStart(options.periodStart || new Date());
  const { rows } = await getSalesKpiRows({
    periodStart,
    ownerIds: options.ownerId ? [options.ownerId] : undefined,
  });
  const now = new Date();
  const limit = Math.min(Math.max(options.limit || 50, 1), 200);
  const result = { scanned: rows.length, gaps: 0, created: 0, skipped: 0, missingCompany: 0, period: formatMonth(periodStart) };

  for (const row of rows) {
    const actionableGaps = row.gaps
      .filter((gap) => gap.key !== 'overdueTasks')
      .slice(0, 3);
    result.gaps += actionableGaps.length;

    for (const gap of actionableGaps) {
      if (result.created >= limit) return result;
      const sourceRef = `kpi:${formatMonth(periodStart)}:${row.owner.id}:${gap.key}`;
      const existing = await prisma.salesTask.findFirst({
        where: { ownerId: row.owner.id, source: 'KPI_AUTO_SPLIT', sourceRef, status: 'TODO' },
        select: { id: true },
      });
      if (existing) {
        result.skipped++;
        continue;
      }

      const company = await findKpiAnchorCompany(row.owner.id, gap.key);
      if (!company) {
        await prisma.notification.create({
          data: {
            userId: row.owner.id,
            type: 'SYSTEM',
            title: 'KPI 目标落后但缺少可挂接客户',
            body: `${gap.label}: ${gap.message}`,
            link: '/sales-kpi',
          },
        });
        result.missingCompany++;
        continue;
      }

      const dueAt = new Date(now);
      dueAt.setDate(dueAt.getDate() + gap.dueInDays);
      await prisma.salesTask.create({
        data: {
          title: gap.taskTitle,
          description: `${gap.taskDescription}\n\nKPI口径:${gap.message}`,
          type: gap.key === 'revenue' || gap.key === 'wonDeals' ? 'QUOTE' : gap.key === 'onTimeRate' ? 'RISK_RESCUE' : 'FOLLOW_UP',
          priority: gap.severity === 'critical' ? 'URGENT' : 'HIGH',
          ownerId: row.owner.id,
          createdById: options.createdById || null,
          companyId: company.id,
          source: 'KPI_AUTO_SPLIT',
          sourceRef,
          dueAt,
        },
      });
      await prisma.notification.create({
        data: {
          userId: row.owner.id,
          type: 'SYSTEM',
          title: gap.severity === 'critical' ? 'KPI 严重落后,已拆解补救任务' : 'KPI 低于进度,已拆解补救任务',
          body: `${company.name}: ${gap.message}`,
          link: '/tasks?view=week',
        },
      });
      result.created++;
    }
  }

  return result;
}

function buildSalesKpiGaps(row: SalesKpiRow): SalesKpiGap[] {
  const target = row.target;
  if (!target) return [];

  const gaps: SalesKpiGap[] = [];
  const pace = Math.max(row.expectedPace, 0.08);
  addPaceGap(gaps, {
    key: 'revenue',
    label: '收入',
    actualValue: row.revenue,
    targetValue: target.revenueTargetUSD || 0,
    actual: `$${Math.round(row.revenue).toLocaleString()}`,
    target: `$${Math.round(target.revenueTargetUSD || 0).toLocaleString()}`,
    pace,
    taskTitle: 'KPI补救:推进高价值商机报价/成交',
    taskDescription: '检查当前高价值客户和报价中商机,明确下一步成交动作、报价缺口和客户阻碍。',
  });
  addPaceGap(gaps, {
    key: 'wonDeals',
    label: '赢单',
    actualValue: row.wonDeals,
    targetValue: target.wonDealsTarget || 0,
    actual: String(row.wonDeals),
    target: String(target.wonDealsTarget || 0),
    pace,
    taskTitle: 'KPI补救:推动一个最近可赢商机',
    taskDescription: '从报价中/谈判中客户里挑选最近可赢机会,补一次关键跟进并记录客户决策卡点。',
  });
  addPaceGap(gaps, {
    key: 'newCustomers',
    label: '新客户',
    actualValue: row.newCustomers,
    targetValue: target.newCustomersTarget || 0,
    actual: String(row.newCustomers),
    target: String(target.newCustomersTarget || 0),
    pace,
    taskTitle: 'KPI补救:开发新客户并补齐客户画像',
    taskDescription: '从邮件/平台/LinkedIn/海关线索中补充新客户,并维护主营产品、痛点和下一步动作。',
  });
  addPaceGap(gaps, {
    key: 'completedTasks',
    label: '完成任务',
    actualValue: row.completedTasks,
    targetValue: target.completedTasksTarget || 0,
    actual: String(row.completedTasks),
    target: String(target.completedTasksTarget || 0),
    pace,
    taskTitle: 'KPI补救:清理本周销售任务队列',
    taskDescription: '进入沉浸式任务队列处理逾期/今日/本周任务,优先完成影响收入和客户回复的任务。',
  });

  if (target.onTimeRateTarget && row.onTimeRate !== null && row.onTimeRate < target.onTimeRateTarget * 0.9) {
    gaps.push({
      key: 'onTimeRate',
      label: '准时率',
      severity: row.onTimeRate < target.onTimeRateTarget * 0.7 ? 'critical' : 'warning',
      actual: formatPercent(row.onTimeRate),
      target: formatPercent(target.onTimeRateTarget),
      message: `准时率 ${formatPercent(row.onTimeRate)},低于目标 ${formatPercent(target.onTimeRateTarget)}`,
      taskTitle: 'KPI补救:修复任务准时率',
      taskDescription: '检查逾期任务根因,顺延不合理截止时间,对真实阻塞客户补跟进并关闭已完成任务。',
      dueInDays: row.onTimeRate < target.onTimeRateTarget * 0.7 ? 1 : 2,
    });
  }

  if (row.overdueTasks >= 3) {
    gaps.push({
      key: 'overdueTasks',
      label: '逾期任务',
      severity: row.overdueTasks >= 8 ? 'critical' : 'warning',
      actual: String(row.overdueTasks),
      target: '0',
      message: `当前仍有 ${row.overdueTasks} 个逾期任务,会拖低成交节奏`,
      taskTitle: 'KPI补救:处理逾期任务积压',
      taskDescription: '进入逾期队列,完成、顺延或转派已失真的任务,避免销售动作继续堆积。',
      dueInDays: 1,
    });
  }

  return gaps.sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity));
}

function addPaceGap(gaps: SalesKpiGap[], input: {
  key: KpiGapKey;
  label: string;
  actualValue: number;
  targetValue: number;
  actual: string;
  target: string;
  pace: number;
  taskTitle: string;
  taskDescription: string;
}) {
  if (!input.targetValue || input.targetValue <= 0) return;
  const ratio = input.actualValue / input.targetValue;
  const warningLine = input.pace * 0.85;
  if (ratio >= warningLine) return;
  const severity = ratio < input.pace * 0.55 ? 'critical' : 'warning';
  gaps.push({
    key: input.key,
    label: input.label,
    severity,
    actual: input.actual,
    target: input.target,
    message: `${input.label} 当前 ${input.actual}/${input.target},低于本月时间进度 ${Math.round(input.pace * 100)}%`,
    taskTitle: input.taskTitle,
    taskDescription: input.taskDescription,
    dueInDays: severity === 'critical' ? 1 : 2,
  });
}

async function findKpiAnchorCompany(ownerId: string, gapKey: KpiGapKey) {
  if (gapKey === 'revenue' || gapKey === 'wonDeals') {
    const opportunity = await prisma.opportunity.findFirst({
      where: { ownerId, stage: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] as any } },
      orderBy: [{ amountUSD: 'desc' }, { updatedAt: 'desc' }],
      select: { companyId: true },
    });
    if (opportunity?.companyId) {
      const company = await prisma.company.findUnique({ where: { id: opportunity.companyId }, select: { id: true, name: true } });
      if (company) return company;
    }
  }

  return prisma.company.findFirst({
    where: { ownerId },
    orderBy: [{ priorityScore: 'desc' }, { updatedAt: 'desc' }],
    select: { id: true, name: true },
  });
}

function severityWeight(severity: string) {
  return severity === 'critical' ? 2 : 1;
}

export function monthStart(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
}

export function addMonths(date: Date, months: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1, 0, 0, 0, 0));
}

export function parseMonth(value: string) {
  if (!/^\d{4}-\d{2}$/.test(value)) return null;
  const [year, month] = value.split('-').map(Number);
  if (!year || !month || month < 1 || month > 12) return null;
  return new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
}

export function formatMonth(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function formatMonthLabel(date: Date) {
  return `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月`;
}

export function progress(actual: number, target: number) {
  if (!target || target <= 0) return null;
  return Math.min(1.5, actual / target);
}

export function average(values: Array<number | null>) {
  const usable = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (usable.length === 0) return 0;
  return usable.reduce((sum, value) => sum + Math.min(1, value), 0) / usable.length;
}

export function formatPercent(value: number | null) {
  if (value === null) return '-';
  return `${Math.round(value * 100)}%`;
}

function expectedMonthPace(periodStart: Date, now: Date) {
  const start = monthStart(periodStart);
  const end = addMonths(start, 1);
  if (now <= start) return 0;
  if (now >= end) return 1;
  return (now.getTime() - start.getTime()) / (end.getTime() - start.getTime());
}

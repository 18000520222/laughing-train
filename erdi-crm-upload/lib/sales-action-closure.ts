export type SalesActionClosureItemInput = {
  id: string;
  kind: string;
  kindLabel: string;
  title: string;
  ownerName: string;
  action: string;
  href: string;
  score: number;
  impactUSD: number;
};

export type SalesActionClosureTaskInput = {
  id: string;
  title: string;
  status: string;
  dueAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  source: string;
  sourceRef: string | null;
  owner?: { name: string | null; email: string } | null;
  company?: { id: string; name: string } | null;
  opportunity?: { id: string; title: string; amountUSD: number | null } | null;
};

export type SalesActionClosureRow = {
  itemId: string;
  kindLabel: string;
  title: string;
  ownerName: string;
  action: string;
  href: string;
  statusLabel: string;
  taskTitle: string;
  taskId: string | null;
  dueAt: Date | null;
  completedAt: Date | null;
  ageHours: number | null;
  impactUSD: number;
  score: number;
  tone: 'rose' | 'amber' | 'blue' | 'emerald' | 'slate';
};

const TASK_ITEM_KINDS = new Set(['SALES_TASK', 'EMAIL_ACTION', 'HEALTH_TASK']);

export function buildSalesActionClosureReport({
  items,
  tasks,
  now = new Date(),
}: {
  items: SalesActionClosureItemInput[];
  tasks: SalesActionClosureTaskInput[];
  now?: Date;
}) {
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const tasksBySourceRef = new Map<string, SalesActionClosureTaskInput>();
  for (const task of tasks) {
    if (task.source === 'DAILY_PRIORITY' && task.sourceRef) tasksBySourceRef.set(task.sourceRef, task);
  }

  const rows = items.map((item) => {
    const task = linkedTaskForItem(item, tasksById, tasksBySourceRef);
    return actionClosureRow(item, task, now);
  });

  const linkedRows = rows.filter((row) => row.taskId);
  const doneRows = linkedRows.filter((row) => row.completedAt);
  const openRows = linkedRows.filter((row) => row.taskId && !row.completedAt);
  const overdueRows = openRows.filter((row) => row.dueAt && row.dueAt.getTime() < now.getTime());
  const missingRows = rows.filter((row) => !row.taskId);
  const recentPriorityTasks = tasks.filter((task) => task.source === 'DAILY_PRIORITY' && task.sourceRef?.startsWith('priority:'));
  const recentDone = recentPriorityTasks.filter((task) => task.status === 'DONE').length;
  const recentOpen = recentPriorityTasks.filter((task) => task.status === 'TODO').length;
  const topBlockedRow = overdueRows[0] || missingRows[0] || openRows[0] || rows[0] || null;

  return {
    totalItems: rows.length,
    linkedTasks: linkedRows.length,
    missingTasks: missingRows.length,
    doneTasks: doneRows.length,
    openTasks: openRows.length,
    overdueTasks: overdueRows.length,
    conversionRate: rows.length ? linkedRows.length / rows.length : null,
    completionRate: linkedRows.length ? doneRows.length / linkedRows.length : null,
    recentPriorityTasks: recentPriorityTasks.length,
    recentDone,
    recentOpen,
    topBlockedRow,
    rows: rows
      .sort((a, b) => toneRank(a.tone) - toneRank(b.tone) || b.score - a.score || b.impactUSD - a.impactUSD)
      .slice(0, 9),
    recommendation: actionClosureRecommendation({
      totalItems: rows.length,
      missingTasks: missingRows.length,
      overdueTasks: overdueRows.length,
      openTasks: openRows.length,
      doneTasks: doneRows.length,
      topBlockedRow,
    }),
  };
}

function linkedTaskForItem(
  item: SalesActionClosureItemInput,
  tasksById: Map<string, SalesActionClosureTaskInput>,
  tasksBySourceRef: Map<string, SalesActionClosureTaskInput>
) {
  const [, targetId] = splitItemId(item.id);
  if (TASK_ITEM_KINDS.has(item.kind) && targetId) return tasksById.get(targetId) || null;
  return tasksBySourceRef.get(`priority:${item.id}`) || null;
}

function actionClosureRow(item: SalesActionClosureItemInput, task: SalesActionClosureTaskInput | null | undefined, now: Date): SalesActionClosureRow {
  if (!task) {
    return {
      itemId: item.id,
      kindLabel: item.kindLabel,
      title: item.title,
      ownerName: item.ownerName,
      action: item.action,
      href: item.href,
      statusLabel: TASK_ITEM_KINDS.has(item.kind) ? '任务未找到' : '未转任务',
      taskTitle: '未生成执行任务',
      taskId: null,
      dueAt: null,
      completedAt: null,
      ageHours: null,
      impactUSD: item.impactUSD,
      score: item.score,
      tone: item.score >= 90 ? 'rose' : 'amber',
    };
  }

  const overdue = task.status === 'TODO' && task.dueAt ? task.dueAt.getTime() < now.getTime() : false;
  const ageHours = task.createdAt ? Math.max(0, Math.floor((now.getTime() - task.createdAt.getTime()) / 3600000)) : null;
  return {
    itemId: item.id,
    kindLabel: item.kindLabel,
    title: task.company?.name || item.title,
    ownerName: task.owner?.name || task.owner?.email || item.ownerName,
    action: item.action,
    href: task.company?.id ? `/customers/${task.company.id}` : item.href,
    statusLabel: task.status === 'DONE' ? '已完成' : overdue ? '逾期未完成' : '执行中',
    taskTitle: task.title,
    taskId: task.id,
    dueAt: task.dueAt,
    completedAt: task.completedAt,
    ageHours,
    impactUSD: task.opportunity?.amountUSD || item.impactUSD,
    score: item.score,
    tone: task.status === 'DONE' ? 'emerald' : overdue ? 'rose' : 'blue',
  };
}

function actionClosureRecommendation(input: {
  totalItems: number;
  missingTasks: number;
  overdueTasks: number;
  openTasks: number;
  doneTasks: number;
  topBlockedRow: SalesActionClosureRow | null;
}) {
  if (input.totalItems === 0) return '今日暂无作战清单事项。先确保消息、任务、商机和自动化风险进入优先级队列。';
  if (input.overdueTasks > 0) return `${input.overdueTasks} 个作战事项已转任务但逾期未完成。先追 ${input.topBlockedRow?.ownerName || '负责人'},要求补结果和下一步时间。`;
  if (input.missingTasks > 0) return `${input.missingTasks} 个作战事项还停留在提醒层,未转成可跟踪任务。先点击批量处理,让每项都有负责人和截止时间。`;
  if (input.openTasks > 0) return `${input.openTasks} 个作战任务执行中。晨会后按负责人追完成证据,不要只看已读。`;
  if (input.doneTasks > 0) return '当前作战清单已完成闭环。下一步抽查客户/商机是否同步了最新阶段和跟进记录。';
  return '作战清单已有执行链路,继续保持提醒、任务、结果同步。';
}

function splitItemId(value: string) {
  const index = value.indexOf(':');
  if (index === -1) return ['', ''] as const;
  return [value.slice(0, index), value.slice(index + 1)] as const;
}

function toneRank(tone: SalesActionClosureRow['tone']) {
  const ranks: Record<SalesActionClosureRow['tone'], number> = { rose: 0, amber: 1, blue: 2, emerald: 3, slate: 4 };
  return ranks[tone];
}

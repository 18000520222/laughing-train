export type CompletionEvidenceRepairTaskInput = {
  id: string;
  title: string;
  status: string;
  source: string;
  sourceRef: string | null;
  dueAt: Date | null;
  escalatedAt: Date | null;
  createdAt: Date;
  completedAt: Date | null;
  owner?: { name: string | null; email: string } | null;
  company?: { id: string; name: string } | null;
};

export type CompletionEvidenceEscalationRow = {
  taskId: string;
  taskTitle: string;
  companyId: string;
  companyName: string;
  ownerName: string;
  statusLabel: string;
  dueAt: Date | null;
  escalatedAt: Date | null;
  ageHours: number;
  originalTaskId: string | null;
  href: string;
  tone: 'rose' | 'amber' | 'emerald' | 'slate';
};

type GroupRow = {
  key: string;
  label: string;
  total: number;
  open: number;
  overdue: number;
  escalated: number;
  resolved: number;
  latestAt: Date | null;
  score: number;
};

export function buildCompletionEvidenceEscalationReport({
  tasks,
  now = new Date(),
  escalationNotifications = 0,
}: {
  tasks: CompletionEvidenceRepairTaskInput[];
  now?: Date;
  escalationNotifications?: number;
}) {
  const repairTasks = tasks.filter((task) => task.source === 'COMPLETION_EVIDENCE_AUDIT');
  const rows = repairTasks.map((task) => escalationRow(task, now));
  const openRepairTasks = rows.filter((row) => row.statusLabel !== '已补证据').length;
  const overdueOpenTasks = rows.filter((row) => row.statusLabel === '已逾期' || row.statusLabel === '已升级').length;
  const escalatedOpenTasks = rows.filter((row) => row.statusLabel === '已升级').length;
  const resolvedTasks = rows.filter((row) => row.statusLabel === '已补证据').length;
  const ownerRows = groupRows(rows, (row) => row.ownerName, (row) => row.ownerName).slice(0, 6);
  const companyRows = groupRows(rows, (row) => row.companyId, (row) => row.companyName).slice(0, 6);
  const sortedRows = rows.sort(
    (a, b) =>
      toneRank(a.tone) - toneRank(b.tone) ||
      b.ageHours - a.ageHours ||
      (b.escalatedAt?.getTime() || 0) - (a.escalatedAt?.getTime() || 0)
  );

  return {
    totalRepairTasks: rows.length,
    openRepairTasks,
    overdueOpenTasks,
    escalatedOpenTasks,
    resolvedTasks,
    resolutionRate: rows.length ? resolvedTasks / rows.length : null,
    escalationNotifications,
    ownerRows,
    companyRows,
    rows: sortedRows.slice(0, 9),
    recommendation: escalationRecommendation({ rows: rows.length, overdueOpenTasks, escalatedOpenTasks, openRepairTasks }),
  };
}

function escalationRow(task: CompletionEvidenceRepairTaskInput, now: Date): CompletionEvidenceEscalationRow {
  const overdue = task.status === 'TODO' && !!task.dueAt && task.dueAt.getTime() < now.getTime();
  const ageHours = task.dueAt ? Math.max(0, Math.round((now.getTime() - task.dueAt.getTime()) / 3600000)) : 0;
  const originalTaskId = originalTaskIdFromRepair(task.sourceRef);
  const statusLabel = task.status === 'DONE' ? '已补证据' : task.escalatedAt ? '已升级' : overdue ? '已逾期' : '待补证据';
  const tone = statusLabel === '已升级' ? 'rose' : statusLabel === '已逾期' ? 'amber' : statusLabel === '已补证据' ? 'emerald' : 'slate';

  return {
    taskId: task.id,
    taskTitle: task.title,
    companyId: task.company?.id || '',
    companyName: task.company?.name || '未知客户',
    ownerName: task.owner?.name || task.owner?.email || '未分配',
    statusLabel,
    dueAt: task.dueAt,
    escalatedAt: task.escalatedAt,
    ageHours,
    originalTaskId,
    href: task.company?.id ? `/customers/${task.company.id}?completionTask=${task.id}#completion-evidence-workbench` : '/tasks?view=escalated',
    tone,
  };
}

function groupRows(rows: CompletionEvidenceEscalationRow[], keyOf: (row: CompletionEvidenceEscalationRow) => string, labelOf: (row: CompletionEvidenceEscalationRow) => string) {
  const map = new Map<string, GroupRow>();
  for (const row of rows) {
    const key = keyOf(row) || 'unknown';
    const current = map.get(key) || {
      key,
      label: labelOf(row) || '未知',
      total: 0,
      open: 0,
      overdue: 0,
      escalated: 0,
      resolved: 0,
      latestAt: null,
      score: 0,
    };
    current.total++;
    if (row.statusLabel === '已补证据') current.resolved++;
    else current.open++;
    if (row.statusLabel === '已逾期') current.overdue++;
    if (row.statusLabel === '已升级') current.escalated++;
    const latest = row.escalatedAt || row.dueAt;
    if (latest && (!current.latestAt || latest > current.latestAt)) current.latestAt = latest;
    current.score = current.escalated * 5 + current.overdue * 3 + current.open;
    map.set(key, current);
  }
  return Array.from(map.values()).sort((a, b) => b.score - a.score || b.total - a.total || a.label.localeCompare(b.label));
}

function escalationRecommendation(input: { rows: number; overdueOpenTasks: number; escalatedOpenTasks: number; openRepairTasks: number }) {
  if (input.rows === 0) return '近 30 天暂无补证据任务。先让完成任务进入证据链,再由自动巡检派单。';
  if (input.escalatedOpenTasks > 0) return `${input.escalatedOpenTasks} 个补证据任务已升级。先盯负责人补客户回复、出站消息或商机推进,不要只补内部备注。`;
  if (input.overdueOpenTasks > 0) return `${input.overdueOpenTasks} 个补证据任务已逾期。建议在升级前催办,减少老板手动追人。`;
  if (input.openRepairTasks > 0) return `${input.openRepairTasks} 个补证据任务正在处理中。关注是否能在截止时间前补到强证据。`;
  return '补证据任务已处理完。继续保持任务完成必须绑定业务结果。';
}

function originalTaskIdFromRepair(sourceRef: string | null) {
  const prefix = 'completion-evidence:';
  if (!sourceRef?.startsWith(prefix)) return null;
  return sourceRef.slice(prefix.length) || null;
}

function toneRank(tone: CompletionEvidenceEscalationRow['tone']) {
  const ranks: Record<CompletionEvidenceEscalationRow['tone'], number> = { rose: 0, amber: 1, slate: 2, emerald: 3 };
  return ranks[tone];
}

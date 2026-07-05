type PriorityTone = 'rose' | 'amber' | 'blue' | 'violet' | 'emerald' | 'slate';

export type SalesPriorityItem = {
  id: string;
  kind: 'MESSAGE_SLA' | 'SALES_TASK' | 'OPPORTUNITY_STALL' | 'CUSTOMER_HEALTH' | 'AUTOMATION_RISK' | 'EMAIL_ACTION' | 'HEALTH_TASK';
  kindLabel: string;
  title: string;
  subject: string;
  ownerName: string;
  href: string;
  score: number;
  impactUSD: number;
  reason: string;
  action: string;
  evidence: string;
  tone: PriorityTone;
};

export type SalesOwnerPriorityRow = {
  ownerName: string;
  itemCount: number;
  urgentCount: number;
  maxScore: number;
  impactUSD: number;
  topKindLabel: string;
  topTitle: string;
  topReason: string;
  nextAction: string;
  focusMix: Array<{ label: string; count: number }>;
};

type ChannelSample = {
  id: string;
  companyId: string;
  companyName: string;
  ownerName: string;
  channelLabel: string;
  intentLabel: string;
  statusLabel: string;
  isOverdue: boolean;
  ageHours: number;
  downstreamOutcomes: number;
  wonRevenue: number;
  taskConverted: boolean;
};

type SalesTaskInput = {
  id: string;
  title: string;
  priority: string;
  dueAt: Date | null;
  company?: { id: string; name: string } | null;
  owner?: { name: string | null; email: string } | null;
  opportunity?: { id: string; title: string; amountUSD: number | null; stage: string } | null;
};

type StaleOpportunityInput = {
  ageDays: number;
  opportunity: {
    id: string;
    title: string;
    amountUSD: number | null;
    stage: string;
    company?: { name: string } | null;
    owner?: { name: string | null; email: string } | null;
  };
};

type CustomerHealthInput = {
  company: {
    id: string;
    name: string;
    priorityScore: number;
    owner?: { name: string | null; email: string } | null;
  };
  health: {
    score: number;
    action: string;
    shortfalls: string[];
    priorityWeight: number;
  };
};

type AutomationRiskInput = {
  id: string;
  name: string;
  channelLabel: string;
  actionType: string;
  reason: string;
  weight: number;
  failedRuns: number;
  runs: number;
};

type ClosureTaskInput = {
  id: string;
  companyId: string;
  companyName: string;
  ownerName: string;
  status: string;
  statusLabel: string;
  isOverdue: boolean;
  downstreamOutcomes: number;
  wonRevenue: number;
  title?: string;
  categoryLabel?: string;
  sourceLabel?: string;
};

export function buildSalesPriorityQueue({
  channelSamples,
  salesTasks,
  staleOpportunities,
  customerHealthRows,
  automationRisks,
  emailTasks,
  healthTasks,
  now = new Date(),
  limit = 12,
}: {
  channelSamples: ChannelSample[];
  salesTasks: SalesTaskInput[];
  staleOpportunities: StaleOpportunityInput[];
  customerHealthRows: CustomerHealthInput[];
  automationRisks: AutomationRiskInput[];
  emailTasks: ClosureTaskInput[];
  healthTasks: ClosureTaskInput[];
  now?: Date;
  limit?: number;
}) {
  const items = [
    ...channelSamples.map((item) => messageItem(item)),
    ...salesTasks.map((task) => taskItem(task, now)),
    ...staleOpportunities.map((row) => opportunityItem(row)),
    ...customerHealthRows.map((row) => healthItem(row)),
    ...automationRisks.map((row) => automationItem(row)),
    ...emailTasks.map((row) => closureTaskItem(row, 'EMAIL_ACTION')),
    ...healthTasks.map((row) => closureTaskItem(row, 'HEALTH_TASK')),
  ]
    .filter((item) => item.score >= 55)
    .sort((a, b) => b.score - a.score || b.impactUSD - a.impactUSD || a.title.localeCompare(b.title, 'zh-CN'))
    .slice(0, limit);

  const byKind = groupByKind(items);
  const urgentCount = items.filter((item) => item.score >= 90).length;
  const revenueAtRisk = items.reduce((sum, item) => sum + item.impactUSD, 0);
  const topItem = items[0] || null;

  return {
    items,
    urgentCount,
    revenueAtRisk,
    totalCandidates: channelSamples.length + salesTasks.length + staleOpportunities.length + customerHealthRows.length + automationRisks.length + emailTasks.length + healthTasks.length,
    byKind,
    maxScore: Math.max(1, ...items.map((item) => item.score)),
    recommendation: priorityRecommendation({ items, urgentCount, revenueAtRisk, topItem }),
  };
}

export function buildSalesOwnerPriorityReport(items: SalesPriorityItem[]) {
  const buckets = new Map<string, SalesPriorityItem[]>();
  for (const item of items) {
    const ownerName = item.ownerName || '未分配';
    buckets.set(ownerName, [...(buckets.get(ownerName) || []), item]);
  }

  const rows = Array.from(buckets.entries())
    .map(([ownerName, ownerItems]) => {
      const sorted = [...ownerItems].sort((a, b) => b.score - a.score || b.impactUSD - a.impactUSD);
      const top = sorted[0];
      return {
        ownerName,
        itemCount: ownerItems.length,
        urgentCount: ownerItems.filter((item) => item.score >= 90).length,
        maxScore: top?.score || 0,
        impactUSD: ownerItems.reduce((sum, item) => sum + item.impactUSD, 0),
        topKindLabel: top?.kindLabel || '-',
        topTitle: top?.title || '-',
        topReason: top?.reason || '-',
        nextAction: ownerNextAction(sorted),
        focusMix: ownerFocusMix(ownerItems),
      };
    })
    .sort((a, b) => b.urgentCount - a.urgentCount || b.impactUSD - a.impactUSD || b.maxScore - a.maxScore || b.itemCount - a.itemCount);

  return {
    rows,
    ownerCount: rows.length,
    urgentOwnerCount: rows.filter((row) => row.urgentCount > 0).length,
    totalImpactUSD: rows.reduce((sum, row) => sum + row.impactUSD, 0),
    maxImpactUSD: Math.max(1, ...rows.map((row) => row.impactUSD)),
    recommendation: ownerReportRecommendation(rows),
  };
}

function messageItem(item: ChannelSample): SalesPriorityItem {
  const impact = item.wonRevenue || item.downstreamOutcomes * 2500;
  const score = clamp(
    58 +
    (item.isOverdue ? 28 : 0) +
    Math.min(24, Math.floor(item.ageHours / 4)) +
    (item.taskConverted ? 0 : 12) +
    item.downstreamOutcomes * 8 +
    revenueScore(impact)
  );
  return {
    id: `MESSAGE_SLA:${item.id}`,
    kind: 'MESSAGE_SLA',
    kindLabel: '客户消息',
    title: item.companyName,
    subject: `${item.channelLabel} · ${item.intentLabel}`,
    ownerName: item.ownerName,
    href: `/customers/${item.companyId}`,
    score,
    impactUSD: impact,
    reason: item.isOverdue ? `客户已等待 ${item.ageHours}h` : `${item.statusLabel} · 等待 ${item.ageHours}h`,
    action: item.taskConverted ? '确认负责人跟进结果并推进商机。' : '先回复客户,再转销售任务或商机。',
    evidence: `推进 ${item.downstreamOutcomes} · 赢单 $${Math.round(item.wonRevenue).toLocaleString()}`,
    tone: item.isOverdue ? 'rose' : 'blue',
  };
}

function taskItem(task: SalesTaskInput, now: Date): SalesPriorityItem {
  const dueAt = task.dueAt || now;
  const overdueHours = Math.max(0, Math.floor((now.getTime() - dueAt.getTime()) / 3600000));
  const impact = task.opportunity?.amountUSD || 0;
  const priorityBonus = task.priority === 'URGENT' ? 18 : task.priority === 'HIGH' ? 12 : task.priority === 'LOW' ? -8 : 0;
  const score = clamp(58 + priorityBonus + (overdueHours > 0 ? 24 + Math.min(24, Math.floor(overdueHours / 4)) : 8) + revenueScore(impact));
  return {
    id: `SALES_TASK:${task.id}`,
    kind: 'SALES_TASK',
    kindLabel: '销售任务',
    title: task.company?.name || task.title,
    subject: task.title,
    ownerName: task.owner?.name || task.owner?.email || '未分配',
    href: task.company?.id ? `/customers/${task.company.id}` : '/tasks',
    score,
    impactUSD: impact,
    reason: overdueHours > 0 ? `逾期 ${overdueHours}h` : '24 小时内到期',
    action: '完成任务并写跟进结果,必要时推进商机阶段。',
    evidence: task.opportunity ? `${task.opportunity.title} · $${Math.round(impact).toLocaleString()}` : `优先级 ${task.priority}`,
    tone: overdueHours > 0 ? 'rose' : 'amber',
  };
}

function opportunityItem(row: StaleOpportunityInput): SalesPriorityItem {
  const opportunity = row.opportunity;
  const impact = opportunity.amountUSD || 0;
  const score = clamp(66 + Math.min(32, row.ageDays * 2) + stageBonus(opportunity.stage) + revenueScore(impact));
  return {
    id: `OPPORTUNITY_STALL:${opportunity.id}`,
    kind: 'OPPORTUNITY_STALL',
    kindLabel: '停滞商机',
    title: opportunity.title,
    subject: opportunity.company?.name || '未关联客户',
    ownerName: opportunity.owner?.name || opportunity.owner?.email || '未分配',
    href: `/opportunity/${opportunity.id}`,
    score,
    impactUSD: impact,
    reason: `阶段停留 ${row.ageDays} 天`,
    action: '补下一步动作,确认报价/样品/付款/规格堵点。',
    evidence: `${stageLabel(opportunity.stage)} · $${Math.round(impact).toLocaleString()}`,
    tone: row.ageDays >= 14 || impact >= 10000 ? 'rose' : 'amber',
  };
}

function healthItem(row: CustomerHealthInput): SalesPriorityItem {
  const score = clamp(56 + (100 - row.health.score) * 0.55 + row.health.priorityWeight * 0.25 + row.company.priorityScore * 0.12);
  return {
    id: `CUSTOMER_HEALTH:${row.company.id}`,
    kind: 'CUSTOMER_HEALTH',
    kindLabel: '客户健康',
    title: row.company.name,
    subject: row.health.shortfalls.join(' / ') || '健康短板',
    ownerName: row.company.owner?.name || row.company.owner?.email || '未分配',
    href: `/customers/${row.company.id}`,
    score,
    impactUSD: row.company.priorityScore * 100,
    reason: `健康分 ${row.health.score}`,
    action: row.health.action,
    evidence: `客户优先级 ${row.company.priorityScore}`,
    tone: row.health.score < 50 ? 'rose' : 'violet',
  };
}

function automationItem(row: AutomationRiskInput): SalesPriorityItem {
  const score = clamp(row.weight + (row.failedRuns > 0 ? 10 : 0));
  return {
    id: `AUTOMATION_RISK:${row.id}`,
    kind: 'AUTOMATION_RISK',
    kindLabel: '自动化风险',
    title: row.name,
    subject: `${row.channelLabel} · ${row.actionType}`,
    ownerName: '系统运营',
    href: `/automation?flow=${row.id}`,
    score,
    impactUSD: row.failedRuns * 1000,
    reason: row.reason,
    action: '复核条件、动作和失败记录,必要时重放或暂停流程。',
    evidence: `${row.runs} 次运行 · ${row.failedRuns} 次失败`,
    tone: row.failedRuns > 0 || row.weight >= 90 ? 'rose' : 'violet',
  };
}

function closureTaskItem(row: ClosureTaskInput, kind: 'EMAIL_ACTION' | 'HEALTH_TASK'): SalesPriorityItem {
  const impact = row.wonRevenue || row.downstreamOutcomes * 2500;
  const score = clamp(54 + (row.isOverdue ? 28 : 0) + (row.status === 'DONE' ? -12 : 10) + row.downstreamOutcomes * 8 + revenueScore(impact));
  const isEmail = kind === 'EMAIL_ACTION';
  return {
    id: `${kind}:${row.id}`,
    kind,
    kindLabel: isEmail ? '邮件动作' : '健康任务',
    title: row.companyName,
    subject: row.title || row.categoryLabel || row.sourceLabel || row.statusLabel,
    ownerName: row.ownerName,
    href: `/customers/${row.companyId}`,
    score,
    impactUSD: impact,
    reason: row.isOverdue ? '任务已逾期' : row.statusLabel,
    action: isEmail ? '处理邮件动作任务,同步客户阶段和下一步。' : '完成健康修复任务,补齐资料/联系人/互动/商机。',
    evidence: `推进 ${row.downstreamOutcomes} · 赢单 $${Math.round(row.wonRevenue).toLocaleString()}`,
    tone: row.isOverdue ? 'rose' : isEmail ? 'blue' : 'violet',
  };
}

function groupByKind(items: SalesPriorityItem[]) {
  const labels = new Map<SalesPriorityItem['kind'], string>();
  const counts = new Map<SalesPriorityItem['kind'], number>();
  for (const item of items) {
    labels.set(item.kind, item.kindLabel);
    counts.set(item.kind, (counts.get(item.kind) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([kind, count]) => ({ kind, label: labels.get(kind) || kind, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-CN'));
}

function ownerFocusMix(items: SalesPriorityItem[]) {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.kindLabel, (counts.get(item.kindLabel) || 0) + 1);
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-CN'))
    .slice(0, 4);
}

function ownerNextAction(items: SalesPriorityItem[]) {
  const urgent = items.find((item) => item.score >= 90);
  if (urgent) return `${urgent.kindLabel}: ${urgent.action}`;
  const revenue = items.find((item) => item.impactUSD >= 10000);
  if (revenue) return `${revenue.kindLabel}: ${revenue.action}`;
  return items[0]?.action || '暂无动作';
}

function ownerReportRecommendation(rows: SalesOwnerPriorityRow[]) {
  if (rows.length === 0) return '暂无负责人风险分布。先让消息、任务、商机和自动化风险进入作战清单。';
  const urgentOwners = rows.filter((row) => row.urgentCount > 0);
  if (urgentOwners.length > 0) return `今日 ${urgentOwners.length} 个负责人有高危事项。晨会先盯“${urgentOwners[0].ownerName}”,再按影响金额分配支援。`;
  const top = rows[0];
  if (top?.impactUSD > 0) return `今日负责人风险主要集中在“${top.ownerName}”,关联约 $${Math.round(top.impactUSD).toLocaleString()} 机会影响。`;
  return `今日 ${rows.length} 个负责人有待处理事项。按负责人逐项确认下一步和截止时间。`;
}

function priorityRecommendation(input: { items: SalesPriorityItem[]; urgentCount: number; revenueAtRisk: number; topItem: SalesPriorityItem | null }) {
  if (input.items.length === 0) return '今日暂无高优先级风险。继续保持消息、任务、商机和自动化数据沉淀。';
  if (input.urgentCount > 0) return `今日有 ${input.urgentCount} 个高危事项。先处理“${input.topItem?.title || '最高优先级'}”,再按清单顺序推进。`;
  if (input.revenueAtRisk > 0) return `今日清单关联约 $${Math.round(input.revenueAtRisk).toLocaleString()} 收入/机会影响。建议晨会按负责人逐项确认下一步。`;
  return `今日有 ${input.items.length} 个重点事项。先清逾期消息和任务,再处理停滞商机与自动化风险。`;
}

function revenueScore(value: number) {
  return Math.min(28, Math.floor(Math.max(0, value) / 1000));
}

function stageBonus(stage: string) {
  if (stage === 'NEGOTIATING') return 12;
  if (stage === 'SPEC_CONFIRMING') return 10;
  if (stage === 'QUOTING') return 7;
  return 4;
}

function stageLabel(stage: string) {
  const labels: Record<string, string> = {
    UNPROCESSED: '未处理',
    REPLIED: '已回复',
    QUOTING: '报价中',
    NEGOTIATING: '谈判中',
    SPEC_CONFIRMING: '规格确认',
    CLOSED_WON: '已成交',
    CLOSED_LOST: '已流失',
  };
  return labels[stage] || stage;
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

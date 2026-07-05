type CustomerHealthContact = {
  email?: string | null;
  phone?: string | null;
};

type CustomerHealthOpportunity = {
  stage?: string | null;
  stageChangedAt?: Date | string | null;
  updatedAt?: Date | string | null;
};

type CustomerHealthFollowUp = {
  createdAt?: Date | string | null;
};

type CustomerHealthInboxMessage = {
  direction?: string | null;
  sentAt?: Date | string | null;
  createdAt?: Date | string | null;
};

type CustomerHealthSalesTask = {
  dueAt?: Date | string | null;
};

export type CustomerHealthCompany = {
  id?: string;
  name: string;
  customerCode?: string | null;
  type?: string | null;
  country?: string | null;
  industry?: string | null;
  website?: string | null;
  mainProducts?: string | null;
  customerProfile?: string | null;
  painPoints?: string | null;
  competitors?: string | null;
  nextAction?: string | null;
  ownerId?: string | null;
  owner?: {
    name?: string | null;
    email?: string | null;
  } | null;
  contacts?: CustomerHealthContact[];
  opportunities?: CustomerHealthOpportunity[];
  followUps?: CustomerHealthFollowUp[];
  inboxMessages?: CustomerHealthInboxMessage[];
  salesTasks?: CustomerHealthSalesTask[];
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
};

export type CustomerHealthDimensionKey = 'fitScore' | 'contactScore' | 'engagementScore' | 'pipelineScore' | 'ownerScore';

export type CustomerHealthRow = {
  id?: string;
  name: string;
  typeLabel: string;
  ownerLabel: string;
  score: number;
  fitScore: number;
  contactScore: number;
  engagementScore: number;
  pipelineScore: number;
  ownerScore: number;
  shortfalls: string[];
  action: string;
  daysSinceLastInteraction: number;
  openOpportunityCount: number;
  stalledOpportunityCount: number;
  overdueTaskCount: number;
  noNextAction: boolean;
  hasOwner: boolean;
  isStale: boolean;
  hasRecentInbound: boolean;
  priorityWeight: number;
};

export type CustomerHealthReport = {
  customerCount: number;
  avgScore: number;
  hotCount: number;
  missingProfileCount: number;
  unassignedCount: number;
  noNextActionCount: number;
  staleCount: number;
  priorityRows: CustomerHealthRow[];
  dimensionRows: Array<{
    key: CustomerHealthDimensionKey;
    label: string;
    avgScore: number;
    passCount: number;
  }>;
  recommendation: string;
};

const CLOSED_STAGES = new Set(['CLOSED_WON', 'CLOSED_LOST']);

const TYPE_LABEL: Record<string, string> = {
  INQUIRY: '询盘客户',
  QUOTED: '已报价客户',
  CONTRACT_SENT: '已发合同客户',
  DEAL_WON: '已成交客户',
  NEW: '新客户',
  EXISTING: '已成交/老客户',
  PROSPECT: '潜在客户',
  KEY_ACCOUNT: '老客户/大客户',
  LOST: '流失客户',
};

export function buildCustomerHealthReport(customers: CustomerHealthCompany[], now = new Date()): CustomerHealthReport {
  const rows = customers.map((customer) => buildCustomerHealthRow(customer, now));
  const customerCount = rows.length;
  const avgScore = customerCount ? Math.round(rows.reduce((sum, row) => sum + row.score, 0) / customerCount) : 0;
  const hotCount = rows.filter((row) => row.score >= 75 && (row.openOpportunityCount > 0 || row.daysSinceLastInteraction <= 14)).length;
  const missingProfileCount = rows.filter((row) => row.fitScore < 14).length;
  const unassignedCount = rows.filter((row) => !row.hasOwner).length;
  const noNextActionCount = rows.filter((row) => row.noNextAction).length;
  const staleCount = rows.filter((row) => row.isStale || row.stalledOpportunityCount > 0).length;
  const priorityRows = rows
    .filter((row) => row.shortfalls.length > 0 || row.score >= 75)
    .sort((a, b) => b.priorityWeight - a.priorityWeight || b.score - a.score || a.daysSinceLastInteraction - b.daysSinceLastInteraction)
    .slice(0, 8);
  const dimensionRows = [
    dimensionSummary(rows, 'fitScore', '资料完整'),
    dimensionSummary(rows, 'contactScore', '联系人'),
    dimensionSummary(rows, 'engagementScore', '互动热度'),
    dimensionSummary(rows, 'pipelineScore', '商机推进'),
    dimensionSummary(rows, 'ownerScore', '下一步/负责人'),
  ];

  return {
    customerCount,
    avgScore,
    hotCount,
    missingProfileCount,
    unassignedCount,
    noNextActionCount,
    staleCount,
    priorityRows,
    dimensionRows,
    recommendation: customerHealthRecommendation({ customerCount, avgScore, hotCount, missingProfileCount, unassignedCount, noNextActionCount, staleCount }),
  };
}

export function buildCustomerHealthRow(customer: CustomerHealthCompany, now = new Date()): CustomerHealthRow {
  const contacts = customer.contacts || [];
  const opportunities = customer.opportunities || [];
  const followUps = customer.followUps || [];
  const inboxMessages = customer.inboxMessages || [];
  const salesTasks = customer.salesTasks || [];

  const latestInboxAt = latestDate(inboxMessages.map((m) => m.sentAt || m.createdAt));
  const latestFollowUpAt = latestDate(followUps.map((f) => f.createdAt));
  const lastInteractionAt = latestDate([latestInboxAt, latestFollowUpAt, customer.updatedAt, customer.createdAt]);
  const daysSinceLastInteraction = daysSince(lastInteractionAt, now);
  const openOpportunities = opportunities.filter((opp) => !CLOSED_STAGES.has(String(opp.stage || '')));
  const stalledOpportunityCount = openOpportunities.filter((opp) => daysSince(opp.stageChangedAt || opp.updatedAt, now) >= 14).length;
  const hasEmailContact = contacts.some((contact) => Boolean(contact.email));
  const hasPhoneContact = contacts.some((contact) => Boolean(contact.phone));
  const hasRecentInbound = inboxMessages.some((msg) => msg.direction === 'IN' && daysSince(msg.sentAt || msg.createdAt, now) <= 14);
  const overdueTaskCount = salesTasks.filter((task) => task.dueAt && new Date(task.dueAt).getTime() < now.getTime()).length;
  const noNextAction = !String(customer.nextAction || '').trim();
  const hasOwner = Boolean(customer.ownerId || customer.owner);

  const fitScore =
    points(customer.customerCode, 3) +
    points(customer.country, 3) +
    points(customer.industry, 3) +
    points(customer.website, 2) +
    points(customer.mainProducts, 4) +
    points(customer.customerProfile || customer.painPoints || customer.competitors, 5);
  const contactScore = Math.min(20, contacts.length * 5 + (hasEmailContact ? 8 : 0) + (hasPhoneContact ? 4 : 0) + (contacts.length > 1 ? 3 : 0));
  const engagementScore = daysSinceLastInteraction <= 7 ? 20 : daysSinceLastInteraction <= 14 ? 17 : daysSinceLastInteraction <= 30 ? 12 : daysSinceLastInteraction <= 90 ? 6 : 0;
  const pipelineScore = Math.min(
    20,
    (openOpportunities.length > 0 ? 10 : 0) +
      (opportunities.some((opp) => opp.stage === 'CLOSED_WON') ? 7 : 0) +
      (opportunities.length > 0 ? 3 : 0) -
      Math.min(8, stalledOpportunityCount * 4)
  );
  const ownerScore = Math.min(20, (hasOwner ? 8 : 0) + (!noNextAction ? 8 : 0) + (salesTasks.length > 0 ? 4 : 0) - Math.min(8, overdueTaskCount * 4));
  const score = Math.max(0, Math.min(100, fitScore + contactScore + engagementScore + pipelineScore + ownerScore));

  const shortfalls: string[] = [];
  if (fitScore < 14) shortfalls.push('资料');
  if (contactScore < 14) shortfalls.push('联系人');
  if (engagementScore < 12) shortfalls.push('互动');
  if (pipelineScore < 10) shortfalls.push('商机');
  if (ownerScore < 14) shortfalls.push('下一步');
  if (stalledOpportunityCount > 0) shortfalls.push('停滞');
  if (overdueTaskCount > 0) shortfalls.push('逾期任务');

  const isStale = daysSinceLastInteraction >= 30;
  const priorityWeight =
    (score >= 75 ? 18 : 0) +
    (hasRecentInbound ? 16 : 0) +
    (openOpportunities.length > 0 ? 12 : 0) +
    stalledOpportunityCount * 10 +
    overdueTaskCount * 9 +
    (isStale ? 8 : 0) +
    (!hasOwner ? 7 : 0) +
    (noNextAction ? 5 : 0);

  return {
    id: customer.id,
    name: customer.name,
    typeLabel: TYPE_LABEL[String(customer.type || '')] || String(customer.type || '未分类'),
    ownerLabel: customer.owner?.name || customer.owner?.email || '未分配',
    score,
    fitScore,
    contactScore,
    engagementScore,
    pipelineScore,
    ownerScore,
    shortfalls,
    action: customerHealthAction({ hasRecentInbound, openOpportunityCount: openOpportunities.length, stalledOpportunityCount, overdueTaskCount, isStale, noNextAction, hasOwner, score }),
    daysSinceLastInteraction,
    openOpportunityCount: openOpportunities.length,
    stalledOpportunityCount,
    overdueTaskCount,
    noNextAction,
    hasOwner,
    isStale,
    hasRecentInbound,
    priorityWeight,
  };
}

function dimensionSummary(rows: CustomerHealthRow[], key: CustomerHealthDimensionKey, label: string) {
  const avgScore = rows.length ? Math.round(rows.reduce((sum, row) => sum + row[key], 0) / rows.length) : 0;
  return {
    key,
    label,
    avgScore,
    passCount: rows.filter((row) => row[key] >= 14).length,
  };
}

function customerHealthAction(input: { hasRecentInbound: boolean; openOpportunityCount: number; stalledOpportunityCount: number; overdueTaskCount: number; isStale: boolean; noNextAction: boolean; hasOwner: boolean; score: number }) {
  if (!input.hasOwner) return '先分配负责人,否则任何线索都没有闭环责任人。';
  if (input.overdueTaskCount > 0) return '先处理逾期任务,补跟进记录并更新下一步。';
  if (input.stalledOpportunityCount > 0) return '先推进停滞商机,更新阶段、报价或丢单原因。';
  if (input.hasRecentInbound) return '客户近期有来信,优先回复并把意向转成商机/报价。';
  if (input.noNextAction) return '补一条明确下一步动作,例如发资料、报价或约测试反馈。';
  if (input.isStale) return '客户已沉睡,发送激活邮件或释放到公海重分配。';
  if (input.openOpportunityCount > 0) return '继续推进当前商机,保持 7 天内有阶段动作。';
  if (input.score >= 75) return '资料和互动质量较好,可以创建商机或加入重点开发名单。';
  return '先补客户资料、联系人和画像,再判断是否值得继续开发。';
}

function customerHealthRecommendation(input: { customerCount: number; avgScore: number; hotCount: number; missingProfileCount: number; unassignedCount: number; noNextActionCount: number; staleCount: number }) {
  if (input.customerCount === 0) return '当前筛选下暂无客户。先导入/同步客户,再做五点体检。';
  if (input.unassignedCount > 0) return `有 ${input.unassignedCount} 个客户未分配负责人。先分配责任人,否则后续跟进和自动化都无法闭环。`;
  if (input.staleCount > 0) return `有 ${input.staleCount} 个客户存在沉睡或商机停滞。优先处理这些客户,避免询盘变成无效库存。`;
  if (input.missingProfileCount > 0) return `有 ${input.missingProfileCount} 个客户资料/画像不足。补齐国家、行业、关注产品、痛点和竞品后,AI 跟进会更准。`;
  if (input.noNextActionCount > 0) return `有 ${input.noNextActionCount} 个客户没有下一步动作。每个有效客户至少要有一个可执行动作。`;
  if (input.hotCount > 0) return `当前有 ${input.hotCount} 个高意向客户。建议销售主管优先检查是否已报价、建商机和安排下一轮跟进。`;
  return `客户平均健康度 ${input.avgScore},整体稳定。下一步可以把高分客户沉淀为重点账户运营。`;
}

function points(value: unknown, score: number) {
  return String(value || '').trim() ? score : 0;
}

function latestDate(values: Array<Date | string | null | undefined>) {
  const times = values
    .filter(Boolean)
    .map((value) => new Date(value as Date | string).getTime())
    .filter((time) => Number.isFinite(time));
  if (!times.length) return null;
  return new Date(Math.max(...times));
}

function daysSince(value: Date | string | null | undefined, now = new Date()) {
  if (!value) return 999;
  return Math.max(0, Math.floor((now.getTime() - new Date(value).getTime()) / 86400000));
}

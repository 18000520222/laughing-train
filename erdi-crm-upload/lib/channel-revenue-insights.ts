export type ChannelRevenueMessage = {
  id: string;
  channel: string;
  status: string;
  intent: string | null;
  companyId: string | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  company?: {
    id: string;
    name: string;
    owner?: { name: string | null; email: string } | null;
  } | null;
};

export type ChannelRevenueTask = {
  id: string;
  source: string;
  sourceRef: string | null;
  companyId: string;
  createdAt: Date;
};

export type ChannelRevenueOpportunity = {
  id: string;
  title: string;
  companyId: string;
  stage: string;
  amountUSD: number | null;
  stageChangedAt: Date;
  updatedAt: Date;
  owner?: { name: string | null; email: string } | null;
};

export type ChannelRevenueRow = {
  channel: string;
  channelLabel: string;
  messages: number;
  replied: number;
  pending: number;
  overduePending: number;
  highIntent: number;
  taskConverted: number;
  downstreamOutcomes: number;
  wonDeals: number;
  influencedRevenue: number;
  avgReplyHours: number | null;
  replyRate: number | null;
  slaRate: number | null;
  taskRate: number | null;
  outcomeRate: number | null;
  revenuePerMessage: number;
  healthScore: number;
};

export type ChannelRevenueSample = {
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

export function buildChannelMessageRevenueReport({
  messages,
  tasks,
  opportunities,
  until = new Date(),
}: {
  messages: ChannelRevenueMessage[];
  tasks: ChannelRevenueTask[];
  opportunities: ChannelRevenueOpportunity[];
  until?: Date;
}) {
  const inbound = messages.filter((message) => message.companyId);
  const tasksByInboxId = new Map<string, ChannelRevenueTask[]>();
  const tasksByCompany = new Map<string, ChannelRevenueTask[]>();
  for (const task of tasks) {
    tasksByCompany.set(task.companyId, [...(tasksByCompany.get(task.companyId) || []), task]);
    const inboxId = inboxIdFromSourceRef(task.sourceRef);
    if (!inboxId) continue;
    tasksByInboxId.set(inboxId, [...(tasksByInboxId.get(inboxId) || []), task]);
  }

  const opportunitiesByCompany = new Map<string, ChannelRevenueOpportunity[]>();
  for (const opportunity of opportunities) {
    opportunitiesByCompany.set(opportunity.companyId, [...(opportunitiesByCompany.get(opportunity.companyId) || []), opportunity]);
  }

  const normalized = inbound.map((message) => normalizeMessage(
    message,
    relatedTasksForMessage(message, tasksByInboxId, tasksByCompany),
    opportunitiesByCompany.get(message.companyId || '') || [],
    until
  ));
  const byChannel = buildChannelRows(normalized);
  const uniqueInfluencedOpps = uniqueOpps(normalized.flatMap((row) => row.downstreamOpportunities));
  const uniqueWonOpps = uniqueInfluencedOpps.filter((opp) => opp.stage === 'CLOSED_WON');
  const replied = normalized.filter((row) => row.replied).length;
  const pending = normalized.filter((row) => row.pending).length;
  const overduePending = normalized.filter((row) => row.overduePending).length;
  const highIntent = normalized.filter((row) => row.highIntent).length;
  const taskConverted = normalized.filter((row) => row.taskConverted).length;
  const repliedWithin24 = normalized.filter((row) => row.replied && row.replyHours !== null && row.replyHours <= 24).length;
  const replyHours = normalized.map((row) => row.replyHours).filter((value): value is number => value !== null);
  const samples = normalized
    .map((row) => ({
      id: row.id,
      companyId: row.companyId,
      companyName: row.companyName,
      ownerName: row.ownerName,
      channelLabel: channelLabel(row.channel),
      intentLabel: intentLabel(row.intent),
      statusLabel: statusLabel(row.status),
      isOverdue: row.overduePending,
      ageHours: row.ageHours,
      downstreamOutcomes: uniqueOpps(row.downstreamOpportunities).length,
      wonRevenue: uniqueOpps(row.downstreamOpportunities).filter((opp) => opp.stage === 'CLOSED_WON').reduce((sum, opp) => sum + (opp.amountUSD || 0), 0),
      taskConverted: row.taskConverted,
    }))
    .sort((a, b) => b.wonRevenue - a.wonRevenue || b.downstreamOutcomes - a.downstreamOutcomes || Number(b.isOverdue) - Number(a.isOverdue) || Number(b.taskConverted) - Number(a.taskConverted))
    .slice(0, 8);

  const total = normalized.length;
  const influencedRevenue = uniqueWonOpps.reduce((sum, opp) => sum + (opp.amountUSD || 0), 0);
  const bestChannel = byChannel.find((row) => row.influencedRevenue > 0) || byChannel[0] || null;

  return {
    total,
    replied,
    pending,
    overduePending,
    highIntent,
    taskConverted,
    downstreamOutcomes: uniqueInfluencedOpps.length,
    wonDeals: uniqueWonOpps.length,
    influencedRevenue,
    replyRate: total ? replied / total : null,
    slaRate: replied ? repliedWithin24 / replied : null,
    taskRate: total ? taskConverted / total : null,
    outcomeRate: total ? uniqueInfluencedOpps.length / total : null,
    avgReplyHours: average(replyHours),
    byChannel,
    samples,
    bestChannel,
    maxChannelMessages: Math.max(1, ...byChannel.map((row) => row.messages)),
    maxChannelRevenue: Math.max(1, ...byChannel.map((row) => row.influencedRevenue)),
    recommendation: channelRevenueRecommendation({ total, pending, overduePending, highIntent, taskConverted, downstreamOutcomes: uniqueInfluencedOpps.length, influencedRevenue, bestChannel }),
  };
}

function normalizeMessage(
  message: ChannelRevenueMessage,
  relatedTasks: ChannelRevenueTask[],
  companyOpportunities: ChannelRevenueOpportunity[],
  until: Date
) {
  const baseAt = message.sentAt || message.createdAt;
  const ageHours = Math.max(0, Math.floor((until.getTime() - baseAt.getTime()) / 3600000));
  const replied = message.status === 'REPLIED';
  const pending = message.status === 'NEW' || message.status === 'AI_DRAFTED';
  const overduePending = pending && ageHours >= 24;
  const replyHours = replied ? Math.max(0, (message.updatedAt.getTime() - baseAt.getTime()) / 3600000) : null;
  const downstreamOpportunities = companyOpportunities.filter((opportunity) => {
    const changedAt = opportunity.stageChangedAt || opportunity.updatedAt;
    return changedAt >= baseAt && changedAt <= until;
  });

  return {
    id: message.id,
    channel: String(message.channel),
    status: String(message.status),
    intent: String(message.intent || ''),
    companyId: message.companyId || '',
    companyName: message.company?.name || '未关联客户',
    ownerName: message.company?.owner?.name || message.company?.owner?.email || '未分配',
    ageHours,
    replied,
    pending,
    overduePending,
    replyHours,
    highIntent: HIGH_INTENTS.has(String(message.intent || '')),
    taskConverted: relatedTasks.length > 0,
    downstreamOpportunities,
  };
}

function relatedTasksForMessage(
  message: ChannelRevenueMessage,
  tasksByInboxId: Map<string, ChannelRevenueTask[]>,
  tasksByCompany: Map<string, ChannelRevenueTask[]>
) {
  const directTasks = tasksByInboxId.get(message.id) || [];
  const directIds = new Set(directTasks.map((task) => task.id));
  const baseAt = message.sentAt || message.createdAt;
  const windowEnd = new Date(baseAt.getTime() + 7 * 24 * 60 * 60 * 1000);
  const indirectTasks = (tasksByCompany.get(message.companyId || '') || []).filter((task) => (
    !directIds.has(task.id) &&
    MESSAGE_TASK_SOURCES.has(task.source) &&
    task.createdAt >= baseAt &&
    task.createdAt <= windowEnd
  ));
  return [...directTasks, ...indirectTasks];
}

function buildChannelRows(rows: ReturnType<typeof normalizeMessage>[]): ChannelRevenueRow[] {
  const buckets = new Map<string, ReturnType<typeof normalizeMessage>[]>();
  for (const row of rows) {
    buckets.set(row.channel, [...(buckets.get(row.channel) || []), row]);
  }

  return Array.from(buckets.entries())
    .map(([channel, bucket]) => {
      const messages = bucket.length;
      const replied = bucket.filter((row) => row.replied).length;
      const pending = bucket.filter((row) => row.pending).length;
      const overduePending = bucket.filter((row) => row.overduePending).length;
      const highIntent = bucket.filter((row) => row.highIntent).length;
      const taskConverted = bucket.filter((row) => row.taskConverted).length;
      const replyHours = bucket.map((row) => row.replyHours).filter((value): value is number => value !== null);
      const repliedWithin24 = bucket.filter((row) => row.replied && row.replyHours !== null && row.replyHours <= 24).length;
      const downstreamOpps = uniqueOpps(bucket.flatMap((row) => row.downstreamOpportunities));
      const wonOpps = downstreamOpps.filter((opp) => opp.stage === 'CLOSED_WON');
      const influencedRevenue = wonOpps.reduce((sum, opp) => sum + (opp.amountUSD || 0), 0);
      const avgReplyHours = average(replyHours);
      return {
        channel,
        channelLabel: channelLabel(channel),
        messages,
        replied,
        pending,
        overduePending,
        highIntent,
        taskConverted,
        downstreamOutcomes: downstreamOpps.length,
        wonDeals: wonOpps.length,
        influencedRevenue,
        avgReplyHours,
        replyRate: messages ? replied / messages : null,
        slaRate: replied ? repliedWithin24 / replied : null,
        taskRate: messages ? taskConverted / messages : null,
        outcomeRate: messages ? downstreamOpps.length / messages : null,
        revenuePerMessage: messages ? influencedRevenue / messages : 0,
        healthScore: channelHealthScore({ messages, replied, pending, overduePending, taskConverted, downstreamOutcomes: downstreamOpps.length, influencedRevenue, avgReplyHours }),
      };
    })
    .sort((a, b) => b.influencedRevenue - a.influencedRevenue || b.downstreamOutcomes - a.downstreamOutcomes || b.highIntent - a.highIntent || b.messages - a.messages);
}

function channelRevenueRecommendation(input: {
  total: number;
  pending: number;
  overduePending: number;
  highIntent: number;
  taskConverted: number;
  downstreamOutcomes: number;
  influencedRevenue: number;
  bestChannel: ChannelRevenueRow | null;
}) {
  if (input.total === 0) return '近 30 天暂无可归因的客户入站消息。先确认 Gmail、WhatsApp、阿里国际站等渠道都写入全渠道收件箱并关联客户。';
  if (input.overduePending > 0) return `有 ${input.overduePending} 条客户消息超过 24 小时未处理。先按渠道 SLA 清掉逾期,再谈收入归因。`;
  if (input.highIntent > 0 && input.taskConverted === 0) return `近 30 天有 ${input.highIntent} 条高意向消息,但没有转成销售任务。需要把询价、索样、订单和投诉自动沉淀到待办。`;
  if (input.downstreamOutcomes === 0) return `已有 ${input.total} 条客户消息进入 CRM,但暂未看到后续商机推进。重点检查回复后是否创建商机/阶段推进。`;
  if (input.influencedRevenue > 0) return `消息渠道已影响 $${Math.round(input.influencedRevenue).toLocaleString()} 赢单收入;当前最强渠道是“${input.bestChannel?.channelLabel || '未知'}”,建议复盘该渠道话术和分配节奏。`;
  return `近 30 天客户消息已带来 ${input.downstreamOutcomes} 个商机推进,但暂未形成赢单收入。下一步盯报价到成交的转化和停滞救援。`;
}

function channelHealthScore(input: {
  messages: number;
  replied: number;
  pending: number;
  overduePending: number;
  taskConverted: number;
  downstreamOutcomes: number;
  influencedRevenue: number;
  avgReplyHours: number | null;
}) {
  if (input.messages === 0) return 50;
  const replyRate = input.replied / input.messages;
  const pendingRate = input.pending / input.messages;
  const overdueRate = input.overduePending / input.messages;
  const taskRate = input.taskConverted / input.messages;
  const outcomeRate = input.downstreamOutcomes / input.messages;
  const replyPenalty = input.avgReplyHours === null ? 0 : Math.max(0, input.avgReplyHours - 24) * 1.2;
  const revenueBonus = input.influencedRevenue > 0 ? 12 : 0;
  const score = 50 + replyRate * 18 + taskRate * 12 + outcomeRate * 18 + revenueBonus - pendingRate * 16 - overdueRate * 22 - replyPenalty;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function uniqueOpps(opportunities: ChannelRevenueOpportunity[]) {
  const byId = new Map<string, ChannelRevenueOpportunity>();
  for (const opportunity of opportunities) byId.set(opportunity.id, opportunity);
  return Array.from(byId.values());
}

function inboxIdFromSourceRef(sourceRef: string | null) {
  if (!sourceRef?.startsWith('inbox:')) return null;
  return sourceRef.slice('inbox:'.length);
}

function average(values: number[]) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function channelLabel(channel: string) {
  const labels: Record<string, string> = {
    EMAIL: '邮件',
    WHATSAPP: 'WhatsApp',
    ALIBABA: '阿里国际站',
    AMAZON: 'Amazon',
    SHOPEE: 'Shopee',
    FACEBOOK: 'Facebook',
    LINKEDIN: 'LinkedIn',
  };
  return labels[channel] || channel;
}

export function intentLabel(intent: string) {
  const labels: Record<string, string> = {
    PRICE_INQUIRY: '询价',
    PRODUCT_QUESTION: '产品问题',
    SAMPLE_REQUEST: '索样',
    ORDER_STATUS: '订单进度',
    COMPLAINT: '投诉/售后',
    OTHER: '其他',
    UNKNOWN: '未知',
  };
  return labels[intent || 'UNKNOWN'] || intent || '未知';
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    NEW: '待处理',
    AI_DRAFTED: 'AI 草稿',
    REPLIED: '已回复',
    ARCHIVED: '已归档',
  };
  return labels[status] || status;
}

const HIGH_INTENTS = new Set(['PRICE_INQUIRY', 'PRODUCT_QUESTION', 'SAMPLE_REQUEST', 'ORDER_STATUS', 'COMPLAINT']);

const MESSAGE_TASK_SOURCES = new Set(['OMNIBOX_BULK', 'AUTOMATION_NO_REPLY_TIMEOUT', 'EMAIL_ACTION_BULK']);

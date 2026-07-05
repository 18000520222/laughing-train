type OmniboxInsightMessage = {
  id: string;
  channel: string;
  status: string;
  intent: string | null;
  aiReplyZh: string | null;
  aiAutoSendable: boolean;
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

type OmniboxInsightTask = {
  id: string;
  title: string;
  status: string;
  sourceRef: string | null;
  createdAt: Date;
  company: { id: string; name: string };
  owner: { name: string | null; email: string };
};

export type OmniboxInsightBreakdownRow = {
  key: string;
  label: string;
  total: number;
  pending: number;
  replied: number;
  archived: number;
  draftReady: number;
  autoSendable: number;
  taskConverted: number;
  avgReplyHours: number | null;
  replyRate: number | null;
  slaRate: number | null;
  taskRate: number | null;
  healthScore: number;
};

export function buildOmniboxEffectivenessReport({
  messages,
  tasks,
}: {
  messages: OmniboxInsightMessage[];
  tasks: OmniboxInsightTask[];
}) {
  const taskInboxIds = new Set(tasks.map((task) => inboxIdFromSourceRef(task.sourceRef)).filter(Boolean) as string[]);
  const normalized = messages.map((message) => normalizeMessage(message, taskInboxIds.has(message.id)));
  const total = normalized.length;
  const pending = normalized.filter((row) => row.pending).length;
  const replied = normalized.filter((row) => row.replied).length;
  const archived = normalized.filter((row) => row.archived).length;
  const draftReady = normalized.filter((row) => row.draftReady).length;
  const autoSendable = normalized.filter((row) => row.autoSendable).length;
  const taskConverted = normalized.filter((row) => row.taskConverted).length;
  const highIntent = normalized.filter((row) => row.highIntent).length;
  const highIntentPending = normalized.filter((row) => row.highIntent && row.pending).length;
  const replyHours = normalized.map((row) => row.replyHours).filter((value): value is number => value !== null);
  const repliedWithin24 = normalized.filter((row) => row.replied && row.replyHours !== null && row.replyHours <= 24).length;
  const byChannel = buildBreakdown(normalized, (row) => row.channel, (key) => CHANNEL_LABEL[key] || key);
  const byIntent = buildBreakdown(normalized, (row) => row.intent || 'UNKNOWN', (key) => INTENT_LABEL[key] || key);
  const byOwner = buildBreakdown(normalized, (row) => row.ownerKey, (key) => key);
  const taskSamples = tasks.slice(0, 8).map((task) => ({
    id: task.id,
    title: task.title,
    status: task.status,
    companyName: task.company.name,
    ownerName: task.owner.name || task.owner.email,
    createdAtLabel: task.createdAt.toLocaleDateString('zh-CN'),
  }));

  return {
    total,
    pending,
    replied,
    archived,
    draftReady,
    autoSendable,
    taskConverted,
    highIntent,
    highIntentPending,
    replyRate: total ? replied / total : null,
    slaRate: replied ? repliedWithin24 / replied : null,
    draftRate: total ? draftReady / total : null,
    taskRate: total ? taskConverted / total : null,
    avgReplyHours: average(replyHours),
    byChannel,
    byIntent,
    byOwner,
    taskSamples,
    maxChannelTotal: Math.max(1, ...byChannel.map((row) => row.total)),
    maxIntentTotal: Math.max(1, ...byIntent.map((row) => row.total)),
    maxOwnerTotal: Math.max(1, ...byOwner.map((row) => row.total)),
    recommendation: omniboxEffectivenessRecommendation({ total, pending, replied, highIntentPending, draftReady, taskConverted, tasks: tasks.length, repliedWithin24 }),
  };
}

function normalizeMessage(message: OmniboxInsightMessage, taskConverted: boolean) {
  const replied = message.status === 'REPLIED';
  const pending = message.status === 'NEW' || message.status === 'AI_DRAFTED';
  const archived = message.status === 'ARCHIVED';
  const baseAt = message.sentAt || message.createdAt;
  const replyHours = replied ? Math.max(0, (message.updatedAt.getTime() - baseAt.getTime()) / 3600000) : null;
  const intent = String(message.intent || '');
  return {
    id: message.id,
    channel: String(message.channel),
    status: String(message.status),
    intent,
    ownerKey: message.company?.owner ? (message.company.owner.name || message.company.owner.email) : message.companyId ? '未分配负责人' : '未关联客户',
    pending,
    replied,
    archived,
    draftReady: Boolean(message.aiReplyZh),
    autoSendable: Boolean(message.aiAutoSendable),
    taskConverted,
    highIntent: HIGH_INTENTS.has(intent),
    replyHours,
  };
}

function buildBreakdown(
  rows: ReturnType<typeof normalizeMessage>[],
  keyOf: (row: ReturnType<typeof normalizeMessage>) => string,
  labelOf: (key: string) => string
): OmniboxInsightBreakdownRow[] {
  const buckets = new Map<string, ReturnType<typeof normalizeMessage>[]>();
  for (const row of rows) {
    const key = keyOf(row) || 'UNKNOWN';
    buckets.set(key, [...(buckets.get(key) || []), row]);
  }
  return Array.from(buckets.entries())
    .map(([key, bucket]) => {
      const total = bucket.length;
      const pending = bucket.filter((row) => row.pending).length;
      const replied = bucket.filter((row) => row.replied).length;
      const archived = bucket.filter((row) => row.archived).length;
      const draftReady = bucket.filter((row) => row.draftReady).length;
      const autoSendable = bucket.filter((row) => row.autoSendable).length;
      const taskConverted = bucket.filter((row) => row.taskConverted).length;
      const replyHours = bucket.map((row) => row.replyHours).filter((value): value is number => value !== null);
      const repliedWithin24 = bucket.filter((row) => row.replied && row.replyHours !== null && row.replyHours <= 24).length;
      return {
        key,
        label: labelOf(key),
        total,
        pending,
        replied,
        archived,
        draftReady,
        autoSendable,
        taskConverted,
        avgReplyHours: average(replyHours),
        replyRate: total ? replied / total : null,
        slaRate: replied ? repliedWithin24 / replied : null,
        taskRate: total ? taskConverted / total : null,
        healthScore: omniboxRowHealthScore({ total, pending, replied, taskConverted, avgReplyHours: average(replyHours) }),
      };
    })
    .sort((a, b) => b.total - a.total || b.healthScore - a.healthScore || b.pending - a.pending)
    .slice(0, 10);
}

function omniboxEffectivenessRecommendation(input: {
  total: number;
  pending: number;
  replied: number;
  highIntentPending: number;
  draftReady: number;
  taskConverted: number;
  tasks: number;
  repliedWithin24: number;
}) {
  if (input.total === 0) return '近样本暂无全渠道消息。先确认 WhatsApp、阿里、邮件等渠道轮询和 webhook 正常。';
  if (input.highIntentPending > 0) return `有 ${input.highIntentPending} 条高意向消息仍未回复。优先处理询价、索样、订单和投诉。`;
  if (input.pending > 0 && input.draftReady > 0) return `有 ${input.draftReady} 条 AI 草稿可确认发送。先清草稿队列,缩短客户等待时间。`;
  if (input.pending > 0) return `仍有 ${input.pending} 条消息待回复。按 SLA 队列逐条处理,必要时批量转销售任务。`;
  if (input.tasks === 0 && input.taskConverted === 0) return '近期消息已处理,但没有转成销售任务。检查高价值询盘是否沉淀到任务和商机。';
  if (input.replied > 0 && input.repliedWithin24 / input.replied < 0.8) return '回复完成率已有基础,但 24 小时内回复比例偏低。建议提高高意向渠道的优先级。';
  return '全渠道会话处理状态稳定。下一步继续把回复效果和商机推进/收入归因合并。';
}

function omniboxRowHealthScore(input: { total: number; pending: number; replied: number; taskConverted: number; avgReplyHours: number | null }) {
  if (input.total === 0) return 50;
  const replyRate = input.replied / input.total;
  const pendingRate = input.pending / input.total;
  const taskRate = input.taskConverted / input.total;
  const replyPenalty = input.avgReplyHours === null ? 0 : Math.max(0, input.avgReplyHours - 24) * 1.5;
  const score = 55 + replyRate * 25 + taskRate * 15 - pendingRate * 20 - replyPenalty;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function inboxIdFromSourceRef(sourceRef: string | null) {
  if (!sourceRef?.startsWith('inbox:')) return null;
  return sourceRef.slice('inbox:'.length);
}

function average(values: number[]) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

const HIGH_INTENTS = new Set(['PRICE_INQUIRY', 'PRODUCT_QUESTION', 'SAMPLE_REQUEST', 'ORDER_STATUS', 'COMPLAINT']);

const CHANNEL_LABEL: Record<string, string> = {
  EMAIL: '邮件',
  WHATSAPP: 'WhatsApp',
  ALIBABA: '阿里国际站',
  AMAZON: '亚马逊',
  SHOPEE: '虾皮',
  FACEBOOK: 'Facebook',
  INSTAGRAM: 'Instagram',
  LINKEDIN: 'LinkedIn',
  SALESMARTLY: 'SaleSmartly',
};

const INTENT_LABEL: Record<string, string> = {
  PRICE_INQUIRY: '询价',
  PRODUCT_QUESTION: '产品咨询',
  ORDER_STATUS: '订单状态',
  SAMPLE_REQUEST: '索样',
  COMPLAINT: '投诉',
  GREETING: '寒暄',
  SPAM: '垃圾',
  OTHER: '其他',
  UNKNOWN: '未识别',
};

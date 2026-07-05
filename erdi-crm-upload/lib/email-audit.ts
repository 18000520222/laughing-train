import { prisma } from '@/lib/prisma';
import { classifyEmail, emailCategoryLabel } from '@/lib/email-classifier';
import { buildGmailLabelReadiness, labelPlanWithLabels } from '@/lib/email-label-plan';

const LOW_CONFIDENCE_SCORE = 50;
const REVIEW_CATEGORIES = ['UNCLASSIFIED', 'OTHER'];
const TASK_CATEGORIES = [
  'INQUIRY',
  'QUOTE_PI',
  'ORDER_PO',
  'PAYMENT_FINANCE',
  'LOGISTICS',
  'TECH_SUPPORT',
  'CUSTOMS_COMPLIANCE',
  'MEETING_FOLLOWUP',
  'SUPPLIER_PURCHASE',
  'AUTH_SECURITY',
];
const NOISE_CATEGORIES = ['SEO_SPAM', 'MARKETING_NEWSLETTER', 'PLATFORM_ALERT', 'INTERNAL', 'OTHER'];

export async function buildEmailClassificationAudit({ sampleLimit = 10 }: { sampleLimit?: number } = {}) {
  const [
    total,
    unclassified,
    actionRequired,
    leads,
    lowConfidence,
    staleUnclassified,
    categoryRows,
    recentActionMessages,
    reviewQueue,
    taskQueue,
    noiseQueue,
    accountRows,
    leadDomainRows,
  ] = await Promise.all([
    prisma.emailMessage.count(),
    prisma.emailMessage.count({ where: { category: 'UNCLASSIFIED' } }),
    prisma.emailMessage.count({ where: { actionRequired: true } }),
    prisma.emailMessage.count({ where: { isLead: true } }),
    prisma.emailMessage.count({ where: { classificationScore: { lt: LOW_CONFIDENCE_SCORE } } }),
    prisma.emailMessage.count({ where: { category: 'UNCLASSIFIED', date: { lt: daysAgo(2) } } }),
    prisma.emailMessage.groupBy({
      by: ['category'],
      _count: { _all: true },
      orderBy: { _count: { category: 'desc' } },
      take: 14,
    }),
    prisma.emailMessage.findMany({
      where: { actionRequired: true },
      orderBy: { date: 'desc' },
      take: sampleLimit,
      select: emailSampleSelect,
    }),
    prisma.emailMessage.findMany({
      where: {
        OR: [
          { category: { in: REVIEW_CATEGORIES } },
          { classificationScore: { lt: LOW_CONFIDENCE_SCORE } },
          { classifiedAt: null },
        ],
      },
      orderBy: [{ classificationScore: 'asc' }, { date: 'desc' }],
      take: sampleLimit,
      select: emailSampleSelect,
    }),
    prisma.emailMessage.findMany({
      where: { actionRequired: true, category: { in: TASK_CATEGORIES } },
      orderBy: [{ isLead: 'desc' }, { classificationScore: 'desc' }, { date: 'desc' }],
      take: 20,
      select: emailSampleSelect,
    }),
    prisma.emailMessage.findMany({
      where: { actionRequired: true, category: { in: NOISE_CATEGORIES } },
      orderBy: [{ classificationScore: 'asc' }, { date: 'desc' }],
      take: 20,
      select: emailSampleSelect,
    }),
    prisma.emailAccount.findMany({
      orderBy: { email: 'asc' },
      select: {
        id: true,
        email: true,
        isActive: true,
        updatedAt: true,
        _count: { select: { messages: true } },
      },
    }),
    prisma.emailMessage.findMany({
      where: { isLead: true },
      orderBy: { date: 'desc' },
      take: 300,
      select: { from: true },
    }),
  ]);

  const categories = categoryRows.map((row) => ({
    category: row.category,
    label: emailCategoryLabel(row.category),
    count: row._count._all,
    share: total > 0 ? row._count._all / total : 0,
  }));
  const leadDomains = topDomains(leadDomainRows.map((row) => row.from));
  const activeAccountCount = accountRows.filter((account) => account.isActive).length;

  return {
    total,
    unclassified,
    actionRequired,
    leads,
    lowConfidence,
    staleUnclassified,
    classified: Math.max(0, total - unclassified),
    classificationCoverage: total > 0 ? (total - unclassified) / total : null,
    actionRate: total > 0 ? actionRequired / total : null,
    leadRate: total > 0 ? leads / total : null,
    categories,
    maxCategoryCount: Math.max(1, ...categories.map((row) => row.count)),
    recentActionMessages: recentActionMessages.map(normalizeEmailSample),
    reviewQueue: reviewQueue.map(normalizeEmailSample),
    taskQueue: taskQueue.map(normalizeEmailSample),
    noiseQueue: noiseQueue.map(normalizeEmailSample),
    accounts: accountRows.map((account) => ({
      id: account.id,
      email: account.email,
      isActive: account.isActive,
      messageCount: account._count.messages,
      updatedAtLabel: account.updatedAt.toLocaleDateString('zh-CN'),
    })),
    leadDomains,
    gmailReadiness: buildGmailLabelReadiness({ activeAccountCount, totalMessages: total }),
    gmailLabelPlan: labelPlanWithLabels(),
    recommendation: emailAuditRecommendation({ total, unclassified, lowConfidence, actionRequired, staleUnclassified }),
  };
}

export async function buildEmailActionClosureAudit({
  since,
  until = new Date(),
  sampleLimit = 8,
}: {
  since: Date;
  until?: Date;
  sampleLimit?: number;
}) {
  const [tasks, convertedEmailCount, clearedNoiseCount] = await Promise.all([
    prisma.salesTask.findMany({
      where: {
        source: 'EMAIL_ACTION_BULK',
        createdAt: { gte: since, lt: until },
      },
      include: {
        owner: true,
        company: {
          include: {
            opportunities: {
              where: { stageChangedAt: { gte: since, lt: until } },
              select: { id: true, stage: true, amountUSD: true, stageChangedAt: true, updatedAt: true },
            },
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { dueAt: 'asc' }],
      take: 500,
    }),
    prisma.emailMessage.count({
      where: {
        classificationTags: { has: '已转任务' },
        classifiedAt: { gte: since, lt: until },
      },
    }),
    prisma.emailMessage.count({
      where: {
        classificationTags: { has: '已清理' },
        classifiedAt: { gte: since, lt: until },
      },
    }),
  ]);

  if (tasks.length === 0) {
    return emptyEmailActionClosureAudit({ convertedEmailCount, clearedNoiseCount });
  }

  const emailIds = Array.from(new Set(tasks.map((task) => emailIdFromSourceRef(task.sourceRef)).filter(Boolean) as string[]));
  const emails = emailIds.length
    ? await prisma.emailMessage.findMany({
        where: { id: { in: emailIds } },
        select: {
          id: true,
          from: true,
          subject: true,
          category: true,
          classificationScore: true,
          classificationTags: true,
          date: true,
          account: { select: { email: true } },
        },
      })
    : [];
  const emailsById = new Map(emails.map((email) => [email.id, email]));
  const now = new Date();
  const companyIds = new Set<string>();
  const ownerIds = new Set<string>();
  const byCategory = new Map<string, EmailActionCategoryRow>();
  const topTasks: EmailActionTaskRow[] = [];
  let doneTasks = 0;
  let openTasks = 0;
  let overdueTasks = 0;
  let downstreamOutcomes = 0;
  let wonDeals = 0;
  let wonRevenue = 0;

  for (const task of tasks) {
    companyIds.add(task.companyId);
    ownerIds.add(task.ownerId);
    const email = emailsById.get(emailIdFromSourceRef(task.sourceRef) || '');
    const category = email?.category || 'UNKNOWN';
    const row = byCategory.get(category) || {
      category,
      categoryLabel: category === 'UNKNOWN' ? '未知邮件' : emailCategoryLabel(category),
      totalTasks: 0,
      doneTasks: 0,
      openTasks: 0,
      overdueTasks: 0,
      downstreamOutcomes: 0,
      wonDeals: 0,
      wonRevenue: 0,
    };
    const opportunityRows = task.company.opportunities.filter((opp) => {
      const stageAt = opp.stageChangedAt || opp.updatedAt;
      return stageAt >= task.createdAt && stageAt <= until;
    });
    const taskOutcomes = opportunityRows.length;
    const taskWonDeals = opportunityRows.filter((opp) => opp.stage === 'CLOSED_WON').length;
    const taskWonRevenue = opportunityRows.filter((opp) => opp.stage === 'CLOSED_WON').reduce((sum, opp) => sum + (opp.amountUSD || 0), 0);
    const isDone = task.status === 'DONE';
    const isOpen = task.status === 'TODO';
    const isOverdue = isOpen && !!task.dueAt && task.dueAt < now;

    row.totalTasks += 1;
    row.doneTasks += isDone ? 1 : 0;
    row.openTasks += isOpen ? 1 : 0;
    row.overdueTasks += isOverdue ? 1 : 0;
    row.downstreamOutcomes += taskOutcomes;
    row.wonDeals += taskWonDeals;
    row.wonRevenue += taskWonRevenue;
    byCategory.set(category, row);

    doneTasks += isDone ? 1 : 0;
    openTasks += isOpen ? 1 : 0;
    overdueTasks += isOverdue ? 1 : 0;
    downstreamOutcomes += taskOutcomes;
    wonDeals += taskWonDeals;
    wonRevenue += taskWonRevenue;

    topTasks.push({
      id: task.id,
      companyId: task.companyId,
      companyName: task.company.name,
      ownerName: task.owner.name || task.owner.email,
      title: task.title,
      status: task.status,
      statusLabel: task.status === 'DONE' ? '已完成' : task.status === 'TODO' ? (isOverdue ? '已逾期' : '待处理') : '已取消',
      isOverdue,
      categoryLabel: row.categoryLabel,
      emailSubject: email?.subject || '无主题',
      emailFrom: email ? trimSender(email.from) : '邮件记录未找到',
      score: email?.classificationScore || 0,
      createdAtLabel: task.createdAt.toLocaleDateString('zh-CN'),
      downstreamOutcomes: taskOutcomes,
      wonRevenue: taskWonRevenue,
    });
  }

  const byCategoryRows = Array.from(byCategory.values()).sort((a, b) => b.wonRevenue - a.wonRevenue || b.downstreamOutcomes - a.downstreamOutcomes || b.totalTasks - a.totalTasks);
  const sortedTopTasks = topTasks
    .sort((a, b) => b.wonRevenue - a.wonRevenue || b.downstreamOutcomes - a.downstreamOutcomes || Number(b.isOverdue) - Number(a.isOverdue) || b.score - a.score)
    .slice(0, sampleLimit);
  const totalTasks = tasks.length;

  return {
    totalTasks,
    convertedEmailCount,
    clearedNoiseCount,
    doneTasks,
    openTasks,
    overdueTasks,
    companyCount: companyIds.size,
    ownerCount: ownerIds.size,
    downstreamOutcomes,
    wonDeals,
    wonRevenue,
    completionRate: totalTasks > 0 ? doneTasks / totalTasks : null,
    downstreamRate: totalTasks > 0 ? downstreamOutcomes / totalTasks : null,
    byCategory: byCategoryRows,
    topTasks: sortedTopTasks,
    maxCategoryTasks: Math.max(1, ...byCategoryRows.map((row) => row.totalTasks)),
    recommendation: emailActionClosureRecommendation({ totalTasks, doneTasks, openTasks, overdueTasks, downstreamOutcomes, wonRevenue, clearedNoiseCount }),
  };
}

export async function reclassifyEmailMessages({
  limit = 500,
  includeClassified = false,
  dryRun = false,
  order = 'desc',
  updateLimit,
}: {
  limit?: number;
  includeClassified?: boolean;
  dryRun?: boolean;
  order?: 'asc' | 'desc';
  updateLimit?: number;
} = {}) {
  const safeLimit = Math.min(Math.max(limit, 1), 2000);
  const safeUpdateLimit = Math.min(Math.max(updateLimit ?? safeLimit, 1), safeLimit);
  const messages = await prisma.emailMessage.findMany({
    where: includeClassified ? {} : { category: 'UNCLASSIFIED' },
    orderBy: { date: order },
    take: safeLimit,
    select: {
      id: true,
      from: true,
      subject: true,
      textBody: true,
      htmlBody: true,
      category: true,
      categoryReason: true,
      classificationScore: true,
      actionRequired: true,
      isLead: true,
      classificationTags: true,
      date: true,
      account: { select: { email: true } },
    },
  });

  const counts: Record<string, number> = {};
  const migrations: Record<string, number> = {};
  const changedSamples = [];
  let changed = 0;
  let updated = 0;
  let actionRequired = 0;
  let leads = 0;

  for (const msg of messages) {
    const classification = preserveEmailActionState(msg, classifyEmail(msg));
    counts[classification.category] = (counts[classification.category] || 0) + 1;
    if (classification.actionRequired) actionRequired++;
    if (classification.isLead) leads++;
    const changedFields = changedEmailFields(msg, classification);
    if (changedFields.length > 0) {
      changed++;
      const key = `${msg.category}->${classification.category}`;
      migrations[key] = (migrations[key] || 0) + 1;
      if (changedSamples.length < 12) {
        changedSamples.push({
          id: msg.id,
          from: trimSender(msg.from),
          subject: msg.subject || '无主题',
          dateLabel: msg.date.toLocaleDateString('zh-CN'),
          accountEmail: msg.account.email,
          oldCategory: msg.category,
          oldCategoryLabel: emailCategoryLabel(msg.category),
          newCategory: classification.category,
          newCategoryLabel: emailCategoryLabel(classification.category),
          oldScore: msg.classificationScore,
          newScore: classification.classificationScore,
          oldActionRequired: msg.actionRequired,
          newActionRequired: classification.actionRequired,
          oldIsLead: msg.isLead,
          newIsLead: classification.isLead,
          reason: classification.categoryReason,
          changedFields,
        });
      }
    }

    if (!dryRun && changedFields.length > 0 && updated < safeUpdateLimit) {
      await prisma.emailMessage.update({
        where: { id: msg.id },
        data: {
          isLead: classification.isLead,
          category: classification.category,
          categoryReason: classification.categoryReason,
          classificationScore: classification.classificationScore,
          actionRequired: classification.actionRequired,
          classifiedAt: new Date(),
          classificationTags: classification.classificationTags,
        },
      });
      updated++;
    }
  }

  return {
    dryRun,
    scanned: messages.length,
    changed,
    updated,
    actionRequired,
    leads,
    counts,
    migrations,
    changedSamples,
  };
}

function preserveEmailActionState(
  msg: {
    classificationTags: string[];
  },
  classification: ReturnType<typeof classifyEmail>
) {
  const processedTags = (msg.classificationTags || []).filter((tag) => tag === '已转任务' || tag === '已清理' || tag === '安全已归档');
  if (processedTags.length === 0) return classification;
  return {
    ...classification,
    actionRequired: false,
    classificationTags: mergeTags(classification.classificationTags, processedTags),
  };
}

function changedEmailFields(
  msg: {
    category: string;
    categoryReason: string | null;
    classificationScore: number;
    actionRequired: boolean;
    isLead: boolean;
    classificationTags: string[];
  },
  classification: ReturnType<typeof classifyEmail>
) {
  const fields = [];
  if (msg.category !== classification.category) fields.push('category');
  if ((msg.categoryReason || '') !== classification.categoryReason) fields.push('reason');
  if (msg.classificationScore !== classification.classificationScore) fields.push('score');
  if (msg.actionRequired !== classification.actionRequired) fields.push('actionRequired');
  if (msg.isLead !== classification.isLead) fields.push('isLead');
  if (JSON.stringify(msg.classificationTags || []) !== JSON.stringify(classification.classificationTags)) fields.push('tags');
  return fields;
}

function mergeTags(current: string[], extra: string[]) {
  return Array.from(new Set([...(current || []), ...extra]));
}

const emailSampleSelect = {
  id: true,
  from: true,
  subject: true,
  date: true,
  category: true,
  categoryReason: true,
  classificationScore: true,
  actionRequired: true,
  isLead: true,
  classificationTags: true,
  account: { select: { email: true } },
} as const;

function normalizeEmailSample(msg: {
  id: string;
  from: string;
  subject: string | null;
  date: Date;
  category: string;
  categoryReason: string | null;
  classificationScore: number;
  actionRequired: boolean;
  isLead: boolean;
  classificationTags: string[];
  account: { email: string };
}) {
  return {
    id: msg.id,
    from: trimSender(msg.from),
    subject: msg.subject || '无主题',
    dateLabel: msg.date.toLocaleDateString('zh-CN'),
    category: msg.category,
    categoryLabel: emailCategoryLabel(msg.category),
    categoryReason: msg.categoryReason || '-',
    classificationScore: msg.classificationScore,
    actionRequired: msg.actionRequired,
    isLead: msg.isLead,
    classificationTags: msg.classificationTags,
    accountEmail: msg.account.email,
  };
}

function emailAuditRecommendation(input: { total: number; unclassified: number; lowConfidence: number; actionRequired: number; staleUnclassified: number }) {
  if (input.total === 0) return 'CRM 邮件表暂无数据。先恢复 Gmail/IMAP 同步,再做分类审计和销售线索分流。';
  if (input.unclassified > 0) return `还有 ${input.unclassified} 封未分类邮件,建议先重跑最近 500 封分类,再处理低置信队列。`;
  if (input.lowConfidence > 0) return `有 ${input.lowConfidence} 封低置信邮件需要人工复核关键词,优先检查 OTHER/营销噪音/平台通知边界。`;
  if (input.staleUnclassified > 0) return `有 ${input.staleUnclassified} 封超过 2 天未分类的旧邮件,需要检查同步任务或分类 cron。`;
  if (input.actionRequired > 0) return `当前有 ${input.actionRequired} 封需要动作的邮件,应优先转客户、建商机或生成跟进任务。`;
  return '邮件分类覆盖良好。下一步重点是把询盘/报价/订单类邮件自动关联客户和商机。';
}

type EmailActionCategoryRow = {
  category: string;
  categoryLabel: string;
  totalTasks: number;
  doneTasks: number;
  openTasks: number;
  overdueTasks: number;
  downstreamOutcomes: number;
  wonDeals: number;
  wonRevenue: number;
};

type EmailActionTaskRow = {
  id: string;
  companyId: string;
  companyName: string;
  ownerName: string;
  title: string;
  status: string;
  statusLabel: string;
  isOverdue: boolean;
  categoryLabel: string;
  emailSubject: string;
  emailFrom: string;
  score: number;
  createdAtLabel: string;
  downstreamOutcomes: number;
  wonRevenue: number;
};

function emptyEmailActionClosureAudit({
  convertedEmailCount,
  clearedNoiseCount,
}: {
  convertedEmailCount: number;
  clearedNoiseCount: number;
}) {
  return {
    totalTasks: 0,
    convertedEmailCount,
    clearedNoiseCount,
    doneTasks: 0,
    openTasks: 0,
    overdueTasks: 0,
    companyCount: 0,
    ownerCount: 0,
    downstreamOutcomes: 0,
    wonDeals: 0,
    wonRevenue: 0,
    completionRate: null,
    downstreamRate: null,
    byCategory: [] as EmailActionCategoryRow[],
    topTasks: [] as EmailActionTaskRow[],
    maxCategoryTasks: 1,
    recommendation: convertedEmailCount > 0 || clearedNoiseCount > 0
      ? `近 30 天已有 ${convertedEmailCount} 封邮件标记为已转任务、${clearedNoiseCount} 封噪音已清理,但暂未找到对应的邮件动作任务。`
      : '近 30 天暂无邮件动作任务。先在邮件动作清理台把询盘/报价/订单等邮件转成销售任务。',
  };
}

function emailActionClosureRecommendation(input: {
  totalTasks: number;
  doneTasks: number;
  openTasks: number;
  overdueTasks: number;
  downstreamOutcomes: number;
  wonRevenue: number;
  clearedNoiseCount: number;
}) {
  if (input.totalTasks === 0) return '近 30 天暂无邮件动作任务。先把高价值邮件转销售任务,再观察客户和商机结果。';
  if (input.overdueTasks > 0) return `有 ${input.overdueTasks} 个邮件动作任务已逾期。先处理逾期询盘/报价/订单邮件,避免客户等待。`;
  if (input.doneTasks === 0) return `已生成 ${input.totalTasks} 个邮件动作任务,但还没有完成记录。要求销售完成任务并写明处理结果。`;
  if (input.downstreamOutcomes > 0 && input.wonRevenue > 0) return `邮件动作任务已带来 ${input.downstreamOutcomes} 次商机推进和 $${Math.round(input.wonRevenue).toLocaleString()} 赢单收入,应复盘有效邮件类型。`;
  if (input.downstreamOutcomes > 0) return `邮件动作任务已带来 ${input.downstreamOutcomes} 次商机推进,但暂未形成赢单收入。继续盯报价、谈判和规格确认。`;
  if (input.clearedNoiseCount > input.totalTasks) return `噪音清理量高于邮件转任务量。检查是否漏掉询盘/报价关键词,防止高价值邮件被当作低价值处理。`;
  return `邮件动作任务完成率 ${formatPercent(input.totalTasks ? input.doneTasks / input.totalTasks : null)},但暂未看到后续商机推进。需要检查任务是否具体到报价、样品或技术确认。`;
}

function emailIdFromSourceRef(sourceRef: string | null) {
  if (!sourceRef?.startsWith('email:')) return null;
  return sourceRef.slice('email:'.length);
}

function formatPercent(value: number | null) {
  if (value === null) return '-';
  return `${Math.round(value * 100)}%`;
}

function topDomains(fromRows: string[]) {
  const domains = new Map<string, number>();
  for (const from of fromRows) {
    const domain = extractDomain(from);
    if (!domain) continue;
    domains.set(domain, (domains.get(domain) || 0) + 1);
  }
  return Array.from(domains.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([domain, count]) => ({ domain, count }));
}

function trimSender(from: string) {
  return from.replace(/\s+/g, ' ').trim().slice(0, 90);
}

function extractDomain(from: string) {
  const match = from.toLowerCase().match(/[a-z0-9._%+-]+@([a-z0-9.-]+\.[a-z]{2,})/i);
  return match?.[1] || null;
}

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

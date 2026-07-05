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
  const processedTags = (msg.classificationTags || []).filter((tag) => tag === '已转任务' || tag === '已清理');
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

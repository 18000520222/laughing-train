import { prisma } from '@/lib/prisma';
import { classifyEmail } from '@/lib/email-classifier';

const NON_SALES_CATEGORIES = new Set([
  'PLATFORM_ALERT',
  'MARKETING_NEWSLETTER',
  'SEO_SPAM',
  'INTERNAL',
]);

const SYSTEM_SERVICE_DOMAINS = [
  'vercel.com',
  'github.com',
  'supabase.com',
  'cloudflare.com',
  'slack.com',
  'dhl.com',
  'fedex.com',
  'ups.com',
];

export async function auditAndRepairEmailLeadHygiene(options: { apply: boolean; limit?: number }) {
  const limit = Math.max(1, Math.min(options.limit || 5000, 10000));
  const opportunities = await prisma.opportunity.findMany({
    where: {
      opportunityCode: { startsWith: 'EMAIL-' },
      stage: { in: ['UNPROCESSED', 'REPLIED'] },
      description: { contains: '来源邮件:' },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      company: {
        include: {
          contacts: { select: { email: true } },
          opportunities: { select: { id: true, stage: true } },
          payments: { select: { id: true }, take: 1 },
        },
      },
      lineItems: { select: { id: true }, take: 1 },
      payments: { select: { id: true }, take: 1 },
      tradeDocuments: { select: { id: true }, take: 1 },
      purchaseOrders: { select: { id: true }, take: 1 },
      shipments: { select: { id: true }, take: 1 },
      salesTasks: { select: { id: true }, take: 1 },
    },
  });

  const sourceIds = opportunities.map((row) => sourceEmailId(row.description)).filter((id): id is string => Boolean(id));
  const emails = sourceIds.length
    ? await prisma.emailMessage.findMany({ where: { id: { in: sourceIds } } })
    : [];
  const emailById = new Map(emails.map((email) => [email.id, email]));

  const candidates = opportunities.flatMap((opportunity) => {
    const emailId = sourceEmailId(opportunity.description);
    const email = emailId ? emailById.get(emailId) : null;
    if (!email || email.direction !== 'IN' || hasDownstreamEvidence(opportunity)) return [];
    const classification = classifyEmail(email);
    if (classification.isLead || !NON_SALES_CATEGORIES.has(classification.category)) return [];
    return [{ opportunity, email, classification }];
  });

  const samples = candidates.slice(0, 20).map(({ opportunity, classification }) => ({
    opportunityId: opportunity.id,
    title: opportunity.title,
    company: opportunity.company.name,
    oldStage: opportunity.stage,
    newCategory: classification.category,
    reason: classification.categoryReason,
  }));

  if (!options.apply) {
    return {
      dryRun: true,
      scanned: opportunities.length,
      candidates: candidates.length,
      opportunitiesClosed: 0,
      inboxArchived: 0,
      companiesMarkedLost: 0,
      samples,
    };
  }

  let opportunitiesClosed = 0;
  let inboxArchived = 0;
  let companiesMarkedLost = 0;
  for (const { opportunity, email, classification } of candidates) {
    const shouldMarkCompanyLost = opportunity.company.source === 'EMAIL'
      && opportunity.company.payments.length === 0
      && opportunity.company.opportunities.every((item) => item.id === opportunity.id || item.stage === 'CLOSED_LOST')
      && opportunity.company.contacts.length > 0
      && opportunity.company.contacts.every((contact) => isAutomatedServiceAddress(contact.email));

    await prisma.$transaction(async (tx) => {
      await tx.emailMessage.update({
        where: { id: email.id },
        data: {
          category: classification.category,
          categoryReason: classification.categoryReason,
          classificationScore: classification.classificationScore,
          actionRequired: false,
          isLead: false,
          classificationTags: Array.from(new Set([...classification.classificationTags, '历史误判已修复'])),
          classifiedAt: new Date(),
          processingState: 'IGNORED',
        },
      });
      const archived = await tx.inboxMessage.updateMany({
        where: { channel: 'EMAIL', externalId: email.messageId, status: { in: ['NEW', 'AI_DRAFTED'] } },
        data: { status: 'ARCHIVED' },
      });
      inboxArchived += archived.count;
      await tx.opportunity.update({
        where: { id: opportunity.id },
        data: {
          stage: 'CLOSED_LOST',
          stageChangedAt: new Date(),
          lostReason: 'SYSTEM_EMAIL_NOISE',
          lostDetail: `历史邮件误判已修复；保留原邮件供审计。新分类: ${classification.category}；依据: ${classification.categoryReason}`,
          nextStep: '无需销售跟进',
        },
      });
      await tx.opportunityStageHistory.create({
        data: {
          opportunityId: opportunity.id,
          fromStage: opportunity.stage,
          toStage: 'CLOSED_LOST',
          note: `邮件线索卫生修复: ${classification.categoryReason}`,
        },
      });
      if (shouldMarkCompanyLost) {
        await tx.company.update({
          where: { id: opportunity.company.id },
          data: { type: 'LOST', nextAction: '系统/服务商通知，不计入客户池' },
        });
        companiesMarkedLost++;
      }
    });
    opportunitiesClosed++;
  }

  return {
    dryRun: false,
    scanned: opportunities.length,
    candidates: candidates.length,
    opportunitiesClosed,
    inboxArchived,
    companiesMarkedLost,
    samples,
  };
}

function sourceEmailId(description: string | null) {
  return description?.match(/来源邮件:\s*([^\s]+)/)?.[1] || null;
}

function hasDownstreamEvidence(opportunity: {
  lineItems: Array<{ id: string }>;
  payments: Array<{ id: string }>;
  tradeDocuments: Array<{ id: string }>;
  purchaseOrders: Array<{ id: string }>;
  shipments: Array<{ id: string }>;
  salesTasks: Array<{ id: string }>;
}) {
  return Boolean(
    opportunity.lineItems.length
      || opportunity.payments.length
      || opportunity.tradeDocuments.length
      || opportunity.purchaseOrders.length
      || opportunity.shipments.length
      || opportunity.salesTasks.length
  );
}

function isAutomatedServiceAddress(value: string | null) {
  const email = String(value || '').toLowerCase();
  const domain = email.split('@')[1] || '';
  return /^(?:no-?reply|notifications?|mailer-daemon)@/i.test(email)
    || SYSTEM_SERVICE_DOMAINS.some((item) => domain === item || domain.endsWith(`.${item}`));
}

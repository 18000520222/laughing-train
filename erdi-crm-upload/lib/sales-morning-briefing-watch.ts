import { prisma } from '@/lib/prisma';
import { buildAutomationFunnelInsights } from '@/lib/automation-insights';
import { buildChannelMessageRevenueReport } from '@/lib/channel-revenue-insights';
import { buildCustomerHealthRow } from '@/lib/customer-health';
import { buildEmailActionClosureAudit } from '@/lib/email-audit';
import { buildCompletionEvidenceEscalationReport } from '@/lib/sales-completion-evidence-escalation';
import { buildSalesMorningBriefing, buildSalesOwnerPriorityReport, buildSalesPriorityQueue } from '@/lib/sales-priority-queue';

const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN'];

type BriefingTarget = {
  userId: string;
  line: string;
  link: string;
};

export async function buildSalesMorningBriefingFromDatabase(options: { now?: Date } = {}) {
  const now = options.now || new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [salesTasks, staleOpportunities, healthCompanies, flows, channelMessages, channelTasks, channelOpportunities, emailActionClosure, completionRepairTasks] = await Promise.all([
    prisma.salesTask.findMany({
      where: { status: 'TODO' },
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
      take: 40,
      include: { owner: true, company: true, opportunity: true },
    }),
    prisma.opportunity.findMany({
      where: { stage: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] as any }, stageChangedAt: { lt: sevenDaysAgo } },
      orderBy: [{ stageChangedAt: 'asc' }, { amountUSD: 'desc' }],
      take: 30,
      include: { company: true, owner: true },
    }),
    prisma.company.findMany({
      where: { type: { in: ['INQUIRY', 'QUOTED', 'CONTRACT_SENT', 'DEAL_WON', 'KEY_ACCOUNT', 'PROSPECT', 'NEW', 'EXISTING'] as any } },
      orderBy: [{ updatedAt: 'asc' }, { priorityScore: 'desc' }],
      take: 80,
      include: {
        owner: true,
        contacts: { take: 3, orderBy: { createdAt: 'asc' } },
        inboxMessages: { orderBy: { createdAt: 'desc' }, take: 6 },
        followUps: { orderBy: { createdAt: 'desc' }, take: 3 },
        opportunities: { orderBy: { updatedAt: 'desc' }, take: 6 },
        salesTasks: { where: { status: 'TODO' }, orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }], take: 3 },
      },
    }),
    prisma.automationFlow.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 200,
      include: { runs: { orderBy: { createdAt: 'desc' }, take: 20 } },
    }),
    prisma.inboxMessage.findMany({
      where: { direction: 'IN', companyId: { not: null }, createdAt: { gte: thirtyDaysAgo, lt: now } },
      include: { company: { select: { id: true, name: true, owner: { select: { name: true, email: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    }),
    prisma.salesTask.findMany({
      where: {
        createdAt: { gte: thirtyDaysAgo, lt: now },
        OR: [
          { sourceRef: { startsWith: 'inbox:' } },
          { source: { in: ['OMNIBOX_BULK', 'AUTOMATION_NO_REPLY_TIMEOUT', 'EMAIL_ACTION_BULK'] } },
        ],
      },
      select: { id: true, source: true, sourceRef: true, companyId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    }),
    prisma.opportunity.findMany({
      where: {
        stageChangedAt: { gte: thirtyDaysAgo, lt: now },
        stage: { in: ['REPLIED', 'QUOTING', 'NEGOTIATING', 'SPEC_CONFIRMING', 'CLOSED_WON'] as any },
      },
      select: { id: true, title: true, companyId: true, stage: true, amountUSD: true, stageChangedAt: true, updatedAt: true, owner: { select: { name: true, email: true } } },
      orderBy: [{ stageChangedAt: 'desc' }, { amountUSD: 'desc' }],
      take: 800,
    }),
    buildEmailActionClosureAudit({ since: thirtyDaysAgo, until: now, sampleLimit: 8 }),
    prisma.salesTask.findMany({
      where: {
        source: 'COMPLETION_EVIDENCE_AUDIT',
        OR: [
          { createdAt: { gte: thirtyDaysAgo } },
          { escalatedAt: { gte: thirtyDaysAgo } },
          { status: 'TODO' },
        ],
      },
      orderBy: [{ escalatedAt: 'desc' }, { dueAt: 'asc' }, { createdAt: 'desc' }],
      take: 80,
      include: { owner: true, company: true },
    }),
  ]);

  const channelRevenue = buildChannelMessageRevenueReport({
    messages: channelMessages,
    tasks: channelTasks,
    opportunities: channelOpportunities,
    until: now,
  });
  const customerHealthRows = healthCompanies
    .map((company) => ({ company, health: buildCustomerHealthRow(company) }))
    .filter(({ health }) => health.shortfalls.length > 0 || health.score < 75)
    .sort((a, b) => b.health.priorityWeight - a.health.priorityWeight || a.health.score - b.health.score)
    .slice(0, 8);
  const automationFunnel = buildAutomationFunnelInsights(flows);
  const completionEscalation = buildCompletionEvidenceEscalationReport({
    tasks: completionRepairTasks,
    now,
  });
  const staleOpportunityRows = staleOpportunities.map((opportunity) => {
    const stageDate = opportunity.stageChangedAt || opportunity.updatedAt;
    const ageDays = Math.max(0, Math.floor((now.getTime() - new Date(stageDate).getTime()) / 86400000));
    return { opportunity, ageDays };
  });

  const queue = buildSalesPriorityQueue({
    channelSamples: channelRevenue.samples,
    salesTasks,
    staleOpportunities: staleOpportunityRows,
    customerHealthRows,
    automationRisks: automationFunnel.riskFlows,
    emailTasks: emailActionClosure.topTasks,
    healthTasks: [],
    completionEvidenceEscalations: completionEscalation.rows.filter((row) => row.statusLabel === '已升级' || row.statusLabel === '已逾期'),
    now,
  });
  const ownerReport = buildSalesOwnerPriorityReport(queue.items);
  const briefing = buildSalesMorningBriefing(queue.items, ownerReport.rows);

  return { queue, ownerReport, briefing };
}

export async function sendMorningBriefingNotifications(options: { itemIds: string[]; now?: Date; limit?: number }) {
  const now = options.now || new Date();
  const todayStart = startOfUtcDay(now);
  const itemIds = uniqueItemIds(options.itemIds).slice(0, Math.min(Math.max(options.limit || 20, 1), 50));
  const admins = await prisma.user.findMany({
    where: { role: { in: ADMIN_ROLES as any }, isActive: true },
    select: { id: true },
  });
  const adminIds = admins.map((admin) => admin.id);
  const targets: BriefingTarget[] = [];
  const result = {
    requested: itemIds.length,
    notified: 0,
    skipped: 0,
    skippedDuplicates: 0,
    groupedTargets: 0,
  };

  for (const itemId of itemIds) {
    const [kind, targetId] = splitItemId(itemId);
    if (!kind || !targetId) {
      result.skipped++;
      continue;
    }
    const resolved = await resolveBriefingTarget(kind, targetId, adminIds);
    if (resolved.length === 0) result.skipped++;
    targets.push(...resolved);
  }

  const grouped = groupTargets(targets);
  result.groupedTargets = grouped.length;
  for (const group of grouped) {
    const created = await createDailyNotification({
      userId: group.userId,
      title: '老板晨会摘要: 今日必须处理',
      body: group.lines.slice(0, 6).join('\n'),
      link: group.link,
      todayStart,
    });
    if (created) result.notified++;
    else result.skippedDuplicates++;
  }

  return result;
}

export function firstMorningBriefingItemIds(input: { topItemIds: string[]; urgentItemIds: string[]; mode?: string }) {
  return input.mode === 'urgent' && input.urgentItemIds.length > 0 ? input.urgentItemIds : input.topItemIds;
}

async function resolveBriefingTarget(kind: string, targetId: string, adminIds: string[]): Promise<BriefingTarget[]> {
  if (kind === 'MESSAGE_SLA') return messageTargets(targetId, adminIds);
  if (kind === 'OPPORTUNITY_STALL') return opportunityTargets(targetId, adminIds);
  if (kind === 'CUSTOMER_HEALTH') return companyTargets(targetId, adminIds);
  if (kind === 'SALES_TASK' || kind === 'EMAIL_ACTION' || kind === 'HEALTH_TASK') return taskTargets(targetId);
  if (kind === 'COMPLETION_EVIDENCE_ESCALATION') return completionEvidenceEscalationTargets(targetId, adminIds);
  if (kind === 'AUTOMATION_RISK') return automationTargets(targetId, adminIds);
  return [];
}

async function messageTargets(messageId: string, adminIds: string[]) {
  const message = await prisma.inboxMessage.findUnique({
    where: { id: messageId },
    include: { company: { select: { id: true, name: true, ownerId: true } } },
  });
  if (!message?.company) return [];
  const userIds = message.company.ownerId ? [message.company.ownerId] : adminIds;
  return userIds.map((userId) => ({
    userId,
    line: `客户消息: ${message.company!.name} / ${message.senderName || message.senderId} / ${intentLabel(message.intent)}`,
    link: `/customers/${message.company!.id}`,
  }));
}

async function opportunityTargets(opportunityId: string, adminIds: string[]) {
  const opportunity = await prisma.opportunity.findUnique({
    where: { id: opportunityId },
    include: { company: { select: { id: true, name: true, ownerId: true } } },
  });
  if (!opportunity) return [];
  const userIds = opportunity.ownerId || opportunity.company.ownerId ? [opportunity.ownerId || opportunity.company.ownerId].filter(Boolean) as string[] : adminIds;
  return userIds.map((userId) => ({
    userId,
    line: `停滞商机: ${opportunity.title} / ${opportunity.company.name} / $${Math.round(opportunity.amountUSD || 0).toLocaleString()}`,
    link: `/opportunity/${opportunity.id}`,
  }));
}

async function companyTargets(companyId: string, adminIds: string[]) {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true, ownerId: true, priorityScore: true } });
  if (!company) return [];
  const userIds = company.ownerId ? [company.ownerId] : adminIds;
  return userIds.map((userId) => ({
    userId,
    line: `客户健康: ${company.name} / 优先级 ${company.priorityScore}`,
    link: `/customers/${company.id}`,
  }));
}

async function taskTargets(taskId: string) {
  const task = await prisma.salesTask.findUnique({
    where: { id: taskId },
    include: { company: { select: { name: true } } },
  });
  if (!task) return [];
  return [{
    userId: task.ownerId,
    line: `销售任务: ${task.company.name} / ${task.title}`,
    link: '/tasks?view=week',
  }];
}

async function completionEvidenceEscalationTargets(taskId: string, adminIds: string[]) {
  const task = await prisma.salesTask.findUnique({
    where: { id: taskId },
    include: { company: { select: { id: true, name: true } }, owner: { select: { name: true, email: true } } },
  });
  if (!task) return [];
  const userIds = Array.from(new Set([task.ownerId, ...adminIds].filter(Boolean)));
  return userIds.map((userId) => ({
    userId,
    line: `补证据升级: ${task.company.name} / ${task.title} / ${task.owner.name || task.owner.email}`,
    link: `/customers/${task.company.id}`,
  }));
}

async function automationTargets(flowId: string, adminIds: string[]) {
  const flow = await prisma.automationFlow.findUnique({ where: { id: flowId } });
  if (!flow) return [];
  return adminIds.map((userId) => ({
    userId,
    line: `自动化风险: ${flow.name} / 请复核条件、动作和失败记录`,
    link: `/automation?flow=${flow.id}`,
  }));
}

function groupTargets(targets: BriefingTarget[]) {
  const groups = new Map<string, { userId: string; lines: string[]; link: string }>();
  for (const target of targets) {
    const group = groups.get(target.userId) || { userId: target.userId, lines: [], link: target.link };
    if (!group.lines.includes(target.line)) group.lines.push(target.line);
    groups.set(target.userId, group);
  }
  return Array.from(groups.values());
}

function createDailyNotification(input: { userId: string; title: string; body: string; link: string; todayStart: Date }) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.notification.findFirst({
      where: {
        userId: input.userId,
        type: 'SYSTEM',
        title: input.title,
        link: input.link,
        createdAt: { gte: input.todayStart },
      },
      select: { id: true },
    });
    if (existing) return false;
    await tx.notification.create({
      data: {
        userId: input.userId,
        type: 'SYSTEM',
        title: input.title,
        body: input.body,
        link: input.link,
      },
    });
    return true;
  });
}

function uniqueItemIds(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function splitItemId(value: string) {
  const index = value.indexOf(':');
  if (index === -1) return ['', ''] as const;
  return [value.slice(0, index), value.slice(index + 1)] as const;
}

function intentLabel(intent: string | null) {
  const labels: Record<string, string> = {
    PRICE_INQUIRY: '询价',
    PRODUCT_QUESTION: '产品问题',
    SAMPLE_REQUEST: '索样',
    ORDER_STATUS: '订单进度',
    COMPLAINT: '投诉/售后',
  };
  return labels[String(intent || '')] || '客户消息';
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

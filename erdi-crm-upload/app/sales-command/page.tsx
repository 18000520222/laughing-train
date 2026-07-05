import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createDefaultSalesAssignmentRules, executeSalesAssignmentRules } from '@/lib/sales-assignment';
import { buildSalesRadar } from '@/lib/sales-radar';
import { buildCustomerHealthRow } from '@/lib/customer-health';
import { runEmailActionAutopilot } from '@/lib/email-actions';
import { buildEmailActionClosureAudit, buildEmailClassificationAudit, reclassifyEmailMessages } from '@/lib/email-audit';
import { buildEmailSecurityAudit, runEmailSecurityWatch } from '@/lib/email-security-audit';
import { buildChannelMessageRevenueReport } from '@/lib/channel-revenue-insights';
import { buildAutomationFunnelInsights } from '@/lib/automation-insights';
import { buildSalesMorningBriefing, buildSalesOwnerPriorityReport, buildSalesPriorityQueue } from '@/lib/sales-priority-queue';
import { buildMorningBriefingClosureReport } from '@/lib/sales-morning-briefing-closure';
import { buildSalesActionClosureReport } from '@/lib/sales-action-closure';
import { buildSalesCompletionEvidenceReport } from '@/lib/sales-completion-evidence';
import { buildCompletionEvidenceEscalationReport } from '@/lib/sales-completion-evidence-escalation';

export const dynamic = 'force-dynamic';

const CUSTOMER_TYPES = [
  ['INQUIRY', '询盘客户'],
  ['QUOTED', '已报价客户'],
  ['CONTRACT_SENT', '已发合同客户'],
  ['DEAL_WON', '已成交客户'],
  ['KEY_ACCOUNT', '老客户/大客户'],
  ['PROSPECT', '潜在客户(旧)'],
  ['NEW', '新客户(旧)'],
  ['EXISTING', '老客户(旧)'],
  ['LOST', '流失客户'],
];

const DISTRIBUTION_LABEL: Record<string, string> = {
  ROUND_ROBIN: '轮流分配',
  LOWEST_LOAD: '优先分给客户少的人',
  FIXED_OWNER: '固定分给第一个业务员',
};

const TYPE_LABEL = Object.fromEntries(CUSTOMER_TYPES);

const STAGE_LABEL: Record<string, string> = {
  UNPROCESSED: '未处理',
  REPLIED: '已回复',
  QUOTING: '报价中',
  NEGOTIATING: '谈判中',
  SPEC_CONFIRMING: '规格确认',
  CLOSED_WON: '已成交',
  CLOSED_LOST: '已流失',
};

const LOST_REASON_LABEL: Record<string, string> = {
  PRICE: '价格不合适',
  SPEC: '规格/性能不匹配',
  DELIVERY: '交期不满足',
  CERTIFICATION: '认证/资质不满足',
  COMPETITOR: '被竞争对手拿走',
  NO_RESPONSE: '客户无回复',
  BUDGET: '预算取消/推迟',
  OTHER: '其他',
  '未填写原因': '未填写原因',
};

function listFromForm(formData: FormData, key: string) {
  return formData.getAll(key).map((v) => String(v).trim()).filter(Boolean);
}

function csvFromForm(formData: FormData, key: string) {
  const raw = String(formData.get(key) || '');
  return raw.split(/[,，\n]/).map((v) => v.trim()).filter(Boolean);
}

async function requireAdminUser() {
  const role = (cookies().get('auth_role')?.value || '').toUpperCase();
  const email = cookies().get('auth_email')?.value || '';
  if (role !== 'SUPER_ADMIN' && role !== 'ADMIN') redirect('/dashboard');
  return prisma.user.findUnique({ where: { email } });
}

async function requireSalesUser() {
  const role = (cookies().get('auth_role')?.value || '').toUpperCase();
  const email = cookies().get('auth_email')?.value || '';
  if (role !== 'SUPER_ADMIN' && role !== 'ADMIN' && role !== 'SALES') redirect('/dashboard');
  return prisma.user.findUnique({ where: { email } });
}

async function createRule(formData: FormData) {
  'use server';
  const user = await requireAdminUser();
  const ownerIds = listFromForm(formData, 'ownerIds');
  const name = String(formData.get('name') || '').trim();
  if (!name || ownerIds.length === 0) return;

  await prisma.salesAssignmentRule.create({
    data: {
      name,
      description: String(formData.get('description') || '').trim() || null,
      priority: parseInt(String(formData.get('priority') || '100'), 10) || 100,
      customerTypes: listFromForm(formData, 'customerTypes') as any,
      countries: csvFromForm(formData, 'countries'),
      sources: csvFromForm(formData, 'sources'),
      minPriorityScore: Math.max(0, Math.min(100, parseInt(String(formData.get('minPriorityScore') || '0'), 10) || 0)),
      ownerIds,
      distribution: String(formData.get('distribution') || 'ROUND_ROBIN') as any,
      createdById: user?.id || null,
    },
  });
  redirect('/sales-command');
}

async function toggleRule(formData: FormData) {
  'use server';
  await requireAdminUser();
  const id = String(formData.get('id') || '');
  const isActive = String(formData.get('isActive') || '') === 'true';
  if (!id) return;
  await prisma.salesAssignmentRule.update({ where: { id }, data: { isActive: !isActive } });
  redirect('/sales-command');
}

async function deleteRule(formData: FormData) {
  'use server';
  await requireAdminUser();
  const id = String(formData.get('id') || '');
  if (!id) return;
  await prisma.salesAssignmentRule.delete({ where: { id } });
  redirect('/sales-command');
}

async function createDefaultRules() {
  'use server';
  const user = await requireAdminUser();
  await createDefaultSalesAssignmentRules(user?.id || null);
  redirect('/sales-command');
}

async function executeAssignmentRules() {
  'use server';
  await requireAdminUser();
  await executeSalesAssignmentRules();
  redirect('/sales-command');
}

async function rerunEmailClassification(formData: FormData) {
  'use server';
  await requireAdminUser();
  const limit = Math.max(1, Math.min(2000, parseInt(String(formData.get('limit') || '500'), 10) || 500));
  const includeClassified = String(formData.get('includeClassified') || '') === 'true';
  await reclassifyEmailMessages({ limit, includeClassified });
  redirect('/sales-command');
}

async function runEmailAutopilot(formData: FormData) {
  'use server';
  await requireAdminUser();
  const apply = String(formData.get('apply') || '') === 'true';
  const taskLimit = Math.max(0, Math.min(100, parseInt(String(formData.get('taskLimit') || '20'), 10) || 20));
  const noiseLimit = Math.max(0, Math.min(200, parseInt(String(formData.get('noiseLimit') || '50'), 10) || 50));
  const sinceDays = Math.max(1, Math.min(365, parseInt(String(formData.get('sinceDays') || '30'), 10) || 30));
  const result = await runEmailActionAutopilot({ dryRun: !apply, taskLimit, noiseLimit, sinceDays });
  const qs = new URLSearchParams({
    emailAuto: apply ? 'applied' : 'dry',
    taskCandidates: String(result.taskCandidates),
    noiseCandidates: String(result.noiseCandidates),
    created: String(result.createdTasks),
    cleared: String(result.clearedTaskEmails + result.clearedNoiseEmails),
    skipped: String(result.skipped),
  });
  redirect(`/sales-command?${qs.toString()}`);
}

async function runEmailSecurityAction(formData: FormData) {
  'use server';
  await requireAdminUser();
  const apply = String(formData.get('apply') || '') === 'true';
  const limit = Math.max(1, Math.min(200, parseInt(String(formData.get('limit') || '50'), 10) || 50));
  const result = await runEmailSecurityWatch({ dryRun: !apply, limit });
  const qs = new URLSearchParams({
    emailSecurity: apply ? 'applied' : 'dry',
    staleCandidates: String(result.staleCandidates),
    freshPending: String(result.freshPending),
    archived: String(result.archived),
    notified: String(result.adminNotifications),
    skippedDuplicates: String(result.skippedDuplicates),
  });
  redirect(`/sales-command?${qs.toString()}#email-security-audit`);
}

async function createRadarTask(formData: FormData) {
  'use server';
  const user = await requireSalesUser();
  if (!user) return;

  const companyId = String(formData.get('companyId') || '');
  if (!companyId) return;
  const company = await prisma.company.findUnique({ where: { id: companyId }, include: { owner: true } });
  if (!company) return;

  const ownerIdFromForm = String(formData.get('ownerId') || '');
  const ownerId = ownerIdFromForm || company.ownerId || user.id;
  const owner = await prisma.user.findUnique({ where: { id: ownerId } });
  if (!owner) return;

  const sourceRef = `RADAR:${companyId}`;
  const exists = await prisma.salesTask.findFirst({
    where: { companyId, status: 'TODO', source: 'SALES_RADAR', sourceRef },
    select: { id: true },
  });
  if (exists) redirect('/sales-command');

  const dueHours = Math.max(2, Math.min(168, parseInt(String(formData.get('dueHours') || '24'), 10) || 24));
  const dueAt = new Date();
  dueAt.setHours(dueAt.getHours() + dueHours);
  const description = String(formData.get('description') || '').trim() || '根据智能销售雷达生成的跟进任务。';
  const priority = String(formData.get('priority') || 'NORMAL') as any;

  await prisma.salesTask.create({
    data: {
      title: String(formData.get('title') || '').trim() || `跟进 ${company.name}`,
      description,
      type: priority === 'URGENT' ? 'RISK_RESCUE' : 'FOLLOW_UP',
      priority,
      dueAt,
      ownerId: owner.id,
      createdById: user.id,
      companyId,
      source: 'SALES_RADAR',
      sourceRef,
    },
  });
  await prisma.company.update({
    where: { id: companyId },
    data: { nextAction: company.nextAction || description },
  });
  await prisma.notification.create({
    data: {
      userId: owner.id,
      type: 'SYSTEM',
      title: '销售雷达已生成跟进任务',
      body: `${company.name}: ${description}`,
      link: `/customers/${companyId}`,
    },
  });
  redirect('/sales-command');
}

async function completeSalesTask(formData: FormData) {
  'use server';
  const user = await requireSalesUser();
  if (!user) return;
  const role = (cookies().get('auth_role')?.value || '').toUpperCase();
  const id = String(formData.get('id') || '');
  if (!id) return;
  const task = await prisma.salesTask.findUnique({ where: { id }, include: { company: true } });
  if (!task) return;
  if (role === 'SALES' && task.ownerId !== user.id) return;

  await prisma.salesTask.update({
    where: { id },
    data: { status: 'DONE', completedAt: new Date() },
  });
  await prisma.followUp.create({
    data: {
      companyId: task.companyId,
      userId: user.id,
      type: 'TASK',
      content: `完成销售任务: ${task.title}`,
    },
  });
  redirect('/sales-command');
}

export default async function SalesCommandPage({
  searchParams = {},
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const role = (cookies().get('auth_role')?.value || '').toUpperCase();
  if (role !== 'SUPER_ADMIN' && role !== 'ADMIN' && role !== 'SALES') redirect('/dashboard');
  const canManage = role === 'SUPER_ADMIN' || role === 'ADMIN';
  const emailBulkResult = {
    bulk: firstParam(searchParams.emailBulk),
    created: firstParam(searchParams.created),
    cleared: firstParam(searchParams.cleared),
    skipped: firstParam(searchParams.skipped),
  };
  const emailAutoResult = {
    status: firstParam(searchParams.emailAuto),
    taskCandidates: firstParam(searchParams.taskCandidates),
    noiseCandidates: firstParam(searchParams.noiseCandidates),
    created: firstParam(searchParams.created),
    cleared: firstParam(searchParams.cleared),
    skipped: firstParam(searchParams.skipped),
  };
  const emailLabelPlanResult = {
    status: firstParam(searchParams.emailLabelPlan),
    planKey: firstParam(searchParams.labelPlanKey),
    candidates: firstParam(searchParams.labelCandidates),
    tagged: firstParam(searchParams.labelTagged),
    created: firstParam(searchParams.labelCreated),
    cleared: firstParam(searchParams.labelCleared),
    skipped: firstParam(searchParams.labelSkipped),
  };
  const emailSecurityResult = {
    status: firstParam(searchParams.emailSecurity),
    staleCandidates: firstParam(searchParams.staleCandidates),
    freshPending: firstParam(searchParams.freshPending),
    archived: firstParam(searchParams.archived),
    notified: firstParam(searchParams.notified),
    skippedDuplicates: firstParam(searchParams.skippedDuplicates),
  };
  const nextBulkResult = {
    bulk: firstParam(searchParams.nextBulk),
    created: firstParam(searchParams.created),
    updated: firstParam(searchParams.updated),
    skipped: firstParam(searchParams.skipped),
  };
  const oppBulkResult = {
    bulk: firstParam(searchParams.oppBulk),
    created: firstParam(searchParams.created),
    updated: firstParam(searchParams.updated),
    skipped: firstParam(searchParams.skipped),
  };
  const priorityActionResult = {
    status: firstParam(searchParams.priorityAction),
    created: firstParam(searchParams.priorityCreated),
    notified: firstParam(searchParams.priorityNotified),
    skipped: firstParam(searchParams.prioritySkipped),
  };
  const morningNotifyResult = {
    status: firstParam(searchParams.morningNotify),
    notified: firstParam(searchParams.morningNotified),
    skipped: firstParam(searchParams.morningSkipped),
  };
  const completionEvidenceResult = {
    status: firstParam(searchParams.completionEvidence),
    created: firstParam(searchParams.completionCreated),
    skipped: firstParam(searchParams.completionSkipped),
  };

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [
    users,
    rules,
    recentRuns,
    unassignedCount,
    highPriorityUnassigned,
    needsNextAction,
    staleCustomers,
    topQueue,
    healthQueue,
    nextActionQueue,
    staleActionQueue,
    staleOpportunities,
    lostReasonRows,
    openTaskCount,
    overdueTaskCount,
    todayTaskCount,
    salesTasks,
    ownerRows,
    sourceRows,
    morningNotifications,
  ] = await Promise.all([
    prisma.user.findMany({ where: { role: { in: ['SUPER_ADMIN', 'ADMIN', 'SALES'] as any }, isActive: true }, orderBy: [{ role: 'asc' }, { createdAt: 'asc' }] }),
    prisma.salesAssignmentRule.findMany({ orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }] }),
    prisma.salesAssignmentRun.findMany({ orderBy: { createdAt: 'desc' }, take: 12, include: { rule: true } }),
    prisma.company.count({ where: { ownerId: null } }),
    prisma.company.count({ where: { ownerId: null, priorityScore: { gte: 60 } } }),
    prisma.company.count({ where: { OR: [{ nextAction: null }, { nextAction: '' }] } }),
    prisma.company.count({ where: { updatedAt: { lt: sevenDaysAgo }, type: { in: ['INQUIRY', 'QUOTED', 'CONTRACT_SENT', 'PROSPECT', 'NEW'] as any } } }),
    prisma.company.findMany({
      where: { type: { in: ['INQUIRY', 'QUOTED', 'CONTRACT_SENT', 'PROSPECT', 'NEW'] as any } },
      orderBy: [{ priorityScore: 'desc' }, { updatedAt: 'asc' }],
      take: 15,
      include: {
        owner: true,
        contacts: { take: 1 },
        inboxMessages: { orderBy: { createdAt: 'desc' }, take: 6 },
        followUps: { orderBy: { createdAt: 'desc' }, take: 3 },
        opportunities: { orderBy: { updatedAt: 'desc' }, take: 5 },
        _count: { select: { inboxMessages: true, opportunities: true } },
      },
    }),
    prisma.company.findMany({
      where: { type: { in: ['INQUIRY', 'QUOTED', 'CONTRACT_SENT', 'DEAL_WON', 'KEY_ACCOUNT', 'PROSPECT', 'NEW', 'EXISTING'] as any } },
      orderBy: [{ updatedAt: 'asc' }, { priorityScore: 'desc' }],
      take: 120,
      include: {
        owner: true,
        contacts: { take: 3, orderBy: { createdAt: 'asc' } },
        inboxMessages: { orderBy: { createdAt: 'desc' }, take: 6 },
        followUps: { orderBy: { createdAt: 'desc' }, take: 3 },
        opportunities: { orderBy: { updatedAt: 'desc' }, take: 6 },
        salesTasks: { where: { status: 'TODO' }, orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }], take: 3 },
      },
    }),
    prisma.company.findMany({
      where: {
        type: { in: ['INQUIRY', 'QUOTED', 'CONTRACT_SENT', 'PROSPECT', 'NEW'] as any },
        OR: [{ nextAction: null }, { nextAction: '' }],
      },
      orderBy: [{ priorityScore: 'desc' }, { updatedAt: 'asc' }],
      take: 20,
      include: {
        owner: true,
        contacts: { take: 2, orderBy: { createdAt: 'asc' } },
        inboxMessages: { orderBy: { createdAt: 'desc' }, take: 6 },
        followUps: { orderBy: { createdAt: 'desc' }, take: 3 },
        opportunities: { orderBy: { updatedAt: 'desc' }, take: 5 },
        _count: { select: { inboxMessages: true, opportunities: true } },
      },
    }),
    prisma.company.findMany({
      where: {
        type: { in: ['INQUIRY', 'QUOTED', 'CONTRACT_SENT', 'PROSPECT', 'NEW'] as any },
        updatedAt: { lt: sevenDaysAgo },
      },
      orderBy: [{ updatedAt: 'asc' }, { priorityScore: 'desc' }],
      take: 20,
      include: {
        owner: true,
        contacts: { take: 2, orderBy: { createdAt: 'asc' } },
        inboxMessages: { orderBy: { createdAt: 'desc' }, take: 6 },
        followUps: { orderBy: { createdAt: 'desc' }, take: 3 },
        opportunities: { orderBy: { updatedAt: 'desc' }, take: 5 },
        _count: { select: { inboxMessages: true, opportunities: true } },
      },
    }),
    prisma.opportunity.findMany({
      where: { stage: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] as any }, stageChangedAt: { lt: sevenDaysAgo } },
      orderBy: [{ stageChangedAt: 'asc' }, { amountUSD: 'desc' }],
      take: 12,
      include: { company: true, owner: true },
    }),
    prisma.opportunity.groupBy({
      by: ['lostReason'],
      where: { stage: 'CLOSED_LOST' },
      _count: { _all: true },
      orderBy: { _count: { lostReason: 'desc' } },
      take: 8,
    }),
    prisma.salesTask.count({ where: { status: 'TODO' } }),
    prisma.salesTask.count({ where: { status: 'TODO', dueAt: { lt: new Date() } } }),
    prisma.salesTask.count({ where: { status: 'TODO', dueAt: { gte: new Date(), lt: tomorrow } } }),
    prisma.salesTask.findMany({
      where: { status: 'TODO' },
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
      take: 12,
      include: { owner: true, company: true, opportunity: true },
    }),
    prisma.company.groupBy({ by: ['ownerId'], _count: { _all: true } }),
    prisma.company.groupBy({ by: ['source'], _count: { _all: true }, orderBy: { _count: { source: 'desc' } }, take: 8 }),
    prisma.notification.findMany({
      where: { title: '老板晨会摘要: 今日必须处理', createdAt: { gte: sevenDaysAgo } },
      orderBy: { createdAt: 'desc' },
      take: 120,
      include: { user: { select: { name: true, email: true, role: true } } },
    }),
  ]);

  const usersById = new Map(users.map((u) => [u.id, u]));
  const assignedTotal = ownerRows.reduce((sum, r) => sum + r._count._all, 0);
  const salesRadarItems = topQueue
    .map((company) => ({ company, radar: buildSalesRadar(company) }))
    .sort((a, b) => b.radar.score - a.radar.score)
    .slice(0, 6);
  const customerHealthRows = healthQueue
    .map((company) => ({ company, health: buildCustomerHealthRow(company) }))
    .filter(({ health }) => health.shortfalls.length > 0 || health.score < 75)
    .sort((a, b) => b.health.priorityWeight - a.health.priorityWeight || a.health.score - b.health.score)
    .slice(0, 6);
  const nextActionRows = nextActionQueue
    .map((company) => ({ company, radar: buildSalesRadar(company) }))
    .sort((a, b) => b.radar.score - a.radar.score || b.company.priorityScore - a.company.priorityScore);
  const staleActionRows = staleActionQueue
    .map((company) => ({ company, radar: buildSalesRadar(company) }))
    .sort((a, b) => (b.radar.level === 'risk' ? 1 : 0) - (a.radar.level === 'risk' ? 1 : 0) || b.radar.score - a.radar.score);
  const radarActionRows = salesRadarItems.filter(({ radar }) => radar.level === 'hot' || radar.level === 'risk' || radar.metrics.awaitingReply);
  const staleOpportunityRows = staleOpportunities.map((opportunity) => {
    const stageDate = opportunity.stageChangedAt || opportunity.updatedAt;
    const ageDays = Math.max(0, Math.floor((Date.now() - new Date(stageDate).getTime()) / 86400000));
    return { opportunity, ageDays };
  });
  const priorityOpportunityRows = staleOpportunityRows.filter(
    ({ opportunity, ageDays }) => ageDays >= 14 || (opportunity.amountUSD || 0) >= 10000 || opportunity.stage === 'NEGOTIATING' || opportunity.stage === 'SPEC_CONFIRMING'
  );
  const actionAttribution = await buildSalesActionAttributionReport({ since: thirtyDaysAgo, until: new Date() });
  const stageVelocity = await buildOpportunityStageVelocityReport({ since: thirtyDaysAgo, until: new Date() });
  const emailAudit = await buildEmailClassificationAudit({ sampleLimit: 8 });
  const emailActionClosure = await buildEmailActionClosureAudit({ since: thirtyDaysAgo, until: new Date(), sampleLimit: 8 });
  const emailSecurity = await buildEmailSecurityAudit({ sampleLimit: 8 });
  const channelQuality = await buildChannelQualityReport({ since: ninetyDaysAgo });
  const automationFunnel = buildAutomationFunnelInsights(await prisma.automationFlow.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 200,
    include: { runs: { orderBy: { createdAt: 'desc' }, take: 20 } },
  }));
  const [channelRevenueMessages, channelRevenueTasks, channelRevenueOpportunities] = await Promise.all([
    prisma.inboxMessage.findMany({
      where: { direction: 'IN', companyId: { not: null }, createdAt: { gte: thirtyDaysAgo, lt: new Date() } },
      include: { company: { select: { id: true, name: true, owner: { select: { name: true, email: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    }),
    prisma.salesTask.findMany({
      where: {
        createdAt: { gte: thirtyDaysAgo, lt: new Date() },
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
        stageChangedAt: { gte: thirtyDaysAgo, lt: new Date() },
        stage: { in: ['REPLIED', 'QUOTING', 'NEGOTIATING', 'SPEC_CONFIRMING', 'CLOSED_WON'] as any },
      },
      select: { id: true, title: true, companyId: true, stage: true, amountUSD: true, stageChangedAt: true, updatedAt: true, owner: { select: { name: true, email: true } } },
      orderBy: [{ stageChangedAt: 'desc' }, { amountUSD: 'desc' }],
      take: 800,
    }),
  ]);
  const channelRevenue = buildChannelMessageRevenueReport({
    messages: channelRevenueMessages,
    tasks: channelRevenueTasks,
    opportunities: channelRevenueOpportunities,
    until: new Date(),
  });
  const healthAutomationEffect = await buildCustomerHealthAutomationEffectReport({ since: thirtyDaysAgo, until: new Date() });
  const [completionRepairTasks, completionEscalationNotifications] = await Promise.all([
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
      take: 120,
      include: { owner: true, company: true },
    }),
    prisma.notification.count({
      where: { title: '补证据任务逾期升级', createdAt: { gte: thirtyDaysAgo } },
    }),
  ]);
  const completionEscalation = buildCompletionEvidenceEscalationReport({
    tasks: completionRepairTasks,
    escalationNotifications: completionEscalationNotifications,
    now: new Date(),
  });
  const priorityQueue = buildSalesPriorityQueue({
    channelSamples: channelRevenue.samples,
    salesTasks,
    staleOpportunities: staleOpportunityRows,
    customerHealthRows,
    automationRisks: automationFunnel.riskFlows,
    emailTasks: emailActionClosure.topTasks,
    healthTasks: healthAutomationEffect.topTasks,
    completionEvidenceEscalations: completionEscalation.rows.filter((row) => row.statusLabel === '已升级' || row.statusLabel === '已逾期'),
    now: new Date(),
  });
  const ownerPriorityReport = buildSalesOwnerPriorityReport(priorityQueue.items);
  const morningBriefing = buildSalesMorningBriefing(priorityQueue.items, ownerPriorityReport.rows);
  const morningClosure = buildMorningBriefingClosureReport(morningNotifications, new Date());
  const priorityActionSourceRefs = priorityQueue.items.map((item) => `priority:${item.id}`);
  const trackedTaskItemIds = priorityQueue.items
    .filter((item) => item.kind === 'SALES_TASK' || item.kind === 'EMAIL_ACTION' || item.kind === 'HEALTH_TASK')
    .map((item) => item.id.slice(item.id.indexOf(':') + 1))
    .filter(Boolean);
  const actionClosureTasks = await prisma.salesTask.findMany({
    where: {
      OR: [
        { source: 'DAILY_PRIORITY', sourceRef: { in: priorityActionSourceRefs } },
        { id: { in: trackedTaskItemIds } },
        { source: 'DAILY_PRIORITY', sourceRef: { startsWith: 'priority:' }, createdAt: { gte: sevenDaysAgo } },
      ],
    },
    orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
    take: 120,
    include: { owner: true, company: true, opportunity: true },
  });
  const actionClosure = buildSalesActionClosureReport({ items: priorityQueue.items, tasks: actionClosureTasks, now: new Date() });
  const completionEvidenceTasks = await prisma.salesTask.findMany({
    where: {
      status: 'DONE',
      completedAt: { gte: thirtyDaysAgo, lt: new Date() },
      source: { in: ['DAILY_PRIORITY', 'EMAIL_ACTION_BULK', 'OMNIBOX_BULK', 'AUTOMATION_NO_REPLY_TIMEOUT', 'CUSTOMER_HEALTH_AUTOMATION', 'SALES_RADAR'] },
    },
    orderBy: { completedAt: 'desc' },
    take: 60,
    include: { owner: true, company: true, opportunity: true },
  });
  const completionCompanyIds = Array.from(new Set(completionEvidenceTasks.map((task) => task.companyId)));
  const completionWindowStart = completionEvidenceTasks.reduce<Date | null>((min, task) => {
    if (!task.completedAt) return min;
    const candidate = new Date(task.completedAt.getTime() - 5 * 60000);
    return !min || candidate < min ? candidate : min;
  }, null) || thirtyDaysAgo;
  const [completionFollowUps, completionMessages, completionOpportunities] = completionCompanyIds.length > 0
    ? await Promise.all([
        prisma.followUp.findMany({
          where: { companyId: { in: completionCompanyIds }, createdAt: { gte: completionWindowStart } },
          include: { user: true },
          orderBy: { createdAt: 'desc' },
          take: 500,
        }),
        prisma.inboxMessage.findMany({
          where: {
            companyId: { in: completionCompanyIds },
            direction: 'OUT',
            OR: [{ createdAt: { gte: completionWindowStart } }, { sentAt: { gte: completionWindowStart } }],
          },
          orderBy: { createdAt: 'desc' },
          take: 500,
        }),
        prisma.opportunity.findMany({
          where: { companyId: { in: completionCompanyIds }, stageChangedAt: { gte: completionWindowStart } },
          orderBy: { stageChangedAt: 'desc' },
          take: 300,
        }),
      ])
    : [[], [], []];
  const completionEvidence = buildSalesCompletionEvidenceReport({
    tasks: completionEvidenceTasks,
    followUps: completionFollowUps,
    messages: completionMessages,
    opportunities: completionOpportunities,
  });

  return (
    <div className="min-h-screen bg-gray-50 p-6 md:p-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">销售指挥台</h1>
          <p className="text-sm text-gray-500 mt-1">线索分配、跟进 SLA、客户优先级和团队负载集中处理</p>
        </div>
        <div className="flex gap-2">
          <Link href="/customers" className="px-4 py-2 rounded-lg border border-gray-200 bg-white text-gray-700 text-sm font-bold hover:bg-gray-50">客户列表</Link>
          <Link href="/sales-kpi" className="px-4 py-2 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-sm font-bold hover:bg-emerald-100">销售KPI</Link>
          <Link href="/tasks" className="px-4 py-2 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 text-sm font-bold hover:bg-blue-100">销售任务</Link>
          <Link href="/automation" className="px-4 py-2 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 text-sm font-bold hover:bg-indigo-100">自动化流程</Link>
          {canManage && (
            <form action={createDefaultRules}>
              <button className="px-4 py-2 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-sm font-bold hover:bg-emerald-100">初始化推荐规则</button>
            </form>
          )}
        </div>
      </header>

      <section className="mb-6 grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Metric label="待分配客户" value={unassignedCount} tone="blue" />
        <Metric label="高优先级未分配" value={highPriorityUnassigned} tone="rose" />
        <Metric label="缺下一步动作" value={needsNextAction} tone="amber" />
        <Metric label="7天未动客户" value={staleCustomers} tone="violet" />
        <Metric label="已分配客户" value={assignedTotal} tone="emerald" />
      </section>

      <section className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-3">
        <Metric label="销售待办任务" value={openTaskCount} tone="blue" />
        <Metric label="已逾期任务" value={overdueTaskCount} tone="rose" />
        <Metric label="24小时内到期" value={todayTaskCount} tone="amber" />
      </section>

      <MorningBriefingPanel briefing={morningBriefing} result={morningNotifyResult} />
      <MorningClosurePanel report={morningClosure} />
      <ActionClosurePanel report={actionClosure} />
      <CompletionEvidencePanel report={completionEvidence} result={completionEvidenceResult} />
      <CompletionEvidenceEscalationPanel report={completionEscalation} />
      <DailyPriorityPanel queue={priorityQueue} result={priorityActionResult} />
      <OwnerPriorityPanel report={ownerPriorityReport} />

      <section className="mb-6 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-bold text-gray-900">客户健康修复队列</h2>
            <p className="mt-1 text-xs text-gray-400">按客户五点体检挑出最该补资料、补联系人、补互动、推商机、补负责人的客户。</p>
          </div>
          <Link href="/customers" className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-200">查看客户体检</Link>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {customerHealthRows.map(({ company, health }) => (
            <HealthQueueCard
              key={company.id}
              href={`/customers/${company.id}`}
              name={company.name}
              owner={health.ownerLabel}
              score={health.score}
              shortfalls={health.shortfalls}
              action={health.action}
              fitScore={health.fitScore}
              contactScore={health.contactScore}
              engagementScore={health.engagementScore}
              pipelineScore={health.pipelineScore}
              ownerScore={health.ownerScore}
            />
          ))}
          {customerHealthRows.length === 0 && <div className="text-sm text-gray-400">暂无明显健康短板客户。</div>}
        </div>
      </section>

      <section className="mb-6 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-bold text-gray-900">下一步动作编排台</h2>
            <p className="mt-1 text-xs text-gray-400">按 Pipedrive Next activity、HubSpot Sales Workspace、Salesforce/Zoho Activities 的思路,把缺下一步和沉睡客户批量变成有负责人、有截止时间的销售任务。</p>
          </div>
          <Link href="/tasks?view=week" className="rounded-lg bg-gray-900 px-3 py-2 text-xs font-black text-white hover:bg-gray-800">查看任务队列</Link>
        </div>
        {nextBulkResult.bulk && <NextActionBulkResultBanner result={nextBulkResult} />}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <NextActionCard
            title="补下一步动作"
            count={nextActionRows.length}
            detail="无 nextAction 的客户,批量写入建议动作并生成跟进任务。"
            action="next_action"
            buttonLabel="生成下一步任务"
            ids={nextActionRows.map(({ company }) => company.id)}
            tone="amber"
          />
          <NextActionCard
            title="激活沉睡客户"
            count={staleActionRows.length}
            detail="7 天未动的询盘/报价/合同客户,批量生成唤醒任务。"
            action="stale_reactivate"
            buttonLabel="生成激活任务"
            ids={staleActionRows.map(({ company }) => company.id)}
            tone="violet"
          />
          <NextActionCard
            title="雷达高风险"
            count={radarActionRows.length}
            detail="高意向、风险预警或客户等待回复的客户,优先生成任务。"
            action="next_action"
            buttonLabel="处理雷达风险"
            ids={radarActionRows.map(({ company }) => company.id)}
            tone="rose"
          />
          <NextActionCard
            title="修复健康短板"
            count={customerHealthRows.length}
            detail="体检低分或存在资料、联系人、互动、商机、负责人短板的客户,批量生成修复任务。"
            action="customer_health_repair"
            buttonLabel="生成修复任务"
            ids={customerHealthRows.map(({ company }) => company.id)}
            tone="slate"
          />
        </div>
        <div className="mt-4 grid gap-3 xl:grid-cols-3">
          <NextActionPreview title="缺下一步预览" rows={nextActionRows} empty="暂无缺下一步客户。" />
          <NextActionPreview title="沉睡客户预览" rows={staleActionRows} empty="暂无沉睡客户。" />
          <NextActionPreview title="雷达风险预览" rows={radarActionRows} empty="暂无高风险雷达客户。" />
        </div>
      </section>

      <section className="mb-6 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-bold text-gray-900">销售动作多触点归因</h2>
            <p className="mt-1 text-xs text-gray-400">近 30 天商机推进/赢单结果,回看结果前 30 天同客户触点;跟进、完成任务、我方消息、客户来信按等权拆分贡献。</p>
          </div>
          <span className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">保守多触点</span>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <AttributionMetric label="推进商机" value={actionAttribution.outcomes} detail={`可归因 ${actionAttribution.attributedOutcomes}`} tone={actionAttribution.attributedOutcomes > 0 ? 'blue' : 'gray'} />
          <AttributionMetric label="赢单收入" value={`$${Math.round(actionAttribution.revenue).toLocaleString()}`} detail={`${actionAttribution.wonDeals} 个赢单`} tone={actionAttribution.revenue > 0 ? 'emerald' : 'gray'} />
          <AttributionMetric label="归因收入" value={`$${Math.round(actionAttribution.attributedRevenue).toLocaleString()}`} detail={`覆盖率 ${formatLocalPercent(actionAttribution.attributionCoverage)}`} tone={actionAttribution.attributedRevenue > 0 ? 'emerald' : 'gray'} />
          <AttributionMetric label="有效触点" value={actionAttribution.touchCredits} detail={`平均 ${actionAttribution.avgTouches} 个/结果`} tone={actionAttribution.touchCredits > 0 ? 'amber' : 'gray'} />
          <AttributionMetric label="最佳触点" value={actionAttribution.bestType?.label || '-'} detail={actionAttribution.bestType ? `$${Math.round(actionAttribution.bestType.revenueCredit).toLocaleString()} 归因收入` : '等待数据'} tone={actionAttribution.bestType ? 'violet' : 'gray'} />
        </div>
        <div className="mt-4 rounded-xl bg-gray-50 px-4 py-3 text-xs font-bold text-gray-600">{actionAttribution.recommendation}</div>
        <div className="mt-4 grid gap-4 xl:grid-cols-3">
          <div className="rounded-xl border border-gray-100 p-4">
            <h3 className="text-xs font-black text-gray-500">按触点类型</h3>
            <div className="mt-3 space-y-3">
              {actionAttribution.byType.map((item) => (
                <AttributionBar key={item.key} label={item.label} value={item.touchCredits} max={actionAttribution.maxTypeCredit} detail={`收入 $${Math.round(item.revenueCredit).toLocaleString()} · 推进 ${formatLocalNumber(item.stageCredit)}`} />
              ))}
              {actionAttribution.byType.length === 0 && <div className="rounded-lg bg-gray-50 p-3 text-xs font-bold text-gray-400">暂无可归因触点。</div>}
            </div>
          </div>
          <div className="rounded-xl border border-gray-100 p-4">
            <h3 className="text-xs font-black text-gray-500">按负责人</h3>
            <div className="mt-3 space-y-3">
              {actionAttribution.byOwner.slice(0, 6).map((item) => (
                <AttributionBar key={item.key} label={item.label} value={item.revenueCredit} max={actionAttribution.maxOwnerRevenue} detail={`触点 ${item.touchCredits} · 推进 ${formatLocalNumber(item.stageCredit)}`} />
              ))}
              {actionAttribution.byOwner.length === 0 && <div className="rounded-lg bg-gray-50 p-3 text-xs font-bold text-gray-400">暂无负责人归因。</div>}
            </div>
          </div>
          <div className="rounded-xl border border-gray-100 p-4">
            <h3 className="text-xs font-black text-gray-500">关键推进结果</h3>
            <div className="mt-3 space-y-2">
              {actionAttribution.topOutcomes.map((item) => (
                <div key={item.id} className="rounded-lg bg-gray-50 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/opportunity/${item.id}`} className="min-w-0 truncate text-xs font-black text-indigo-700 hover:underline">{item.title}</Link>
                    <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-black text-gray-600">{item.stageLabel}</span>
                  </div>
                  <div className="mt-1 text-[11px] font-bold text-gray-500">{item.companyName} · {item.ownerName} · {item.touchCount} 个触点</div>
                  <div className="mt-1 text-[11px] font-bold text-gray-400">金额 ${Math.round(item.amountUSD).toLocaleString()} · 主触点 {item.topTouchLabel}</div>
                </div>
              ))}
              {actionAttribution.topOutcomes.length === 0 && <div className="rounded-lg bg-gray-50 p-3 text-xs font-bold text-gray-400">暂无近期推进结果。</div>}
            </div>
          </div>
        </div>
      </section>

      <section className="mb-6 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-bold text-gray-900">全渠道消息收入闭环</h2>
            <p className="mt-1 text-xs text-gray-400">近 30 天入站消息,按渠道复盘回复 SLA、任务转化、后续商机推进和赢单收入。</p>
          </div>
          <Link href="/omnibox" className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-200">查看全渠道收件箱</Link>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <AttributionMetric label="入站消息" value={channelRevenue.total} detail={`${channelRevenue.highIntent} 条高意向`} tone={channelRevenue.total > 0 ? 'blue' : 'gray'} />
          <AttributionMetric label="回复率" value={formatLocalPercent(channelRevenue.replyRate)} detail={`24h SLA ${formatLocalPercent(channelRevenue.slaRate)}`} tone={channelRevenue.replyRate && channelRevenue.replyRate >= 0.8 ? 'emerald' : channelRevenue.pending > 0 ? 'amber' : 'gray'} />
          <AttributionMetric label="待处理" value={channelRevenue.pending} detail={`${channelRevenue.overduePending} 条逾期`} tone={channelRevenue.overduePending > 0 ? 'rose' : channelRevenue.pending > 0 ? 'amber' : 'emerald'} />
          <AttributionMetric label="转任务" value={channelRevenue.taskConverted} detail={`转化率 ${formatLocalPercent(channelRevenue.taskRate)}`} tone={channelRevenue.taskConverted > 0 ? 'violet' : 'gray'} />
          <AttributionMetric label="后续推进" value={channelRevenue.downstreamOutcomes} detail={`消息到商机 ${formatLocalPercent(channelRevenue.outcomeRate)}`} tone={channelRevenue.downstreamOutcomes > 0 ? 'blue' : 'gray'} />
          <AttributionMetric label="影响收入" value={`$${Math.round(channelRevenue.influencedRevenue).toLocaleString()}`} detail={`${channelRevenue.wonDeals} 个赢单`} tone={channelRevenue.influencedRevenue > 0 ? 'emerald' : 'gray'} />
        </div>
        <div className="mt-4 rounded-xl bg-gray-50 px-4 py-3 text-xs font-bold text-gray-600">{channelRevenue.recommendation}</div>
        <div className="mt-4 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-xl border border-gray-100 p-4">
            <h3 className="text-xs font-black text-gray-500">渠道收入与 SLA</h3>
            <div className="mt-3 space-y-3">
              {channelRevenue.byChannel.map((row) => (
                <div key={row.channel} className="rounded-lg bg-gray-50 px-3 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 truncate text-xs font-black text-gray-900">{row.channelLabel}</div>
                    <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-black text-emerald-700">${Math.round(row.influencedRevenue).toLocaleString()}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] font-bold text-gray-500 md:grid-cols-4">
                    <span>消息 {row.messages}</span>
                    <span>回复 {formatLocalPercent(row.replyRate)}</span>
                    <span>任务 {formatLocalPercent(row.taskRate)}</span>
                    <span>推进 {row.downstreamOutcomes}</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(4, Math.round((row.influencedRevenue / channelRevenue.maxChannelRevenue) * 100))}%` }} />
                  </div>
                  <div className="mt-1 text-[11px] font-bold text-gray-400">SLA {formatLocalPercent(row.slaRate)} · 待处理 {row.pending} · 逾期 {row.overduePending} · 健康分 {row.healthScore}</div>
                </div>
              ))}
              {channelRevenue.byChannel.length === 0 && <div className="rounded-lg bg-gray-50 p-3 text-xs font-bold text-gray-400">暂无可归因渠道消息。</div>}
            </div>
          </div>
          <div className="rounded-xl border border-gray-100 p-4">
            <h3 className="text-xs font-black text-gray-500">关键消息样本</h3>
            <div className="mt-3 space-y-2">
              {channelRevenue.samples.map((item) => (
                <div key={item.id} className="rounded-lg bg-gray-50 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/customers/${item.companyId}`} className="min-w-0 truncate text-xs font-black text-indigo-700 hover:underline">{item.companyName}</Link>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-black ${item.isOverdue ? 'bg-rose-50 text-rose-700' : item.taskConverted ? 'bg-violet-50 text-violet-700' : 'bg-white text-gray-600'}`}>{item.statusLabel}</span>
                  </div>
                  <div className="mt-1 truncate text-[11px] font-bold text-gray-500">{item.channelLabel} · {item.intentLabel} · {item.ownerName}</div>
                  <div className="mt-1 text-[11px] font-bold text-gray-400">等待 {item.ageHours}h · 推进 {item.downstreamOutcomes} · 赢单 ${Math.round(item.wonRevenue).toLocaleString()}</div>
                </div>
              ))}
              {channelRevenue.samples.length === 0 && <div className="rounded-lg bg-gray-50 p-3 text-xs font-bold text-gray-400">暂无可展示消息样本。</div>}
            </div>
          </div>
        </div>
      </section>

      <section className="mb-6 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-bold text-gray-900">客户健康自动化效果</h2>
            <p className="mt-1 text-xs text-gray-400">复盘客户健康修复任务是否被处理,以及任务生成后是否推动商机阶段或赢单。</p>
          </div>
          <span className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">近 30 天</span>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <AttributionMetric label="健康任务" value={healthAutomationEffect.totalTasks} detail={`${healthAutomationEffect.automationTasks} 自动化 · ${healthAutomationEffect.bulkTasks} 批量`} tone={healthAutomationEffect.totalTasks > 0 ? 'blue' : 'gray'} />
          <AttributionMetric label="已完成" value={healthAutomationEffect.doneTasks} detail={`完成率 ${formatLocalPercent(healthAutomationEffect.completionRate)}`} tone={healthAutomationEffect.doneTasks > 0 ? 'emerald' : 'gray'} />
          <AttributionMetric label="当前待办" value={healthAutomationEffect.openTasks} detail={`${healthAutomationEffect.overdueTasks} 个逾期`} tone={healthAutomationEffect.overdueTasks > 0 ? 'rose' : healthAutomationEffect.openTasks > 0 ? 'amber' : 'emerald'} />
          <AttributionMetric label="触达客户" value={healthAutomationEffect.companyCount} detail={`${healthAutomationEffect.ownerCount} 个负责人`} tone={healthAutomationEffect.companyCount > 0 ? 'violet' : 'gray'} />
          <AttributionMetric label="后续推进" value={healthAutomationEffect.downstreamOutcomes} detail={`有效率 ${formatLocalPercent(healthAutomationEffect.downstreamRate)}`} tone={healthAutomationEffect.downstreamOutcomes > 0 ? 'blue' : 'gray'} />
          <AttributionMetric label="赢单收入" value={`$${Math.round(healthAutomationEffect.wonRevenue).toLocaleString()}`} detail={`${healthAutomationEffect.wonDeals} 个赢单`} tone={healthAutomationEffect.wonRevenue > 0 ? 'emerald' : 'gray'} />
        </div>
        <div className="mt-4 rounded-xl bg-gray-50 px-4 py-3 text-xs font-bold text-gray-600">{healthAutomationEffect.recommendation}</div>
        <div className="mt-4 grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-xl border border-gray-100 p-4">
            <h3 className="text-xs font-black text-gray-500">按来源</h3>
            <div className="mt-3 space-y-3">
              {healthAutomationEffect.bySource.map((row) => (
                <AttributionBar key={row.source} label={row.sourceLabel} value={row.totalTasks} max={healthAutomationEffect.maxSourceTasks} detail={`${row.doneTasks} 完成 · ${row.downstreamOutcomes} 推进 · $${Math.round(row.wonRevenue).toLocaleString()}`} />
              ))}
              {healthAutomationEffect.bySource.length === 0 && <div className="rounded-lg bg-gray-50 p-3 text-xs font-bold text-gray-400">暂无客户健康自动化任务。</div>}
            </div>
          </div>
          <div className="rounded-xl border border-gray-100 p-4">
            <h3 className="text-xs font-black text-gray-500">关键样本</h3>
            <div className="mt-3 space-y-2">
              {healthAutomationEffect.topTasks.map((item) => (
                <div key={item.id} className="rounded-lg bg-gray-50 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/customers/${item.companyId}`} className="min-w-0 truncate text-xs font-black text-indigo-700 hover:underline">{item.companyName}</Link>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-black ${item.status === 'DONE' ? 'bg-emerald-50 text-emerald-700' : item.isOverdue ? 'bg-rose-50 text-rose-700' : 'bg-white text-gray-600'}`}>{item.statusLabel}</span>
                  </div>
                  <div className="mt-1 truncate text-[11px] font-bold text-gray-500">{item.sourceLabel} · {item.ownerName} · {item.createdAtLabel}</div>
                  <div className="mt-1 text-[11px] font-bold text-gray-400">后续推进 {item.downstreamOutcomes} · 赢单 ${Math.round(item.wonRevenue).toLocaleString()}</div>
                </div>
              ))}
              {healthAutomationEffect.topTasks.length === 0 && <div className="rounded-lg bg-gray-50 p-3 text-xs font-bold text-gray-400">暂无可复盘样本。</div>}
            </div>
          </div>
        </div>
      </section>

      <section className="mb-6 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-bold text-gray-900">商机阶段速度复盘</h2>
            <p className="mt-1 text-xs text-gray-400">近 30 天阶段变更历史,按进入阶段统计停留时长、赢单前速度和慢流转商机。</p>
          </div>
          <span className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">Stage velocity</span>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <AttributionMetric label="阶段变更" value={stageVelocity.totalChanges} detail={`覆盖 ${stageVelocity.opportunityCount} 个商机`} tone={stageVelocity.totalChanges > 0 ? 'blue' : 'gray'} />
          <AttributionMetric label="平均停留" value={stageVelocity.avgDurationLabel} detail="变更前所在阶段" tone={stageVelocity.avgDurationDays > 0 ? 'amber' : 'gray'} />
          <AttributionMetric label="赢单前平均" value={stageVelocity.wonAvgDurationLabel} detail={`${stageVelocity.wonChanges} 次赢单变更`} tone={stageVelocity.wonChanges > 0 ? 'emerald' : 'gray'} />
          <AttributionMetric label="超7天变更" value={stageVelocity.slowChanges} detail="需要复盘堵点" tone={stageVelocity.slowChanges > 0 ? 'violet' : 'gray'} />
          <AttributionMetric label="历史金额" value={`$${Math.round(stageVelocity.snapshotRevenue).toLocaleString()}`} detail="变更时金额快照" tone={stageVelocity.snapshotRevenue > 0 ? 'emerald' : 'gray'} />
        </div>
        <div className="mt-4 rounded-xl bg-gray-50 px-4 py-3 text-xs font-bold text-gray-600">{stageVelocity.recommendation}</div>
        <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1.2fr]">
          <div className="rounded-xl border border-gray-100 p-4">
            <h3 className="text-xs font-black text-gray-500">按进入阶段</h3>
            <div className="mt-3 space-y-3">
              {stageVelocity.byStage.map((item) => (
                <AttributionBar
                  key={item.stage}
                  label={item.stageLabel}
                  value={item.avgDurationDays}
                  max={stageVelocity.maxStageDuration}
                  detail={`${item.changes} 次 · 赢单 ${item.wonChanges} · 金额 $${Math.round(item.revenue).toLocaleString()}`}
                />
              ))}
              {stageVelocity.byStage.length === 0 && <div className="rounded-lg bg-gray-50 p-3 text-xs font-bold text-gray-400">暂无阶段历史。推进阶段后自动生成速度复盘。</div>}
            </div>
          </div>
          <div className="rounded-xl border border-gray-100 p-4">
            <h3 className="text-xs font-black text-gray-500">慢流转商机</h3>
            <div className="mt-3 space-y-2">
              {stageVelocity.slowTransitions.map((item) => (
                <div key={item.id} className="rounded-lg bg-gray-50 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/opportunity/${item.opportunityId}`} className="min-w-0 truncate text-xs font-black text-indigo-700 hover:underline">{item.title}</Link>
                    <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-black text-rose-600">{item.durationDays} 天</span>
                  </div>
                  <div className="mt-1 text-[11px] font-bold text-gray-500">{item.companyName} · {item.ownerName}</div>
                  <div className="mt-1 text-[11px] font-bold text-gray-400">{item.fromStageLabel} → {item.toStageLabel} · {item.changedAtLabel} · ${Math.round(item.amountUSD).toLocaleString()}</div>
                </div>
              ))}
              {stageVelocity.slowTransitions.length === 0 && <div className="rounded-lg bg-gray-50 p-3 text-xs font-bold text-gray-400">近 30 天暂无超过 7 天才推进的阶段变更。</div>}
            </div>
          </div>
        </div>
      </section>

      <section className="mb-6 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-bold text-gray-900">商机停滞救援台</h2>
            <p className="mt-1 text-xs text-gray-400">参考 HubSpot/Zoho 的条件自动化、Pipedrive Deal rotting 和 Outreach Opportunity task,把停滞商机直接变成有负责人、有截止时间、有救援动作的任务。</p>
          </div>
          <Link href="/tasks?view=week" className="rounded-lg bg-gray-900 px-3 py-2 text-xs font-black text-white hover:bg-gray-800">查看救援任务</Link>
        </div>
        {oppBulkResult.bulk && <OpportunityRescueResultBanner result={oppBulkResult} />}
        <div className="grid gap-3 md:grid-cols-3">
          <OpportunityRescueCard
            title="批量救援停滞商机"
            count={staleOpportunityRows.length}
            detail="超过 7 天未推进的打开商机,统一补负责人、补下一步、建救援任务。"
            action="rescue_stale"
            buttonLabel="生成救援任务"
            ids={staleOpportunityRows.map(({ opportunity }) => opportunity.id)}
            tone="rose"
          />
          <OpportunityRescueCard
            title="高风险优先救援"
            count={priorityOpportunityRows.length}
            detail="金额高、超 14 天、谈判中或规格确认中的商机,24 小时内优先处理。"
            action="rescue_priority"
            buttonLabel="优先救援"
            ids={priorityOpportunityRows.map(({ opportunity }) => opportunity.id)}
            tone="amber"
          />
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 text-slate-900">
            <div className="text-xs font-black opacity-75">阶段 SLA 看板</div>
            <div className="mt-2 text-2xl font-black">{stageVelocity.slowChanges}</div>
            <div className="mt-2 min-h-[34px] text-xs font-bold opacity-75">近 30 天慢流转变更次数,结合下方阶段速度复盘定位堵点。</div>
            <Link href="/sales-command#opportunity-stale-table" className="mt-4 block rounded-lg bg-slate-700 px-3 py-2 text-center text-xs font-black text-white hover:bg-slate-800">查看超期明细</Link>
          </div>
        </div>
        <div className="mt-4 grid gap-3 xl:grid-cols-2">
          <OpportunityRescuePreview title="救援队列预览" rows={staleOpportunityRows} empty="暂无需要救援的停滞商机。" />
          <OpportunityRescuePreview title="高风险预览" rows={priorityOpportunityRows} empty="暂无高风险停滞商机。" />
        </div>
      </section>

      <section className="mb-6 bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-gray-900">Gmail / 邮件分类审计</h2>
            <p className="text-xs text-gray-400 mt-1">按外贸销售动作审计 CRM 邮件表:询盘、报价、订单、财务、物流、海关合规、平台通知、营销噪音和低置信复核。</p>
          </div>
          {canManage && (
            <div className="flex flex-wrap gap-2">
              <form action={runEmailAutopilot}>
                <input type="hidden" name="taskLimit" value="20" />
                <input type="hidden" name="noiseLimit" value="50" />
                <input type="hidden" name="sinceDays" value="30" />
                <button className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-black text-indigo-700 hover:bg-indigo-100">预演自动驾驶</button>
              </form>
              <form action={runEmailAutopilot}>
                <input type="hidden" name="apply" value="true" />
                <input type="hidden" name="taskLimit" value="20" />
                <input type="hidden" name="noiseLimit" value="50" />
                <input type="hidden" name="sinceDays" value="30" />
                <button className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-black text-rose-700 hover:bg-rose-100">执行自动驾驶</button>
              </form>
              <a
                href="/api/emails/classify?limit=500&all=1&dryRun=true"
                className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700 hover:bg-blue-100"
              >
                预演最近 500 封
              </a>
              <form action={rerunEmailClassification}>
                <input type="hidden" name="limit" value="500" />
                <button className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700 hover:bg-emerald-100">重跑未分类 500 封</button>
              </form>
              <form action={rerunEmailClassification}>
                <input type="hidden" name="limit" value="500" />
                <input type="hidden" name="includeClassified" value="true" />
                <button className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-700 hover:bg-amber-100">复核最近 500 封</button>
              </form>
            </div>
          )}
        </div>
        {emailAutoResult.status && <EmailAutopilotResultBanner result={emailAutoResult} />}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <AttributionMetric label="邮件总量" value={emailAudit.total} detail={`覆盖率 ${formatLocalPercent(emailAudit.classificationCoverage)}`} tone={emailAudit.total > 0 ? 'blue' : 'gray'} />
          <AttributionMetric label="待销售动作" value={emailAudit.actionRequired} detail={`动作率 ${formatLocalPercent(emailAudit.actionRate)}`} tone={emailAudit.actionRequired > 0 ? 'rose' : 'gray'} />
          <AttributionMetric label="线索邮件" value={emailAudit.leads} detail={`线索率 ${formatLocalPercent(emailAudit.leadRate)}`} tone={emailAudit.leads > 0 ? 'emerald' : 'gray'} />
          <AttributionMetric label="未分类" value={emailAudit.unclassified} detail={`${emailAudit.staleUnclassified} 封超过2天`} tone={emailAudit.unclassified > 0 ? 'amber' : 'gray'} />
          <AttributionMetric label="低置信" value={emailAudit.lowConfidence} detail="需人工复核" tone={emailAudit.lowConfidence > 0 ? 'violet' : 'gray'} />
        </div>
        <div className="mt-4 rounded-xl bg-gray-50 px-4 py-3 text-xs font-bold text-gray-600">{emailAudit.recommendation}</div>
        <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs font-bold text-blue-800">
          重跑分类前先用预演接口查看 `changed/migrations/changedSamples`;确认后再执行“复核最近 500 封”。
        </div>
        <GmailReadinessPanel readiness={emailAudit.gmailReadiness} plans={emailAudit.gmailLabelPlan} canManage={canManage} />
        {emailLabelPlanResult.status && <EmailLabelPlanResultBanner result={emailLabelPlanResult} />}
        <section className="mt-4 rounded-xl border border-gray-100 bg-white p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-xs font-black text-gray-500">邮件动作闭环复盘</h3>
              <p className="mt-1 text-[11px] font-bold text-gray-400">复盘邮件转任务后是否完成、是否逾期、是否带来客户商机推进和赢单。</p>
            </div>
            <span className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">近 30 天</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <AttributionMetric label="邮件任务" value={emailActionClosure.totalTasks} detail={`${emailActionClosure.convertedEmailCount} 封已转任务`} tone={emailActionClosure.totalTasks > 0 ? 'blue' : 'gray'} />
            <AttributionMetric label="已完成" value={emailActionClosure.doneTasks} detail={`完成率 ${formatLocalPercent(emailActionClosure.completionRate)}`} tone={emailActionClosure.doneTasks > 0 ? 'emerald' : 'gray'} />
            <AttributionMetric label="当前待办" value={emailActionClosure.openTasks} detail={`${emailActionClosure.overdueTasks} 个逾期`} tone={emailActionClosure.overdueTasks > 0 ? 'rose' : emailActionClosure.openTasks > 0 ? 'amber' : 'emerald'} />
            <AttributionMetric label="噪音清理" value={emailActionClosure.clearedNoiseCount} detail="已清除待动作" tone={emailActionClosure.clearedNoiseCount > 0 ? 'violet' : 'gray'} />
            <AttributionMetric label="后续推进" value={emailActionClosure.downstreamOutcomes} detail={`有效率 ${formatLocalPercent(emailActionClosure.downstreamRate)}`} tone={emailActionClosure.downstreamOutcomes > 0 ? 'blue' : 'gray'} />
            <AttributionMetric label="赢单收入" value={`$${Math.round(emailActionClosure.wonRevenue).toLocaleString()}`} detail={`${emailActionClosure.wonDeals} 个赢单`} tone={emailActionClosure.wonRevenue > 0 ? 'emerald' : 'gray'} />
          </div>
          <div className="mt-4 rounded-xl bg-gray-50 px-4 py-3 text-xs font-bold text-gray-600">{emailActionClosure.recommendation}</div>
          <div className="mt-4 grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-xl border border-gray-100 p-4">
              <h4 className="text-xs font-black text-gray-500">按邮件类型</h4>
              <div className="mt-3 space-y-3">
                {emailActionClosure.byCategory.map((row) => (
                  <AttributionBar key={row.category} label={row.categoryLabel} value={row.totalTasks} max={emailActionClosure.maxCategoryTasks} detail={`${row.doneTasks} 完成 · ${row.downstreamOutcomes} 推进 · $${Math.round(row.wonRevenue).toLocaleString()}`} />
                ))}
                {emailActionClosure.byCategory.length === 0 && <div className="rounded-lg bg-gray-50 p-3 text-xs font-bold text-gray-400">暂无邮件动作任务。</div>}
              </div>
            </div>
            <div className="rounded-xl border border-gray-100 p-4">
              <h4 className="text-xs font-black text-gray-500">关键样本</h4>
              <div className="mt-3 space-y-2">
                {emailActionClosure.topTasks.map((item) => (
                  <div key={item.id} className="rounded-lg bg-gray-50 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <Link href={`/customers/${item.companyId}`} className="min-w-0 truncate text-xs font-black text-indigo-700 hover:underline">{item.companyName}</Link>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-black ${item.status === 'DONE' ? 'bg-emerald-50 text-emerald-700' : item.isOverdue ? 'bg-rose-50 text-rose-700' : 'bg-white text-gray-600'}`}>{item.statusLabel}</span>
                    </div>
                    <div className="mt-1 truncate text-[11px] font-bold text-gray-500">{item.categoryLabel} · {item.ownerName} · {item.createdAtLabel}</div>
                    <div className="mt-1 truncate text-[11px] font-bold text-gray-400">{item.emailSubject} · {item.emailFrom}</div>
                    <div className="mt-1 text-[11px] font-bold text-gray-400">后续推进 {item.downstreamOutcomes} · 赢单 ${Math.round(item.wonRevenue).toLocaleString()}</div>
                  </div>
                ))}
                {emailActionClosure.topTasks.length === 0 && <div className="rounded-lg bg-gray-50 p-3 text-xs font-bold text-gray-400">暂无可复盘样本。</div>}
              </div>
            </div>
          </div>
        </section>
        <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50 p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-xs font-black text-gray-500">邮件动作清理台</h3>
              <p className="mt-1 text-[11px] font-bold text-gray-400">按 Pipedrive 邮件转活动和 Zendesk 批量处理思路,把需要动作的邮件直接沉淀为销售任务或清理噪音。</p>
            </div>
            <Link href="/tasks?view=week" className="rounded-lg bg-gray-900 px-3 py-2 text-xs font-black text-white hover:bg-gray-800">查看任务</Link>
          </div>
          {emailBulkResult.bulk && <EmailBulkResultBanner result={emailBulkResult} />}
          <div className="grid gap-3 md:grid-cols-3">
            <EmailBulkActionCard
              title="邮件转任务"
              count={emailAudit.taskQueue.length}
              detail="询盘、报价、订单、财务、物流、海关合规、会议、采购、技术和验证码邮件,转成可追责任务。"
              action="create_tasks"
              buttonLabel="生成邮件任务"
              ids={emailAudit.taskQueue.map((msg) => msg.id)}
              tone="blue"
            />
            <EmailBulkActionCard
              title="清理噪音"
              count={emailAudit.noiseQueue.length}
              detail="SEO、营销、平台通知、内部和其他低价值邮件,清除待动作标记。"
              action="clear_noise"
              buttonLabel="清理待动作"
              ids={emailAudit.noiseQueue.map((msg) => msg.id)}
              tone="slate"
            />
            <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
              <div className="text-xs font-black text-amber-700">人工复核</div>
              <div className="mt-2 text-2xl font-black text-amber-900">{emailAudit.reviewQueue.length}</div>
              <div className="mt-2 text-xs font-bold text-amber-700">低置信和未分类邮件先复核关键词,再重跑分类。</div>
              {canManage && (
                <form action={rerunEmailClassification} className="mt-4">
                  <input type="hidden" name="limit" value="500" />
                  <input type="hidden" name="includeClassified" value="true" />
                  <button className="w-full rounded-lg bg-amber-600 px-3 py-2 text-xs font-black text-white hover:bg-amber-700">复核最近 500 封</button>
                </form>
              )}
            </div>
          </div>
          <div className="mt-4 grid gap-3 xl:grid-cols-3">
            <EmailCleanupPreview title="转任务预览" rows={emailAudit.taskQueue} empty="暂无可转任务邮件。" />
            <EmailCleanupPreview title="噪音清理预览" rows={emailAudit.noiseQueue} empty="暂无可清理噪音邮件。" />
            <EmailCleanupPreview title="复核预览" rows={emailAudit.reviewQueue} empty="暂无需复核邮件。" />
          </div>
        </div>
        <div className="mt-4 grid gap-4 xl:grid-cols-[0.9fr_1.1fr_1.1fr]">
          <div className="rounded-xl border border-gray-100 p-4">
            <h3 className="text-xs font-black text-gray-500">分类分布</h3>
            <div className="mt-3 space-y-3">
              {emailAudit.categories.map((row) => (
                <AttributionBar key={row.category} label={row.label} value={row.count} max={emailAudit.maxCategoryCount} detail={`${formatLocalPercent(row.share)} · ${row.category}`} />
              ))}
              {emailAudit.categories.length === 0 && <div className="rounded-lg bg-gray-50 p-3 text-xs font-bold text-gray-400">暂无邮件分类数据。</div>}
            </div>
          </div>
          <div className="rounded-xl border border-gray-100 p-4">
            <h3 className="text-xs font-black text-gray-500">待动作邮件</h3>
            <div className="mt-3 space-y-2">
              {emailAudit.recentActionMessages.map((msg) => (
                <EmailAuditItem key={msg.id} msg={msg} />
              ))}
              {emailAudit.recentActionMessages.length === 0 && <div className="rounded-lg bg-gray-50 p-3 text-xs font-bold text-gray-400">暂无需要动作的邮件。</div>}
            </div>
          </div>
          <div className="rounded-xl border border-gray-100 p-4">
            <h3 className="text-xs font-black text-gray-500">复核队列</h3>
            <div className="mt-3 space-y-2">
              {emailAudit.reviewQueue.map((msg) => (
                <EmailAuditItem key={msg.id} msg={msg} />
              ))}
              {emailAudit.reviewQueue.length === 0 && <div className="rounded-lg bg-gray-50 p-3 text-xs font-bold text-gray-400">暂无未分类或低置信邮件。</div>}
            </div>
          </div>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-gray-100 p-4">
            <h3 className="text-xs font-black text-gray-500">同步邮箱账号</h3>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {emailAudit.accounts.map((account) => (
                <div key={account.id} className="rounded-lg bg-gray-50 px-3 py-2">
                  <div className="truncate text-xs font-black text-gray-900">{account.email}</div>
                  <div className="mt-1 text-[11px] font-bold text-gray-400">{account.isActive ? '启用' : '停用'} · {account.messageCount} 封 · 更新 {account.updatedAtLabel}</div>
                </div>
              ))}
              {emailAudit.accounts.length === 0 && <div className="rounded-lg bg-gray-50 p-3 text-xs font-bold text-gray-400">暂无同步邮箱账号。</div>}
            </div>
          </div>
          <div className="rounded-xl border border-gray-100 p-4">
            <h3 className="text-xs font-black text-gray-500">线索邮箱域名</h3>
            <div className="mt-3 space-y-3">
              {emailAudit.leadDomains.map((item) => (
                <AttributionBar key={item.domain} label={item.domain} value={item.count} max={Math.max(1, ...emailAudit.leadDomains.map((row) => row.count))} detail="近 300 封线索邮件抽样" />
              ))}
              {emailAudit.leadDomains.length === 0 && <div className="rounded-lg bg-gray-50 p-3 text-xs font-bold text-gray-400">暂无可统计的线索域名。</div>}
            </div>
          </div>
        </div>
        <section id="email-security-audit" className="mt-4 rounded-xl border border-gray-100 bg-gray-50 p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-xs font-black text-gray-500">安全邮件审计台</h3>
              <p className="mt-1 text-[11px] font-bold text-gray-400">验证码、可疑登录、账号变更和平台安全提醒单独审计;过期验证码归档,近期安全事件通知管理员。</p>
            </div>
            {canManage && (
              <div className="flex flex-wrap gap-2">
                <form action={runEmailSecurityAction}>
                  <input type="hidden" name="limit" value="50" />
                  <button className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-black text-indigo-700 hover:bg-indigo-100">预演安全归档</button>
                </form>
                <form action={runEmailSecurityAction}>
                  <input type="hidden" name="apply" value="true" />
                  <input type="hidden" name="limit" value="50" />
                  <button className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-black text-rose-700 hover:bg-rose-100">归档过期安全邮件</button>
                </form>
              </div>
            )}
          </div>
          {emailSecurityResult.status && <EmailSecurityResultBanner result={emailSecurityResult} />}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <AttributionMetric label="安全邮件" value={emailSecurity.total} detail="AUTH_SECURITY 分类" tone={emailSecurity.total > 0 ? 'blue' : 'gray'} />
            <AttributionMetric label="待确认" value={emailSecurity.pending} detail={`${emailSecurity.activePending} 封未过期`} tone={emailSecurity.pending > 0 ? 'rose' : 'gray'} />
            <AttributionMetric label="过期待归档" value={emailSecurity.stalePending} detail={`超过 ${emailSecurity.staleHours} 小时`} tone={emailSecurity.stalePending > 0 ? 'amber' : 'gray'} />
            <AttributionMetric label="信号类型" value={emailSecurity.signals.length} detail="验证码/登录/账号等" tone={emailSecurity.signals.length > 0 ? 'violet' : 'gray'} />
          </div>
          <div className="mt-4 rounded-xl bg-white px-4 py-3 text-xs font-bold text-gray-600">{emailSecurity.recommendation}</div>
          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <div className="rounded-xl border border-gray-100 bg-white p-4">
              <h4 className="text-xs font-black text-gray-500">安全信号</h4>
              <div className="mt-3 space-y-3">
                {emailSecurity.signals.map((item: any) => (
                  <AttributionBar key={item.signal} label={item.label} value={item.count} max={Math.max(1, ...emailSecurity.signals.map((row: any) => row.count))} detail={item.signal} />
                ))}
                {emailSecurity.signals.length === 0 && <div className="rounded-lg bg-gray-50 p-3 text-xs font-bold text-gray-400">暂无安全信号。</div>}
              </div>
            </div>
            <div className="rounded-xl border border-gray-100 bg-white p-4">
              <h4 className="text-xs font-black text-gray-500">来源平台</h4>
              <div className="mt-3 space-y-3">
                {emailSecurity.providers.map((item: any) => (
                  <AttributionBar key={item.provider} label={item.provider} value={item.count} max={Math.max(1, ...emailSecurity.providers.map((row: any) => row.count))} detail="近 300 封安全邮件抽样" />
                ))}
                {emailSecurity.providers.length === 0 && <div className="rounded-lg bg-gray-50 p-3 text-xs font-bold text-gray-400">暂无来源平台。</div>}
              </div>
            </div>
            <EmailSecurityPreview title="过期待归档" rows={emailSecurity.staleMessages} empty="暂无过期安全邮件。" />
          </div>
          <div className="mt-4">
            <EmailSecurityPreview title="最近安全邮件" rows={emailSecurity.recentMessages} empty="暂无安全邮件。" />
          </div>
        </section>
      </section>

      <section className="mb-6 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-bold text-gray-900">渠道质量与转化漏斗</h2>
            <p className="mt-1 text-xs text-gray-400">近 90 天按客户来源复盘客户数、商机数、打开商机、赢单、收入、转化率和停滞风险。</p>
          </div>
          <span className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">Lead source ROI</span>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <AttributionMetric label="来源客户" value={channelQuality.customerCount} detail={`${channelQuality.sourceCount} 个来源`} tone={channelQuality.customerCount > 0 ? 'blue' : 'gray'} />
          <AttributionMetric label="客户转商机" value={formatLocalPercent(channelQuality.opportunityRate)} detail={`${channelQuality.companyWithOpportunity} 个客户有商机`} tone={channelQuality.companyWithOpportunity > 0 ? 'amber' : 'gray'} />
          <AttributionMetric label="赢单来源" value={channelQuality.wonDeals} detail={`赢单率 ${formatLocalPercent(channelQuality.winRate)}`} tone={channelQuality.wonDeals > 0 ? 'emerald' : 'gray'} />
          <AttributionMetric label="渠道收入" value={`$${Math.round(channelQuality.revenue).toLocaleString()}`} detail={channelQuality.bestSource ? `最佳 ${channelQuality.bestSource.sourceLabel}` : '等待数据'} tone={channelQuality.revenue > 0 ? 'emerald' : 'gray'} />
          <AttributionMetric label="停滞商机" value={channelQuality.stalledOpenDeals} detail="超过7天未推进" tone={channelQuality.stalledOpenDeals > 0 ? 'rose' : 'gray'} />
        </div>
        <div className="mt-4 rounded-xl bg-gray-50 px-4 py-3 text-xs font-bold text-gray-600">{channelQuality.recommendation}</div>
        <div className="mt-4 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="overflow-hidden rounded-xl border border-gray-100">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs font-black text-gray-500">
                <tr>
                  <th className="p-3">来源</th>
                  <th className="p-3">客户</th>
                  <th className="p-3">商机</th>
                  <th className="p-3">打开</th>
                  <th className="p-3">赢单</th>
                  <th className="p-3">收入</th>
                  <th className="p-3">停滞</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {channelQuality.rows.map((row) => (
                  <tr key={row.source} className="hover:bg-gray-50">
                    <td className="p-3">
                      <div className="font-black text-gray-900">{row.sourceLabel}</div>
                      <div className="mt-0.5 text-[11px] font-bold text-gray-400">转商机 {formatLocalPercent(row.opportunityRate)} · 赢单 {formatLocalPercent(row.winRate)}</div>
                    </td>
                    <td className="p-3 font-bold text-gray-700">{row.customers}</td>
                    <td className="p-3 font-bold text-gray-700">{row.opportunities}</td>
                    <td className="p-3 font-bold text-gray-700">{row.openDeals}</td>
                    <td className="p-3 font-bold text-emerald-700">{row.wonDeals}</td>
                    <td className="p-3 font-bold text-gray-700">${Math.round(row.revenue).toLocaleString()}</td>
                    <td className="p-3 font-bold text-rose-600">{row.stalledOpenDeals}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {channelQuality.rows.length === 0 && <div className="p-10 text-center text-sm font-bold text-gray-400">近 90 天暂无来源客户。</div>}
          </div>
          <div className="rounded-xl border border-gray-100 p-4">
            <h3 className="text-xs font-black text-gray-500">来源收入排行</h3>
            <div className="mt-3 space-y-3">
              {channelQuality.rows.map((row) => (
                <AttributionBar key={row.source} label={row.sourceLabel} value={row.revenue} max={channelQuality.maxRevenue} detail={`${row.customers} 客户 · ${row.wonDeals} 赢单 · 均单 $${Math.round(row.avgWonRevenue).toLocaleString()}`} />
              ))}
              {channelQuality.rows.length === 0 && <div className="rounded-lg bg-gray-50 p-3 text-xs font-bold text-gray-400">暂无可排行来源。</div>}
            </div>
          </div>
        </div>
      </section>

      <section className="mb-6 bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-gray-900">智能销售雷达</h2>
            <p className="text-xs text-gray-400 mt-1">综合客户阶段、邮件往来、商机停留、负责人和下一步动作,自动挑出最该处理的客户</p>
          </div>
          <span className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">Top {salesRadarItems.length}</span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {salesRadarItems.map(({ company, radar }) => (
            <RadarCard
              key={company.id}
              href={`/customers/${company.id}`}
              name={company.name}
              owner={company.owner?.name || company.owner?.email || '未分配'}
              score={radar.score}
              level={radar.level}
              levelLabel={radar.levelLabel}
              title={radar.title}
              action={radar.recommendedAction}
              reasons={radar.reasons}
              companyId={company.id}
              ownerId={company.ownerId || ''}
              dueHours={radar.level === 'hot' || radar.level === 'risk' || radar.metrics.awaitingReply ? 24 : 72}
              priority={radar.level === 'hot' || radar.level === 'risk' ? 'URGENT' : radar.level === 'warm' ? 'HIGH' : 'NORMAL'}
            />
          ))}
          {salesRadarItems.length === 0 && <div className="text-sm text-gray-400">暂无可分析客户。</div>}
        </div>
      </section>

      <section className="mb-6 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-900">销售任务闭环</h2>
          <p className="text-xs text-gray-400 mt-1">雷达建议生成任务后,销售在这里按截止时间处理并完成闭环</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 text-sm text-gray-500 border-b border-gray-100">
                <th className="p-4 font-bold">任务</th>
                <th className="p-4 font-bold">客户</th>
                <th className="p-4 font-bold">负责人</th>
                <th className="p-4 font-bold">优先级</th>
                <th className="p-4 font-bold">截止</th>
                <th className="p-4 font-bold">动作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {salesTasks.map((task) => (
                <tr key={task.id} className="hover:bg-gray-50">
                  <td className="p-4">
                    <div className="font-bold text-gray-900">{task.title}</div>
                    <div className="mt-1 max-w-[420px] truncate text-xs text-gray-400">{task.description || '-'}</div>
                  </td>
                  <td className="p-4">
                    <Link href={`/customers/${task.companyId}`} className="text-sm font-bold text-indigo-600 hover:underline">{task.company.name}</Link>
                    {task.opportunity && <div className="text-xs text-gray-400">{task.opportunity.title}</div>}
                  </td>
                  <td className="p-4 text-sm text-gray-600">{task.owner.name || task.owner.email}</td>
                  <td className="p-4"><TaskPriority priority={task.priority} /></td>
                  <td className="p-4 text-sm text-gray-600">{task.dueAt ? new Date(task.dueAt).toLocaleString('zh-CN') : '-'}</td>
                  <td className="p-4">
                    <form action={completeSalesTask}>
                      <input type="hidden" name="id" value={task.id} />
                      <button className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100">完成</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {salesTasks.length === 0 && <div className="p-10 text-center text-sm text-gray-400">暂无销售任务。可从智能销售雷达一键生成。</div>}
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-6">
        <section className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h2 className="font-bold text-gray-900">今日作战队列</h2>
              <p className="text-xs text-gray-400 mt-1">按优先级和最近更新时间排序,销售先处理这里</p>
            </div>
            {canManage && (
              <form action={executeAssignmentRules}>
                <button className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-500">执行分配规则</button>
              </form>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 text-sm text-gray-500 border-b border-gray-100">
                  <th className="p-4 font-bold">客户</th>
                  <th className="p-4 font-bold">阶段</th>
                  <th className="p-4 font-bold">优先级</th>
                  <th className="p-4 font-bold">负责人</th>
                  <th className="p-4 font-bold">动作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {topQueue.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="p-4">
                      <Link href={`/customers/${c.id}`} className="font-bold text-gray-900 hover:text-indigo-600">{c.name}</Link>
                      <div className="text-xs text-gray-400">{c.contacts[0]?.email || c.country || c.source || '-'}</div>
                    </td>
                    <td className="p-4 text-sm text-gray-600">{TYPE_LABEL[c.type] || c.type}</td>
                    <td className="p-4">
                      <span className="rounded-lg bg-amber-50 px-2 py-1 text-sm font-bold text-amber-700">{c.priorityScore || 0}/100</span>
                    </td>
                    <td className="p-4 text-sm text-gray-600">{c.owner?.name || c.owner?.email || '未分配'}</td>
                    <td className="p-4 text-sm">
                      <div className="max-w-[280px] truncate text-gray-700">{c.nextAction || '补充下一步动作'}</div>
                      <div className="mt-1 text-xs text-gray-400">{c._count.inboxMessages} 条消息 · {c._count.opportunities} 个商机</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-6">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="font-bold text-gray-900 mb-4">团队客户负载</h2>
            <div className="space-y-3">
              {ownerRows.map((row) => {
                const user = row.ownerId ? usersById.get(row.ownerId) : null;
                return (
                  <LoadBar key={row.ownerId || 'unassigned'} label={user?.name || user?.email || '未分配'} value={row._count._all} max={Math.max(1, ...ownerRows.map((r) => r._count._all))} />
                );
              })}
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="font-bold text-gray-900 mb-4">线索来源</h2>
            <div className="space-y-3">
              {sourceRows.map((row) => (
                <LoadBar key={row.source} label={row.source || '未知来源'} value={row._count._all} max={Math.max(1, ...sourceRows.map((r) => r._count._all))} />
              ))}
            </div>
          </div>
        </section>
      </div>

      <section id="opportunity-stale-table" className="mt-6 grid grid-cols-1 xl:grid-cols-[1fr_0.8fr] gap-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="font-bold text-gray-900">阶段停留超期商机</h2>
            <p className="text-xs text-gray-400 mt-1">超过 7 天未推进的进行中商机,优先复盘或升级处理</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 text-sm text-gray-500 border-b border-gray-100">
                  <th className="p-4 font-bold">商机</th>
                  <th className="p-4 font-bold">阶段</th>
                  <th className="p-4 font-bold">停留</th>
                  <th className="p-4 font-bold">金额</th>
                  <th className="p-4 font-bold">负责人</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {staleOpportunities.map((opp) => {
                  const days = Math.max(0, Math.floor((Date.now() - new Date(opp.stageChangedAt || opp.updatedAt).getTime()) / 86400000));
                  return (
                    <tr key={opp.id} className="hover:bg-gray-50">
                      <td className="p-4">
                        <Link href={`/opportunity/${opp.id}`} className="font-bold text-gray-900 hover:text-indigo-600">{opp.title}</Link>
                        <div className="text-xs text-gray-400">{opp.company?.name || '未关联客户'}</div>
                      </td>
                      <td className="p-4 text-sm text-gray-600">{STAGE_LABEL[opp.stage] || opp.stage}</td>
                      <td className="p-4"><span className="rounded-lg bg-rose-50 px-2 py-1 text-sm font-bold text-rose-700">{days} 天</span></td>
                      <td className="p-4 text-sm font-bold text-gray-700">${(opp.amountUSD || 0).toLocaleString()}</td>
                      <td className="p-4 text-sm text-gray-600">{opp.owner?.name || opp.owner?.email || '未分配'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {staleOpportunities.length === 0 && <div className="p-10 text-center text-sm text-gray-400">暂无阶段超期商机。</div>}
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h2 className="font-bold text-gray-900 mb-4">丢单原因复盘</h2>
          <div className="space-y-3">
            {lostReasonRows.map((row) => (
              <LoadBar
                key={row.lostReason || 'empty'}
                label={LOST_REASON_LABEL[row.lostReason || '未填写原因'] || row.lostReason || '未填写原因'}
                value={row._count._all}
                max={Math.max(1, ...lostReasonRows.map((r) => r._count._all))}
              />
            ))}
            {lostReasonRows.length === 0 && <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center text-sm text-gray-400">暂无丢单复盘数据。</div>}
          </div>
        </div>
      </section>

      <section className="mt-6 grid grid-cols-1 xl:grid-cols-[0.9fr_1.1fr] gap-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h2 className="font-bold text-gray-900 mb-4">分配规则</h2>
          <div className="space-y-3">
            {rules.map((rule) => (
              <div key={rule.id} className="rounded-xl border border-gray-100 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-bold text-gray-900">{rule.name}</div>
                    <div className="text-xs text-gray-400 mt-1">优先级 {rule.priority} · {DISTRIBUTION_LABEL[rule.distribution]} · 最低分 {rule.minPriorityScore}</div>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-xs font-bold ${rule.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{rule.isActive ? '启用' : '暂停'}</span>
                </div>
                <div className="mt-3 text-xs text-gray-500">
                  类型:{rule.customerTypes.length ? rule.customerTypes.map((t) => TYPE_LABEL[t] || t).join('、') : '不限'} · 国家:{rule.countries.join('、') || '不限'} · 来源:{rule.sources.join('、') || '不限'}
                </div>
                <div className="mt-1 text-xs text-gray-500">业务员:{rule.ownerIds.map((id) => usersById.get(id)?.name || usersById.get(id)?.email || id).join('、')}</div>
                {canManage && (
                  <div className="mt-3 flex gap-2">
                    <form action={toggleRule}>
                      <input type="hidden" name="id" value={rule.id} />
                      <input type="hidden" name="isActive" value={String(rule.isActive)} />
                      <button className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-50">{rule.isActive ? '暂停' : '启用'}</button>
                    </form>
                    <form action={deleteRule}>
                      <input type="hidden" name="id" value={rule.id} />
                      <button className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50">删除</button>
                    </form>
                  </div>
                )}
              </div>
            ))}
            {rules.length === 0 && <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center text-sm text-gray-400">暂无规则,先创建一条分配规则。</div>}
          </div>
        </div>

        {canManage && (
          <form action={createRule} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="font-bold text-gray-900 mb-4">新建分配规则</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="规则名称"><input required name="name" placeholder="如: 高优先级询盘轮流分配" className="field" /></Field>
              <Field label="优先级(数字越小越先匹配)"><input name="priority" type="number" defaultValue={100} className="field" /></Field>
              <Field label="最低优先级评分"><input name="minPriorityScore" type="number" min={0} max={100} defaultValue={0} className="field" /></Field>
              <Field label="分配方式">
                <select name="distribution" defaultValue="ROUND_ROBIN" className="field bg-white">
                  <option value="ROUND_ROBIN">轮流分配</option>
                  <option value="LOWEST_LOAD">优先分给客户少的人</option>
                  <option value="FIXED_OWNER">固定分给第一个业务员</option>
                </select>
              </Field>
              <Field label="国家关键词(逗号分隔)"><input name="countries" placeholder="United States, UAE, Germany" className="field" /></Field>
              <Field label="来源关键词(逗号分隔)"><input name="sources" placeholder="EMAIL, GMAIL_INBOX, ALIBABA" className="field" /></Field>
              <div className="md:col-span-2">
                <Field label="说明"><textarea name="description" rows={2} className="field" placeholder="规则用途和特殊注意事项" /></Field>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-5">
              <CheckboxGroup title="匹配客户类型" name="customerTypes" options={CUSTOMER_TYPES} defaultValues={['INQUIRY', 'PROSPECT', 'NEW']} />
              <CheckboxGroup title="分配给业务员" name="ownerIds" options={users.map((u) => [u.id, u.name || u.email])} defaultValues={users[0] ? [users[0].id] : []} />
            </div>
            <button className="mt-5 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-500">保存规则</button>
          </form>
        )}
      </section>

      <section className="mt-6 bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-bold text-gray-900 mb-4">最近分配执行记录</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {recentRuns.map((run) => (
            <div key={run.id} className="rounded-xl border border-gray-100 p-4">
              <div className="font-bold text-gray-900">{run.rule.name}</div>
              <div className="mt-1 text-xs text-gray-400">{new Date(run.createdAt).toLocaleString('zh-CN')}</div>
              <div className="mt-3 flex gap-2 text-xs">
                <span className="rounded bg-gray-100 px-2 py-1 text-gray-600">扫描 {run.scannedCount}</span>
                <span className="rounded bg-emerald-50 px-2 py-1 font-bold text-emerald-700">分配 {run.assignedCount}</span>
              </div>
            </div>
          ))}
          {recentRuns.length === 0 && <div className="text-sm text-gray-400">暂无执行记录。</div>}
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  const color: Record<string, string> = {
    blue: 'border-l-blue-500 text-blue-700',
    rose: 'border-l-rose-500 text-rose-700',
    amber: 'border-l-amber-500 text-amber-700',
    violet: 'border-l-violet-500 text-violet-700',
    emerald: 'border-l-emerald-500 text-emerald-700',
  };
  return (
    <div className={`rounded-xl border border-gray-100 border-l-4 bg-white p-4 shadow-sm ${color[tone]}`}>
      <div className="text-xs font-bold text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-black">{value}</div>
    </div>
  );
}

function MorningBriefingPanel({
  briefing,
  result,
}: {
  briefing: ReturnType<typeof buildSalesMorningBriefing>;
  result: { status?: string; notified?: string; skipped?: string };
}) {
  return (
    <section id="morning-briefing" className="mb-6 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-bold text-gray-900">老板晨会摘要</h2>
          <p className="mt-1 text-xs text-gray-400">把作战清单压缩成今天晨会要盯的人、事、金额和动作。</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-black">
          <span className="rounded-lg bg-rose-50 px-3 py-2 text-rose-700">高危 {briefing.urgentCount}</span>
          <span className="rounded-lg bg-slate-100 px-3 py-2 text-slate-700">负责人 {briefing.ownerCount}</span>
          <span className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-700">影响 ${Math.round(briefing.revenueAtRisk).toLocaleString()}</span>
        </div>
      </div>
      <div className="rounded-xl bg-gray-900 px-4 py-3 text-sm font-black text-white">{briefing.headline}</div>
      {result.status && <MorningNotifyResultBanner result={result} />}
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <div className="rounded-xl border border-rose-100 bg-rose-50 p-4 text-rose-900">
          <div className="text-xs font-black opacity-60">今天先盯负责人</div>
          <div className="mt-2 text-xs font-bold leading-6">{briefing.ownerSummary}</div>
        </div>
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-blue-900">
          <div className="text-xs font-black opacity-60">前三个必须动作</div>
          <div className="mt-2 text-xs font-bold leading-6">{briefing.actionSummary}</div>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4 text-emerald-900">
          <div className="text-xs font-black opacity-60">晨会打法</div>
          <div className="mt-2 space-y-1 text-xs font-bold leading-5">
            {briefing.playbook.slice(0, 3).map((line) => <div key={line}>{line}</div>)}
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <form action="/api/sales-command/priority-action" method="post">
          <input type="hidden" name="itemIds" value={briefing.topItemIds.join(',')} />
          <button
            disabled={briefing.topItemIds.length === 0}
            className="rounded-lg bg-gray-900 px-3 py-2 text-xs font-black text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            处理晨会前三项
          </button>
        </form>
        <form action="/api/sales-command/morning-briefing" method="post">
          <input type="hidden" name="itemIds" value={briefing.topItemIds.join(',')} />
          <button
            disabled={briefing.topItemIds.length === 0}
            className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-black text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            通知前三项负责人
          </button>
        </form>
        <form action="/api/sales-command/priority-action" method="post">
          <input type="hidden" name="itemIds" value={briefing.urgentItemIds.join(',')} />
          <button
            disabled={briefing.urgentItemIds.length === 0}
            className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-black text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:border-gray-100 disabled:bg-gray-100 disabled:text-gray-400"
          >
            一键处理全部高危
          </button>
        </form>
        <form action="/api/sales-command/morning-briefing" method="post">
          <input type="hidden" name="itemIds" value={briefing.urgentItemIds.join(',')} />
          <button
            disabled={briefing.urgentItemIds.length === 0}
            className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:border-gray-100 disabled:bg-gray-100 disabled:text-gray-400"
          >
            通知全部高危负责人
          </button>
        </form>
      </div>
      <div className="mt-4 grid gap-3 xl:grid-cols-3">
        {briefing.watchOwners.map((owner) => (
          <div key={owner.ownerName} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-black text-gray-900">{owner.ownerName}</div>
                <div className="mt-1 text-[11px] font-bold text-gray-500">{owner.urgentCount} 高危 · 影响 ${Math.round(owner.impactUSD).toLocaleString()}</div>
              </div>
              <form action="/api/sales-command/priority-action" method="post" className="shrink-0">
                <input type="hidden" name="itemIds" value={(owner.urgentItemIds.length > 0 ? owner.urgentItemIds : owner.itemIds).join(',')} />
                <button className="rounded-lg bg-white px-3 py-2 text-[11px] font-black text-gray-700 hover:bg-gray-100">处理</button>
              </form>
            </div>
            <div className="mt-3 rounded-lg bg-white px-3 py-2 text-[11px] font-bold text-gray-600">
              <div className="opacity-50">当前最急</div>
              <div className="mt-0.5 truncate text-gray-900">{owner.topTitle}</div>
              <div className="mt-0.5 truncate">{owner.topReason}</div>
            </div>
            <div className="mt-2 text-[11px] font-bold leading-5 text-gray-600">{owner.nextAction}</div>
          </div>
        ))}
        {briefing.watchOwners.length === 0 && <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4 text-sm font-bold text-emerald-700">今日暂无负责人需要晨会点名。</div>}
      </div>
    </section>
  );
}

function MorningNotifyResultBanner({ result }: { result: { status?: string; notified?: string; skipped?: string } }) {
  const label = result.status === 'sent' ? '晨会摘要已通知' : result.status === 'empty' ? '晨会摘要无可通知对象' : result.status === 'invalid' ? '晨会摘要通知失败' : '晨会摘要通知已处理';
  return (
    <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs font-bold text-blue-700">
      {label}: 通知 {result.notified || 0} 人{result.skipped ? `,跳过 ${result.skipped}` : ''}
    </div>
  );
}

function MorningClosurePanel({ report }: { report: ReturnType<typeof buildMorningBriefingClosureReport> }) {
  return (
    <section className="mb-6 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-bold text-gray-900">晨会通知处理闭环</h2>
          <p className="mt-1 text-xs text-gray-400">近 7 天晨会摘要是否送到、是否已读、是否重复积压,用于追人和追结果。</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-black">
          <span className="rounded-lg bg-slate-100 px-3 py-2 text-slate-700">已发 {report.total}</span>
          <span className="rounded-lg bg-rose-50 px-3 py-2 text-rose-700">未读 {report.unread}</span>
          <span className="rounded-lg bg-amber-50 px-3 py-2 text-amber-700">超过24h未读 {report.staleUnread}</span>
          <span className="rounded-lg bg-blue-50 px-3 py-2 text-blue-700">已读率 {report.readRate === null ? '-' : `${Math.round(report.readRate * 100)}%`}</span>
        </div>
      </div>
      <div className="mb-4 rounded-xl bg-gray-50 px-4 py-3 text-xs font-bold text-gray-600">{report.recommendation}</div>
      <div className="grid gap-3 xl:grid-cols-3">
        {report.ownerRows.map((row) => (
          <div key={row.ownerEmail} className={`rounded-xl border p-4 ${row.staleUnread > 0 ? 'border-rose-100 bg-rose-50 text-rose-900' : row.unread > 0 ? 'border-amber-100 bg-amber-50 text-amber-900' : 'border-emerald-100 bg-emerald-50 text-emerald-900'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-black">{row.ownerName}</div>
                <div className="mt-1 truncate text-[11px] font-bold opacity-70">{row.ownerEmail}</div>
              </div>
              <div className="shrink-0 rounded-lg bg-white/75 px-2 py-1 text-[11px] font-black">{row.lastStatusLabel}</div>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2 text-center text-[11px] font-black">
              <div className="rounded-lg bg-white/75 px-2 py-2"><div className="text-sm">{row.sent}</div><div className="opacity-50">收到</div></div>
              <div className="rounded-lg bg-white/75 px-2 py-2"><div className="text-sm">{row.read}</div><div className="opacity-50">已读</div></div>
              <div className="rounded-lg bg-white/75 px-2 py-2"><div className="text-sm">{row.unread}</div><div className="opacity-50">未读</div></div>
              <div className="rounded-lg bg-white/75 px-2 py-2"><div className="text-sm">{row.repeatedLines}</div><div className="opacity-50">重复</div></div>
            </div>
            <div className="mt-3 rounded-lg bg-white/75 px-3 py-2 text-[11px] font-bold">
              <div className="opacity-50">最近事项</div>
              <div className="mt-0.5 truncate">{row.topLine}</div>
              <div className="mt-0.5 opacity-70">事项 {row.lineCount} · 最近 {new Date(row.lastNotifiedAt).toLocaleString('zh-CN')}</div>
            </div>
          </div>
        ))}
        {report.ownerRows.length === 0 && <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 text-sm font-bold text-slate-500">近 7 天暂无晨会摘要通知记录。</div>}
      </div>
    </section>
  );
}

function ActionClosurePanel({ report }: { report: ReturnType<typeof buildSalesActionClosureReport> }) {
  const conversion = report.conversionRate === null ? '-' : `${Math.round(report.conversionRate * 100)}%`;
  const completion = report.completionRate === null ? '-' : `${Math.round(report.completionRate * 100)}%`;
  return (
    <section id="action-closure" className="mb-6 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-bold text-gray-900">作战清单执行闭环</h2>
          <p className="mt-1 text-xs text-gray-400">把晨会事项从提醒推进到任务、截止时间、完成结果,避免只读不做。</p>
        </div>
        <Link href="/tasks?view=week" className="rounded-lg bg-gray-900 px-3 py-2 text-xs font-black text-white hover:bg-gray-800">查看任务队列</Link>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-2 text-xs font-black md:grid-cols-6">
        <div className="rounded-lg bg-slate-100 px-3 py-2 text-slate-700"><div className="text-lg">{report.totalItems}</div><div>清单事项</div></div>
        <div className="rounded-lg bg-blue-50 px-3 py-2 text-blue-700"><div className="text-lg">{conversion}</div><div>转任务率</div></div>
        <div className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-700"><div className="text-lg">{completion}</div><div>完成率</div></div>
        <div className="rounded-lg bg-rose-50 px-3 py-2 text-rose-700"><div className="text-lg">{report.overdueTasks}</div><div>逾期未完成</div></div>
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-amber-700"><div className="text-lg">{report.missingTasks}</div><div>未转任务</div></div>
        <div className="rounded-lg bg-violet-50 px-3 py-2 text-violet-700"><div className="text-lg">{report.recentPriorityTasks}</div><div>7天追踪任务</div></div>
      </div>
      <div className="mb-4 rounded-xl bg-gray-50 px-4 py-3 text-xs font-bold text-gray-600">{report.recommendation}</div>
      <div className="grid gap-3 xl:grid-cols-3">
        {report.rows.map((row) => (
          <div key={row.itemId} className={`rounded-xl border p-4 ${row.tone === 'rose' ? 'border-rose-100 bg-rose-50 text-rose-900' : row.tone === 'amber' ? 'border-amber-100 bg-amber-50 text-amber-900' : row.tone === 'emerald' ? 'border-emerald-100 bg-emerald-50 text-emerald-900' : 'border-blue-100 bg-blue-50 text-blue-900'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-black">{row.title}</div>
                <div className="mt-1 truncate text-[11px] font-bold opacity-70">{row.kindLabel} · {row.ownerName}</div>
              </div>
              <div className="shrink-0 rounded-lg bg-white/75 px-2 py-1 text-[11px] font-black">{row.statusLabel}</div>
            </div>
            <div className="mt-3 rounded-lg bg-white/75 px-3 py-2 text-[11px] font-bold">
              <div className="opacity-50">执行任务</div>
              <div className="mt-0.5 truncate">{row.taskTitle}</div>
              <div className="mt-0.5 opacity-70">
                {row.dueAt ? `截止 ${new Date(row.dueAt).toLocaleString('zh-CN')}` : '暂无截止时间'}
                {row.completedAt ? ` · 完成 ${new Date(row.completedAt).toLocaleString('zh-CN')}` : ''}
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 text-[11px] font-black">
              <span className="rounded-lg bg-white/75 px-2 py-1">影响 ${Math.round(row.impactUSD).toLocaleString()}</span>
              <Link href={row.href} className="rounded-lg bg-white px-2 py-1 hover:bg-gray-50">打开客户</Link>
            </div>
          </div>
        ))}
        {report.rows.length === 0 && <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 text-sm font-bold text-slate-500">暂无需要追踪的作战清单事项。</div>}
      </div>
    </section>
  );
}

function CompletionEvidencePanel({
  report,
  result,
}: {
  report: ReturnType<typeof buildSalesCompletionEvidenceReport>;
  result: { status?: string; created?: string; skipped?: string };
}) {
  const evidenceRate = report.evidenceRate === null ? '-' : `${Math.round(report.evidenceRate * 100)}%`;
  const strongRate = report.strongEvidenceRate === null ? '-' : `${Math.round(report.strongEvidenceRate * 100)}%`;
  const repairTaskIds = report.rows.filter((row) => row.statusLabel !== '有业务结果').map((row) => row.taskId);
  return (
    <section id="completion-evidence" className="mb-6 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-bold text-gray-900">任务完成证据链</h2>
          <p className="mt-1 text-xs text-gray-400">检查销售任务点完成后,是否沉淀跟进记录、出站消息或商机阶段推进。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <form action="/api/sales-command/completion-evidence" method="post">
            <input type="hidden" name="taskIds" value={repairTaskIds.join(',')} />
            <button disabled={repairTaskIds.length === 0} className="rounded-lg bg-gray-900 px-3 py-2 text-xs font-black text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-300">批量补证据</button>
          </form>
          <Link href="/tasks?view=done" className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-200">查看已完成任务</Link>
        </div>
      </div>
      <CompletionEvidenceResultBanner result={result} />
      <div className="mb-4 grid grid-cols-2 gap-2 text-xs font-black md:grid-cols-6">
        <div className="rounded-lg bg-slate-100 px-3 py-2 text-slate-700"><div className="text-lg">{report.completedTasks}</div><div>完成任务</div></div>
        <div className="rounded-lg bg-blue-50 px-3 py-2 text-blue-700"><div className="text-lg">{evidenceRate}</div><div>有证据率</div></div>
        <div className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-700"><div className="text-lg">{strongRate}</div><div>强证据率</div></div>
        <div className="rounded-lg bg-rose-50 px-3 py-2 text-rose-700"><div className="text-lg">{report.missingEvidence}</div><div>缺完成证据</div></div>
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-amber-700"><div className="text-lg">{report.weakEvidence}</div><div>仅有记录</div></div>
        <div className="rounded-lg bg-violet-50 px-3 py-2 text-violet-700"><div className="text-lg">{report.onTimeDone}</div><div>按时完成</div></div>
      </div>
      <div className="mb-4 rounded-xl bg-gray-50 px-4 py-3 text-xs font-bold text-gray-600">{report.recommendation}</div>
      <div className="grid gap-3 xl:grid-cols-3">
        {report.rows.map((row) => (
          <div key={row.taskId} className={`rounded-xl border p-4 ${row.tone === 'rose' ? 'border-rose-100 bg-rose-50 text-rose-900' : row.tone === 'amber' ? 'border-amber-100 bg-amber-50 text-amber-900' : 'border-emerald-100 bg-emerald-50 text-emerald-900'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-black">{row.companyName}</div>
                <div className="mt-1 truncate text-[11px] font-bold opacity-70">{row.ownerName} · {row.taskTitle}</div>
              </div>
              <div className="shrink-0 rounded-lg bg-white/75 px-2 py-1 text-[11px] font-black">{row.statusLabel}</div>
            </div>
            <div className="mt-3 rounded-lg bg-white/75 px-3 py-2 text-[11px] font-bold">
              <div className="opacity-50">最强证据</div>
              <div className="mt-0.5 leading-5">{row.strongestEvidence}</div>
              <div className="mt-0.5 opacity-70">跟进 {row.followUpCount} · 出站 {row.outboundCount} · 商机推进 {row.stageChangeCount}</div>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 text-[11px] font-black">
              <span className="rounded-lg bg-white/75 px-2 py-1">完成 {new Date(row.completedAt).toLocaleString('zh-CN')}</span>
              <div className="flex gap-2">
                {row.statusLabel !== '有业务结果' && (
                  <form action="/api/sales-command/completion-evidence" method="post">
                    <input type="hidden" name="taskIds" value={row.taskId} />
                    <button className="rounded-lg bg-white px-2 py-1 hover:bg-gray-50">补证据</button>
                  </form>
                )}
                <Link href={row.href} className="rounded-lg bg-white px-2 py-1 hover:bg-gray-50">打开客户</Link>
              </div>
            </div>
          </div>
        ))}
        {report.rows.length === 0 && <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 text-sm font-bold text-slate-500">近 30 天暂无可审计的已完成销售任务。</div>}
      </div>
    </section>
  );
}

function CompletionEvidenceResultBanner({ result }: { result: { status?: string; created?: string; skipped?: string } }) {
  if (!result.status) return null;
  const created = Number(result.created || 0);
  const skipped = Number(result.skipped || 0);
  const text = result.status === 'created'
    ? `已生成 ${created} 个补完成证据任务${skipped ? `,跳过 ${skipped} 个已有/无权限项` : ''}。`
    : result.status === 'duplicate'
    ? `没有新建任务,${skipped || 0} 个事项已存在补证据任务或无权限。`
    : '未选择需要补证据的任务。';
  return <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs font-bold text-blue-700">{text}</div>;
}

function CompletionEvidenceEscalationPanel({ report }: { report: ReturnType<typeof buildCompletionEvidenceEscalationReport> }) {
  return (
    <section id="completion-evidence-escalation" className="mb-6 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-bold text-gray-900">补证据升级审计</h2>
          <p className="mt-1 text-xs text-gray-400">追踪补证据任务是否按时处理,以及哪些负责人和客户反复进入升级队列。</p>
        </div>
        <Link href="/tasks?view=escalated" className="rounded-lg bg-gray-900 px-3 py-2 text-xs font-black text-white hover:bg-gray-800">查看升级任务</Link>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-2 text-xs font-black md:grid-cols-6">
        <div className="rounded-lg bg-slate-100 px-3 py-2 text-slate-700"><div className="text-lg">{report.totalRepairTasks}</div><div>补证据任务</div></div>
        <div className="rounded-lg bg-blue-50 px-3 py-2 text-blue-700"><div className="text-lg">{report.openRepairTasks}</div><div>待处理</div></div>
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-amber-700"><div className="text-lg">{report.overdueOpenTasks}</div><div>已逾期</div></div>
        <div className="rounded-lg bg-rose-50 px-3 py-2 text-rose-700"><div className="text-lg">{report.escalatedOpenTasks}</div><div>已升级</div></div>
        <div className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-700"><div className="text-lg">{formatLocalPercent(report.resolutionRate)}</div><div>补齐率</div></div>
        <div className="rounded-lg bg-violet-50 px-3 py-2 text-violet-700"><div className="text-lg">{report.escalationNotifications}</div><div>升级通知</div></div>
      </div>
      <div className="mb-4 rounded-xl bg-gray-50 px-4 py-3 text-xs font-bold text-gray-600">{report.recommendation}</div>
      <div className="grid gap-4 xl:grid-cols-[0.85fr_0.85fr_1.3fr]">
        <div className="rounded-xl border border-gray-100 p-4">
          <h3 className="text-xs font-black text-gray-500">负责人升级排行</h3>
          <div className="mt-3 space-y-3">
            {report.ownerRows.map((row) => (
              <EscalationGroupBar key={row.key} row={row} max={report.ownerRows[0]?.score || 1} />
            ))}
            {report.ownerRows.length === 0 && <div className="rounded-lg bg-gray-50 p-3 text-xs font-bold text-gray-400">暂无负责人升级数据。</div>}
          </div>
        </div>
        <div className="rounded-xl border border-gray-100 p-4">
          <h3 className="text-xs font-black text-gray-500">客户升级排行</h3>
          <div className="mt-3 space-y-3">
            {report.companyRows.map((row) => (
              <EscalationGroupBar key={row.key} row={row} max={report.companyRows[0]?.score || 1} />
            ))}
            {report.companyRows.length === 0 && <div className="rounded-lg bg-gray-50 p-3 text-xs font-bold text-gray-400">暂无客户升级数据。</div>}
          </div>
        </div>
        <div className="rounded-xl border border-gray-100 p-4">
          <h3 className="text-xs font-black text-gray-500">关键补证据任务</h3>
          <div className="mt-3 space-y-2">
            {report.rows.map((row) => (
              <div key={row.taskId} className={`rounded-lg px-3 py-2 ${row.tone === 'rose' ? 'bg-rose-50 text-rose-900' : row.tone === 'amber' ? 'bg-amber-50 text-amber-900' : row.tone === 'emerald' ? 'bg-emerald-50 text-emerald-900' : 'bg-slate-50 text-slate-800'}`}>
                <div className="flex items-center justify-between gap-2">
                  <Link href={row.href} className="min-w-0 truncate text-xs font-black text-indigo-700 hover:underline">{row.companyName}</Link>
                  <span className="shrink-0 rounded-full bg-white/75 px-2 py-0.5 text-[11px] font-black">{row.statusLabel}</span>
                </div>
                <div className="mt-1 truncate text-[11px] font-bold opacity-75">{row.ownerName} · {row.taskTitle}</div>
                <div className="mt-1 text-[11px] font-bold opacity-60">
                  {row.dueAt ? `逾期 ${row.ageHours}h` : '暂无截止时间'}
                  {row.escalatedAt ? ` · 升级 ${new Date(row.escalatedAt).toLocaleString('zh-CN')}` : ''}
                </div>
              </div>
            ))}
            {report.rows.length === 0 && <div className="rounded-lg bg-gray-50 p-3 text-xs font-bold text-gray-400">暂无补证据任务样本。</div>}
          </div>
        </div>
      </div>
    </section>
  );
}

function EscalationGroupBar({ row, max }: { row: { label: string; score: number; total: number; open: number; overdue: number; escalated: number; resolved: number }; max: number }) {
  const width = `${Math.max(4, Math.round((row.score / Math.max(1, max)) * 100))}%`;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs font-black text-gray-900">{row.label}</span>
        <span className="shrink-0 text-xs font-black text-gray-500">{row.score}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-gray-100">
        <div className="h-full rounded-full bg-rose-500" style={{ width }} />
      </div>
      <div className="mt-1 text-[11px] font-bold text-gray-400">总 {row.total} · 待 {row.open} · 逾期 {row.overdue} · 升级 {row.escalated} · 已补 {row.resolved}</div>
    </div>
  );
}

function DailyPriorityPanel({
  queue,
  result,
}: {
  queue: ReturnType<typeof buildSalesPriorityQueue>;
  result: { status?: string; created?: string; notified?: string; skipped?: string };
}) {
  const topItemIds = queue.items.slice(0, 5).map((item) => item.id);
  const urgentItemIds = queue.items.filter((item) => item.score >= 90).map((item) => item.id);
  return (
    <section id="daily-priority" className="mb-6 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-bold text-gray-900">老板每日作战清单</h2>
          <p className="mt-1 text-xs text-gray-400">合并逾期消息、销售任务、停滞商机、客户健康、自动化风险和邮件动作,按风险与收入影响排序。</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-black">
          <span className="rounded-lg bg-rose-50 px-3 py-2 text-rose-700">高危 {queue.urgentCount}</span>
          <span className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-700">影响 ${Math.round(queue.revenueAtRisk).toLocaleString()}</span>
          <span className="rounded-lg bg-slate-100 px-3 py-2 text-slate-700">候选 {queue.totalCandidates}</span>
        </div>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <form action="/api/sales-command/priority-action" method="post">
          <input type="hidden" name="itemIds" value={topItemIds.join(',')} />
          <button
            disabled={topItemIds.length === 0}
            className="rounded-lg bg-gray-900 px-3 py-2 text-xs font-black text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            批量处理前5
          </button>
        </form>
        <form action="/api/sales-command/priority-action" method="post">
          <input type="hidden" name="itemIds" value={urgentItemIds.join(',')} />
          <button
            disabled={urgentItemIds.length === 0}
            className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-black text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:border-gray-100 disabled:bg-gray-100 disabled:text-gray-400"
          >
            批量处理高危
          </button>
        </form>
      </div>
      <div className="mb-4 rounded-xl bg-gray-50 px-4 py-3 text-xs font-bold text-gray-600">{queue.recommendation}</div>
      <div className="mb-4 flex flex-wrap gap-2">
        {queue.byKind.map((row) => (
          <span key={row.kind} className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-black text-slate-600">{row.label} {row.count}</span>
        ))}
        {queue.byKind.length === 0 && <span className="rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-black text-emerald-700">暂无高优先级事项</span>}
      </div>
      {result.status && <PriorityActionResultBanner result={result} />}
      <div className="grid gap-3 xl:grid-cols-2">
        {queue.items.map((item, index) => (
          <div key={item.id} className={`rounded-xl border p-4 ${priorityToneClass(item.tone)}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-black">#{index + 1}</span>
                  <span className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-black">{item.kindLabel}</span>
                  <span className="text-[11px] font-black opacity-70">负责人 {item.ownerName}</span>
                </div>
                <div className="mt-2 truncate text-sm font-black">{item.title}</div>
                <div className="mt-1 truncate text-xs font-bold opacity-75">{item.subject}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-2xl font-black">{item.score}</div>
                <div className="text-[10px] font-black opacity-60">优先分</div>
              </div>
            </div>
            <div className="mt-3 grid gap-2 text-[11px] font-bold md:grid-cols-3">
              <div className="rounded-lg bg-white/75 px-3 py-2">
                <div className="opacity-50">原因</div>
                <div className="mt-0.5 truncate">{item.reason}</div>
              </div>
              <div className="rounded-lg bg-white/75 px-3 py-2">
                <div className="opacity-50">动作</div>
                <div className="mt-0.5 truncate">{item.action}</div>
              </div>
              <div className="rounded-lg bg-white/75 px-3 py-2">
                <div className="opacity-50">证据</div>
                <div className="mt-0.5 truncate">{item.evidence}</div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <form action="/api/sales-command/priority-action" method="post">
                <input type="hidden" name="itemId" value={item.id} />
                <button className="rounded-lg bg-gray-900 px-3 py-2 text-xs font-black text-white hover:bg-gray-800">
                  {priorityActionLabel(item.kind)}
                </button>
              </form>
              <Link href={item.href} className="rounded-lg bg-white/80 px-3 py-2 text-xs font-black hover:bg-white">打开详情</Link>
            </div>
          </div>
        ))}
        {queue.items.length === 0 && <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4 text-sm font-bold text-emerald-700">今日暂无高优先级风险事项。</div>}
      </div>
    </section>
  );
}

function OwnerPriorityPanel({ report }: { report: ReturnType<typeof buildSalesOwnerPriorityReport> }) {
  return (
    <section className="mb-6 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-bold text-gray-900">负责人每日战报</h2>
          <p className="mt-1 text-xs text-gray-400">按负责人汇总作战清单,看谁高危最多、影响金额最大、今天该先处理什么。</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-black">
          <span className="rounded-lg bg-slate-100 px-3 py-2 text-slate-700">负责人 {report.ownerCount}</span>
          <span className="rounded-lg bg-rose-50 px-3 py-2 text-rose-700">高危负责人 {report.urgentOwnerCount}</span>
          <span className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-700">影响 ${Math.round(report.totalImpactUSD).toLocaleString()}</span>
        </div>
      </div>
      <div className="mb-4 rounded-xl bg-gray-50 px-4 py-3 text-xs font-bold text-gray-600">{report.recommendation}</div>
      <div className="grid gap-3 xl:grid-cols-3">
        {report.rows.map((row) => (
          <div key={row.ownerName} className={`rounded-xl border p-4 ${row.urgentCount > 0 ? 'border-rose-100 bg-rose-50 text-rose-900' : row.impactUSD > 0 ? 'border-emerald-100 bg-emerald-50 text-emerald-900' : 'border-slate-100 bg-slate-50 text-slate-900'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-black">{row.ownerName}</div>
                <div className="mt-1 text-[11px] font-bold opacity-70">{row.itemCount} 个事项 · {row.urgentCount} 个高危</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-xl font-black">{row.maxScore}</div>
                <div className="text-[10px] font-black opacity-60">最高分</div>
              </div>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/75">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(4, Math.round((row.impactUSD / report.maxImpactUSD) * 100))}%` }} />
            </div>
            <div className="mt-2 text-[11px] font-black opacity-70">影响 ${Math.round(row.impactUSD).toLocaleString()}</div>
            <div className="mt-3 rounded-lg bg-white/75 px-3 py-2 text-[11px] font-bold">
              <div className="opacity-50">当前最急</div>
              <div className="mt-0.5 truncate">{row.topKindLabel} · {row.topTitle}</div>
              <div className="mt-0.5 truncate opacity-70">{row.topReason}</div>
            </div>
            <div className="mt-2 rounded-lg bg-white/75 px-3 py-2 text-[11px] font-bold">
              <div className="opacity-50">下一步</div>
              <div className="mt-0.5 line-clamp-2">{row.nextAction}</div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1">
              {row.focusMix.map((mix) => (
                <span key={mix.label} className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-black">{mix.label} {mix.count}</span>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <form action="/api/sales-command/priority-action" method="post">
                <input type="hidden" name="itemIds" value={row.itemIds.join(',')} />
                <button
                  disabled={row.itemIds.length === 0}
                  className="rounded-lg bg-gray-900 px-3 py-2 text-[11px] font-black text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-300"
                >
                  处理此负责人
                </button>
              </form>
              <form action="/api/sales-command/priority-action" method="post">
                <input type="hidden" name="itemIds" value={row.urgentItemIds.join(',')} />
                <button
                  disabled={row.urgentItemIds.length === 0}
                  className="rounded-lg bg-white/80 px-3 py-2 text-[11px] font-black hover:bg-white disabled:cursor-not-allowed disabled:text-gray-400"
                >
                  只处理高危
                </button>
              </form>
            </div>
          </div>
        ))}
        {report.rows.length === 0 && <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4 text-sm font-bold text-emerald-700">暂无负责人风险分布。</div>}
      </div>
    </section>
  );
}

function priorityToneClass(tone: string) {
  const colors: Record<string, string> = {
    rose: 'border-rose-100 bg-rose-50 text-rose-900',
    amber: 'border-amber-100 bg-amber-50 text-amber-900',
    blue: 'border-blue-100 bg-blue-50 text-blue-900',
    violet: 'border-violet-100 bg-violet-50 text-violet-900',
    emerald: 'border-emerald-100 bg-emerald-50 text-emerald-900',
    slate: 'border-slate-100 bg-slate-50 text-slate-900',
  };
  return colors[tone] || colors.slate;
}

function priorityActionLabel(kind: string) {
  if (kind === 'AUTOMATION_RISK') return '修复风险';
  if (kind === 'SALES_TASK' || kind === 'EMAIL_ACTION' || kind === 'HEALTH_TASK') return '提醒负责人';
  return '生成任务';
}

function PriorityActionResultBanner({
  result,
}: {
  result: { status?: string; created?: string; notified?: string; skipped?: string };
}) {
  const labels: Record<string, string> = {
    task: '作战清单任务已生成',
    notify: '作战清单提醒已发送',
    activated: '自动化风险流程已开启',
    tested: '自动化风险流程已生成测试运行',
    replayed: '自动化失败运行已重放处理',
    tuned: '自动化风险流程已写入调参建议',
    notified: '自动化风险已提醒管理员复核',
    stable: '自动化流程当前状态稳定',
    exists: '作战清单任务已存在,已提醒负责人',
    bulk: '作战清单批量动作已执行',
    missing: '事项已不存在或已被清理',
    forbidden: '当前账号无权处理该事项',
    invalid: '事项参数无效',
  };
  const isError = result.status === 'missing' || result.status === 'forbidden' || result.status === 'invalid';
  return (
    <div className={`mb-4 rounded-lg border px-4 py-3 text-xs font-bold ${isError ? 'border-amber-100 bg-amber-50 text-amber-800' : 'border-emerald-100 bg-emerald-50 text-emerald-800'}`}>
      {labels[result.status || ''] || '作战清单动作已执行'}
      <span className="ml-2">生成 {result.created || '0'}</span>
      <span className="ml-2">通知 {result.notified || '0'}</span>
      {result.skipped ? <span className="ml-2 opacity-75">跳过 {result.skipped}</span> : null}
    </div>
  );
}

function NextActionBulkResultBanner({
  result,
}: {
  result: { bulk?: string; created?: string; updated?: string; skipped?: string };
}) {
  const label: Record<string, string> = {
    planned: '下一步任务已生成',
    reactivated: '沉睡激活任务已生成',
    health_repaired: '客户健康修复任务已生成',
    empty: '没有选中可处理客户',
  };
  return (
    <div className="mb-4 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-800">
      {label[result.bulk || ''] || '下一步批量动作已执行'}
      <span className="ml-2">生成 {result.created || '0'}</span>
      <span className="ml-2">更新 {result.updated || '0'}</span>
      {result.skipped ? <span className="ml-2 text-emerald-600">跳过 {result.skipped}</span> : null}
    </div>
  );
}

function NextActionCard({
  title,
  count,
  detail,
  action,
  buttonLabel,
  ids,
  tone,
}: {
  title: string;
  count: number;
  detail: string;
  action: string;
  buttonLabel: string;
  ids: string[];
  tone: 'amber' | 'violet' | 'rose' | 'slate';
}) {
  const color: Record<string, string> = {
    amber: 'border-amber-100 bg-amber-50 text-amber-900',
    violet: 'border-violet-100 bg-violet-50 text-violet-900',
    rose: 'border-rose-100 bg-rose-50 text-rose-900',
    slate: 'border-slate-100 bg-slate-50 text-slate-900',
  };
  const buttonColor: Record<string, string> = {
    amber: 'bg-amber-600 hover:bg-amber-700',
    violet: 'bg-violet-600 hover:bg-violet-700',
    rose: 'bg-rose-600 hover:bg-rose-700',
    slate: 'bg-slate-900 hover:bg-slate-700',
  };
  return (
    <div className={`rounded-xl border p-4 ${color[tone]}`}>
      <div className="text-xs font-black opacity-75">{title}</div>
      <div className="mt-2 text-2xl font-black">{count}</div>
      <div className="mt-2 min-h-[34px] text-xs font-bold opacity-75">{detail}</div>
      <form action="/api/sales-command/next-actions" method="post" className="mt-4">
        <input type="hidden" name="action" value={action} />
        <input type="hidden" name="ids" value={ids.join(',')} />
        <button
          type="submit"
          disabled={ids.length === 0}
          className={`w-full rounded-lg px-3 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:bg-gray-300 ${buttonColor[tone]}`}
        >
          {buttonLabel}
        </button>
      </form>
    </div>
  );
}

function NextActionPreview({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: Array<{ company: any; radar: ReturnType<typeof buildSalesRadar> }>;
  empty: string;
}) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
      <div className="text-xs font-black text-gray-500">{title}</div>
      <div className="mt-3 space-y-2">
        {rows.slice(0, 5).map(({ company, radar }) => (
          <div key={company.id} className="rounded-lg bg-white px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <Link href={`/customers/${company.id}`} className="min-w-0 truncate text-xs font-black text-indigo-700 hover:underline">{company.name}</Link>
              <span className="shrink-0 rounded-full bg-gray-50 px-2 py-0.5 text-[11px] font-black text-gray-600">{radar.score}</span>
            </div>
            <div className="mt-1 truncate text-[11px] font-bold text-gray-500">{company.owner?.name || company.owner?.email || '未分配'} · {radar.levelLabel} · {company.nextAction || '缺下一步'}</div>
            <div className="mt-1 truncate text-[11px] font-medium text-gray-400">{radar.recommendedAction}</div>
          </div>
        ))}
        {rows.length > 5 && <div className="text-[11px] font-bold text-gray-400">另有 {rows.length - 5} 个客户已纳入本次批量队列。</div>}
        {rows.length === 0 && <div className="rounded-lg bg-white p-3 text-xs font-bold text-gray-400">{empty}</div>}
      </div>
    </div>
  );
}

function OpportunityRescueResultBanner({
  result,
}: {
  result: { bulk?: string; created?: string; updated?: string; skipped?: string };
}) {
  const label: Record<string, string> = {
    rescued: '商机救援任务已生成',
    priority: '高风险商机已优先派发',
    empty: '没有选中可救援商机',
  };
  return (
    <div className="mb-4 rounded-lg border border-rose-100 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-800">
      {label[result.bulk || ''] || '商机救援批量动作已执行'}
      <span className="ml-2">生成 {result.created || '0'}</span>
      <span className="ml-2">更新 {result.updated || '0'}</span>
      {result.skipped ? <span className="ml-2 text-rose-600">跳过 {result.skipped}</span> : null}
    </div>
  );
}

function OpportunityRescueCard({
  title,
  count,
  detail,
  action,
  buttonLabel,
  ids,
  tone,
}: {
  title: string;
  count: number;
  detail: string;
  action: string;
  buttonLabel: string;
  ids: string[];
  tone: 'rose' | 'amber';
}) {
  const color: Record<string, string> = {
    rose: 'border-rose-100 bg-rose-50 text-rose-900',
    amber: 'border-amber-100 bg-amber-50 text-amber-900',
  };
  const buttonColor: Record<string, string> = {
    rose: 'bg-rose-600 hover:bg-rose-700',
    amber: 'bg-amber-600 hover:bg-amber-700',
  };
  return (
    <div className={`rounded-xl border p-4 ${color[tone]}`}>
      <div className="text-xs font-black opacity-75">{title}</div>
      <div className="mt-2 text-2xl font-black">{count}</div>
      <div className="mt-2 min-h-[34px] text-xs font-bold opacity-75">{detail}</div>
      <form action="/api/sales-command/opportunity-rescue" method="post" className="mt-4">
        <input type="hidden" name="action" value={action} />
        <input type="hidden" name="ids" value={ids.join(',')} />
        <button
          type="submit"
          disabled={ids.length === 0}
          className={`w-full rounded-lg px-3 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:bg-gray-300 ${buttonColor[tone]}`}
        >
          {buttonLabel}
        </button>
      </form>
    </div>
  );
}

function OpportunityRescuePreview({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: Array<{ opportunity: any; ageDays: number }>;
  empty: string;
}) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
      <div className="text-xs font-black text-gray-500">{title}</div>
      <div className="mt-3 space-y-2">
        {rows.slice(0, 6).map(({ opportunity, ageDays }) => (
          <div key={opportunity.id} className="rounded-lg bg-white px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <Link href={`/opportunity/${opportunity.id}`} className="min-w-0 truncate text-xs font-black text-indigo-700 hover:underline">{opportunity.title}</Link>
              <span className="shrink-0 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-black text-rose-600">{ageDays} 天</span>
            </div>
            <div className="mt-1 truncate text-[11px] font-bold text-gray-500">{opportunity.company?.name || '未关联客户'} · {STAGE_LABEL[opportunity.stage] || opportunity.stage} · ${Math.round(opportunity.amountUSD || 0).toLocaleString()}</div>
            <div className="mt-1 truncate text-[11px] font-medium text-gray-400">{opportunity.owner?.name || opportunity.owner?.email || '未分配'} · {opportunity.nextStep || '缺下一步动作'}</div>
          </div>
        ))}
        {rows.length > 6 && <div className="text-[11px] font-bold text-gray-400">另有 {rows.length - 6} 个商机已纳入本次批量队列。</div>}
        {rows.length === 0 && <div className="rounded-lg bg-white p-3 text-xs font-bold text-gray-400">{empty}</div>}
      </div>
    </div>
  );
}

type ChannelQualityRow = {
  source: string;
  sourceLabel: string;
  customers: number;
  companyWithOpportunity: number;
  opportunities: number;
  openDeals: number;
  wonDeals: number;
  lostDeals: number;
  stalledOpenDeals: number;
  revenue: number;
  avgWonRevenue: number;
  opportunityRate: number | null;
  winRate: number | null;
};

type ChannelQualityReport = {
  rows: ChannelQualityRow[];
  customerCount: number;
  sourceCount: number;
  companyWithOpportunity: number;
  opportunityCount: number;
  opportunityRate: number | null;
  wonDeals: number;
  winRate: number | null;
  revenue: number;
  stalledOpenDeals: number;
  bestSource: ChannelQualityRow | null;
  maxRevenue: number;
  recommendation: string;
};

async function buildChannelQualityReport({ since }: { since: Date }): Promise<ChannelQualityReport> {
  const companies = await prisma.company.findMany({
    where: { createdAt: { gte: since } },
    include: {
      opportunities: {
        select: {
          id: true,
          stage: true,
          amountUSD: true,
          stageChangedAt: true,
          updatedAt: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 1000,
  });
  if (companies.length === 0) return emptyChannelQuality();

  const buckets = new Map<string, ChannelQualityRow>();
  for (const company of companies) {
    const source = normalizeSource(company.source);
    const current = buckets.get(source) || {
      source,
      sourceLabel: sourceLabel(source),
      customers: 0,
      companyWithOpportunity: 0,
      opportunities: 0,
      openDeals: 0,
      wonDeals: 0,
      lostDeals: 0,
      stalledOpenDeals: 0,
      revenue: 0,
      avgWonRevenue: 0,
      opportunityRate: 0,
      winRate: 0,
    };
    current.customers += 1;
    if (company.opportunities.length > 0) current.companyWithOpportunity += 1;
    current.opportunities += company.opportunities.length;
    for (const opp of company.opportunities) {
      if (opp.stage === 'CLOSED_WON') {
        current.wonDeals += 1;
        current.revenue += opp.amountUSD || 0;
      } else if (opp.stage === 'CLOSED_LOST') {
        current.lostDeals += 1;
      } else {
        current.openDeals += 1;
        const stageDate = opp.stageChangedAt || opp.updatedAt;
        if (stageDate && daysBetween(stageDate, new Date()) >= 7) current.stalledOpenDeals += 1;
      }
    }
    current.opportunityRate = current.customers > 0 ? current.companyWithOpportunity / current.customers : null;
    current.winRate = current.opportunities > 0 ? current.wonDeals / current.opportunities : null;
    current.avgWonRevenue = current.wonDeals > 0 ? current.revenue / current.wonDeals : 0;
    buckets.set(source, current);
  }

  const allRows = Array.from(buckets.values());
  const rows = allRows
    .sort((a, b) => b.revenue - a.revenue || b.wonDeals - a.wonDeals || b.opportunities - a.opportunities || b.customers - a.customers)
    .slice(0, 10);
  const customerCount = companies.length;
  const companyWithOpportunity = allRows.reduce((sum, row) => sum + row.companyWithOpportunity, 0);
  const opportunityCount = allRows.reduce((sum, row) => sum + row.opportunities, 0);
  const wonDeals = allRows.reduce((sum, row) => sum + row.wonDeals, 0);
  const revenue = allRows.reduce((sum, row) => sum + row.revenue, 0);
  const stalledOpenDeals = allRows.reduce((sum, row) => sum + row.stalledOpenDeals, 0);
  const bestSource = rows.find((row) => row.revenue > 0) || rows[0] || null;

  return {
    rows,
    customerCount,
    sourceCount: buckets.size,
    companyWithOpportunity,
    opportunityCount,
    opportunityRate: customerCount > 0 ? companyWithOpportunity / customerCount : null,
    wonDeals,
    winRate: opportunityCount > 0 ? wonDeals / opportunityCount : null,
    revenue,
    stalledOpenDeals,
    bestSource,
    maxRevenue: Math.max(1, ...rows.map((row) => row.revenue)),
    recommendation: channelQualityRecommendation({ customerCount, companyWithOpportunity, revenue, stalledOpenDeals, bestSource }),
  };
}

function emptyChannelQuality(): ChannelQualityReport {
  return {
    rows: [],
    customerCount: 0,
    sourceCount: 0,
    companyWithOpportunity: 0,
    opportunityCount: 0,
    opportunityRate: null,
    wonDeals: 0,
    winRate: null,
    revenue: 0,
    stalledOpenDeals: 0,
    bestSource: null,
    maxRevenue: 1,
    recommendation: '近 90 天暂无来源客户。先确保邮箱、阿里、WhatsApp、官网和手工导入都写入客户来源字段。',
  };
}

function channelQualityRecommendation(input: { customerCount: number; companyWithOpportunity: number; revenue: number; stalledOpenDeals: number; bestSource: ChannelQualityRow | null }) {
  if (input.customerCount === 0) return '近 90 天暂无来源客户。先恢复渠道同步,并保证每个客户都有来源字段。';
  if (input.companyWithOpportunity === 0) return `近 90 天有 ${input.customerCount} 个来源客户,但还没有转成商机。优先把询盘/报价邮件转为商机,否则来源质量无法复盘。`;
  if (input.stalledOpenDeals > 0) return `有 ${input.stalledOpenDeals} 个来源商机停滞超过 7 天。先处理停滞渠道,避免来源看似有效但实际不推进。`;
  if (input.revenue > 0) return `当前最佳来源是“${input.bestSource?.sourceLabel || '未知来源'}”,近 90 天贡献 $${Math.round(input.bestSource?.revenue || 0).toLocaleString()}。建议把分配规则和广告/平台投入向高转化来源倾斜。`;
  return `近 90 天已有 ${input.companyWithOpportunity} 个来源客户转成商机,但暂无赢单收入。下一步重点看报价到谈判、谈判到赢单的转化。`;
}

function normalizeSource(source: string | null | undefined) {
  const raw = String(source || 'UNKNOWN').trim().toUpperCase();
  if (!raw) return 'UNKNOWN';
  if (raw.includes('GMAIL')) return 'GMAIL_INBOX';
  if (raw.includes('EMAIL') || raw.includes('MAIL')) return 'EMAIL';
  if (raw.includes('ALIBABA')) return 'ALIBABA';
  if (raw.includes('WHATSAPP')) return 'WHATSAPP';
  if (raw.includes('LINKEDIN')) return 'LINKEDIN';
  if (raw.includes('FACEBOOK')) return 'FACEBOOK';
  if (raw.includes('SHOPEE')) return 'SHOPEE';
  if (raw.includes('AMAZON')) return 'AMAZON';
  if (raw.includes('MANUAL')) return 'MANUAL';
  if (raw.includes('WEB') || raw.includes('SITE')) return 'WEBSITE';
  return raw;
}

function sourceLabel(source: string) {
  const labels: Record<string, string> = {
    EMAIL: '邮件',
    GMAIL_INBOX: 'Gmail 收件箱',
    ALIBABA: '阿里国际站',
    WHATSAPP: 'WhatsApp',
    LINKEDIN: 'LinkedIn',
    FACEBOOK: 'Facebook',
    INSTAGRAM: 'Instagram',
    SHOPEE: 'Shopee',
    AMAZON: 'Amazon',
    SALESMARTLY: 'SaleSmartly',
    MANUAL: '手工录入',
    WEBSITE: '官网',
    UNKNOWN: '未知来源',
  };
  return labels[source] || source;
}

function daysBetween(from: Date, to: Date) {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86400000));
}

async function buildOpportunityStageVelocityReport({ since, until }: { since: Date; until: Date }) {
  const rows = await prisma.opportunityStageHistory.findMany({
    where: { changedAt: { gte: since, lt: until } },
    include: {
      opportunity: { include: { company: true, owner: true } },
      changedBy: { select: { name: true, email: true } },
    },
    orderBy: { changedAt: 'desc' },
    take: 500,
  });
  if (rows.length === 0) return emptyOpportunityStageVelocity();

  const opportunityCount = new Set(rows.map((row) => row.opportunityId)).size;
  const durationRows = rows.filter((row) => typeof row.durationDays === 'number');
  const totalDuration = durationRows.reduce((sum, row) => sum + (row.durationDays || 0), 0);
  const avgDurationDays = durationRows.length > 0 ? totalDuration / durationRows.length : 0;
  const wonRows = rows.filter((row) => row.toStage === 'CLOSED_WON' && typeof row.durationDays === 'number');
  const wonAvgDurationDays = wonRows.length > 0 ? wonRows.reduce((sum, row) => sum + (row.durationDays || 0), 0) / wonRows.length : 0;
  const slowRows = rows.filter((row) => (row.durationDays || 0) >= 7);
  const snapshotRevenue = rows.reduce((sum, row) => sum + (row.amountUSD || 0), 0);

  const byStage = new Map<string, any>();
  for (const row of rows) {
    const key = row.toStage;
    const current = byStage.get(key) || {
      stage: key,
      stageLabel: STAGE_LABEL[key] || key,
      changes: 0,
      durationTotal: 0,
      durationCount: 0,
      avgDurationDays: 0,
      wonChanges: 0,
      revenue: 0,
    };
    current.changes += 1;
    if (typeof row.durationDays === 'number') {
      current.durationTotal += row.durationDays;
      current.durationCount += 1;
    }
    if (row.toStage === 'CLOSED_WON') current.wonChanges += 1;
    current.revenue += row.amountUSD || 0;
    current.avgDurationDays = current.durationCount > 0 ? current.durationTotal / current.durationCount : 0;
    byStage.set(key, current);
  }

  const byStageRows = Array.from(byStage.values())
    .map((row) => ({ ...row, avgDurationDays: Number(formatLocalNumber(row.avgDurationDays)) }))
    .sort((a, b) => b.avgDurationDays - a.avgDurationDays || b.changes - a.changes);

  const slowTransitions = slowRows
    .sort((a, b) => (b.durationDays || 0) - (a.durationDays || 0))
    .slice(0, 8)
    .map((row) => ({
      id: row.id,
      opportunityId: row.opportunityId,
      title: row.opportunity.title,
      companyName: row.opportunity.company.name,
      ownerName: row.opportunity.owner?.name || row.opportunity.owner?.email || row.changedBy?.name || row.changedBy?.email || '未分配',
      fromStageLabel: row.fromStage ? STAGE_LABEL[row.fromStage] || row.fromStage : '初始',
      toStageLabel: STAGE_LABEL[row.toStage] || row.toStage,
      durationDays: row.durationDays || 0,
      amountUSD: row.amountUSD || 0,
      changedAtLabel: row.changedAt.toLocaleDateString('zh-CN'),
    }));

  return {
    totalChanges: rows.length,
    opportunityCount,
    avgDurationDays,
    avgDurationLabel: `${formatLocalNumber(avgDurationDays)} 天`,
    wonChanges: wonRows.length,
    wonAvgDurationLabel: wonRows.length > 0 ? `${formatLocalNumber(wonAvgDurationDays)} 天` : '-',
    slowChanges: slowRows.length,
    snapshotRevenue,
    byStage: byStageRows,
    slowTransitions,
    maxStageDuration: Math.max(1, ...byStageRows.map((row) => row.avgDurationDays)),
    recommendation: stageVelocityRecommendation({ totalChanges: rows.length, avgDurationDays, wonChanges: wonRows.length, slowChanges: slowRows.length, slowTransitions }),
  };
}

function emptyOpportunityStageVelocity() {
  return {
    totalChanges: 0,
    opportunityCount: 0,
    avgDurationDays: 0,
    avgDurationLabel: '-',
    wonChanges: 0,
    wonAvgDurationLabel: '-',
    slowChanges: 0,
    snapshotRevenue: 0,
    byStage: [],
    slowTransitions: [],
    maxStageDuration: 1,
    recommendation: '暂无阶段历史数据。后续每次在商机详情页推进阶段,系统都会自动沉淀阶段快照,用于判断漏斗速度。',
  };
}

function stageVelocityRecommendation(input: { totalChanges: number; avgDurationDays: number; wonChanges: number; slowChanges: number; slowTransitions: any[] }) {
  if (input.totalChanges === 0) return '暂无阶段历史数据。先从商机详情页维护阶段,系统会自动记录从哪个阶段推进、停留多久。';
  if (input.slowChanges > 0) {
    const top = input.slowTransitions[0];
    return `近 30 天有 ${input.slowChanges} 次阶段变更停留超过 7 天;最慢的是“${top?.title || '未知商机'}”,建议复盘报价、样品、规格或付款条件堵点。`;
  }
  if (input.wonChanges > 0) return `近 30 天已有 ${input.wonChanges} 次赢单阶段变更,平均阶段停留 ${formatLocalNumber(input.avgDurationDays)} 天;继续沉淀每次阶段推进原因,后续可反推出最佳销售节奏。`;
  return `近 30 天有 ${input.totalChanges} 次阶段推进,平均停留 ${formatLocalNumber(input.avgDurationDays)} 天;下一步重点把报价到谈判、谈判到赢单的动作写进 CRM。`;
}

async function buildSalesActionAttributionReport({ since, until }: { since: Date; until: Date }) {
  const lookbackStart = new Date(since.getTime() - 30 * 24 * 60 * 60 * 1000);
  const outcomes = await prisma.opportunity.findMany({
    where: {
      stageChangedAt: { gte: since, lt: until },
      stage: { in: ['REPLIED', 'QUOTING', 'NEGOTIATING', 'SPEC_CONFIRMING', 'CLOSED_WON'] as any },
    },
    include: { company: true, owner: true },
    orderBy: [{ stageChangedAt: 'desc' }, { amountUSD: 'desc' }],
    take: 200,
  });
  const companyIds = Array.from(new Set(outcomes.map((opp) => opp.companyId)));
  if (outcomes.length === 0 || companyIds.length === 0) return emptySalesActionAttribution();

  const [followUps, doneTasks, inboxMessages] = await Promise.all([
    prisma.followUp.findMany({
      where: { companyId: { in: companyIds }, createdAt: { gte: lookbackStart, lt: until } },
      include: { user: true },
      take: 800,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.salesTask.findMany({
      where: { companyId: { in: companyIds }, status: 'DONE', completedAt: { gte: lookbackStart, lt: until } },
      include: { owner: true },
      take: 800,
      orderBy: { completedAt: 'desc' },
    }),
    prisma.inboxMessage.findMany({
      where: { companyId: { in: companyIds }, createdAt: { gte: lookbackStart, lt: until } },
      take: 1000,
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const touchpoints = [
    ...followUps.map((item) => ({
      id: item.id,
      companyId: item.companyId,
      ownerId: item.userId,
      ownerName: item.user.name || item.user.email,
      type: 'FOLLOW_UP',
      label: '跟进记录',
      at: item.createdAt,
      text: item.content,
    })),
    ...doneTasks.map((item) => ({
      id: item.id,
      companyId: item.companyId,
      ownerId: item.ownerId,
      ownerName: item.owner.name || item.owner.email,
      type: taskAttributionType(item.source),
      label: taskAttributionLabel(item.source),
      at: item.completedAt || item.updatedAt,
      text: item.title,
    })),
    ...inboxMessages.map((item) => ({
      id: item.id,
      companyId: item.companyId || '',
      ownerId: '',
      ownerName: '',
      type: item.direction === 'OUT' ? 'OUTBOUND_MESSAGE' : 'INBOUND_MESSAGE',
      label: item.direction === 'OUT' ? '我方消息' : '客户来信',
      at: item.sentAt || item.createdAt,
      text: item.translatedText || item.originalText,
    })),
  ].filter((item) => item.companyId);

  const byType = new Map<string, any>();
  const byOwner = new Map<string, any>();
  const outcomeRows: any[] = [];
  let attributedRevenue = 0;
  let attributedOutcomes = 0;
  let touchCredits = 0;

  for (const opp of outcomes) {
    const outcomeAt = opp.stageChangedAt || opp.updatedAt;
    const windowStart = new Date(outcomeAt.getTime() - 30 * 24 * 60 * 60 * 1000);
    const touches = touchpoints
      .filter((touch) => touch.companyId === opp.companyId && touch.at >= windowStart && touch.at <= outcomeAt)
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, 12)
      .map((touch) => ({
        ...touch,
        ownerId: touch.ownerId || opp.ownerId || opp.company.ownerId || 'unassigned',
        ownerName: touch.ownerName || opp.owner?.name || opp.owner?.email || opp.company.ownerId || '未分配',
      }));
    if (touches.length === 0) continue;

    attributedOutcomes++;
    touchCredits += touches.length;
    const revenueCredit = opp.stage === 'CLOSED_WON' ? (opp.amountUSD || 0) / touches.length : 0;
    const stageCredit = 1 / touches.length;
    attributedRevenue += revenueCredit * touches.length;

    for (const touch of touches) {
      addAttributionBucket(byType, touch.type, touch.label, revenueCredit, stageCredit);
      addAttributionBucket(byOwner, touch.ownerId, touch.ownerName, revenueCredit, stageCredit);
    }

    const topTouch = touches[0];
    outcomeRows.push({
      id: opp.id,
      title: opp.title,
      companyName: opp.company.name,
      ownerName: opp.owner?.name || opp.owner?.email || '未分配',
      stageLabel: STAGE_LABEL[opp.stage] || opp.stage,
      amountUSD: opp.amountUSD || 0,
      touchCount: touches.length,
      topTouchLabel: topTouch?.label || '-',
    });
  }

  const typeRows = Array.from(byType.values()).sort((a, b) => b.revenueCredit - a.revenueCredit || b.stageCredit - a.stageCredit || b.touchCredits - a.touchCredits);
  const ownerRows = Array.from(byOwner.values()).sort((a, b) => b.revenueCredit - a.revenueCredit || b.stageCredit - a.stageCredit || b.touchCredits - a.touchCredits);
  const revenue = outcomes.filter((opp) => opp.stage === 'CLOSED_WON').reduce((sum, opp) => sum + (opp.amountUSD || 0), 0);
  const wonDeals = outcomes.filter((opp) => opp.stage === 'CLOSED_WON').length;
  const bestType = typeRows[0] || null;
  const attributionCoverage = outcomes.length > 0 ? attributedOutcomes / outcomes.length : null;

  return {
    outcomes: outcomes.length,
    attributedOutcomes,
    revenue,
    wonDeals,
    attributedRevenue,
    attributionCoverage,
    touchCredits,
    avgTouches: attributedOutcomes > 0 ? formatLocalNumber(touchCredits / attributedOutcomes) : '0',
    bestType,
    byType: typeRows,
    byOwner: ownerRows,
    topOutcomes: outcomeRows.sort((a, b) => b.amountUSD - a.amountUSD || b.touchCount - a.touchCount).slice(0, 6),
    maxTypeCredit: Math.max(1, ...typeRows.map((row) => row.touchCredits)),
    maxOwnerRevenue: Math.max(1, ...ownerRows.map((row) => row.revenueCredit)),
    recommendation: actionAttributionRecommendation({ attributedOutcomes, outcomes: outcomes.length, attributedRevenue, revenue, bestType }),
  };
}

type CustomerHealthEffectSourceRow = {
  source: string;
  sourceLabel: string;
  totalTasks: number;
  doneTasks: number;
  openTasks: number;
  overdueTasks: number;
  downstreamOutcomes: number;
  wonDeals: number;
  wonRevenue: number;
};

type CustomerHealthEffectTaskRow = {
  id: string;
  companyId: string;
  companyName: string;
  ownerName: string;
  sourceLabel: string;
  status: string;
  statusLabel: string;
  isOverdue: boolean;
  createdAtLabel: string;
  downstreamOutcomes: number;
  wonRevenue: number;
};

async function buildCustomerHealthAutomationEffectReport({ since, until }: { since: Date; until: Date }) {
  const sources = ['CUSTOMER_HEALTH_AUTOMATION', 'CUSTOMER_HEALTH_BULK', 'CUSTOMER_HEALTH'];
  const tasks = await prisma.salesTask.findMany({
    where: {
      source: { in: sources },
      createdAt: { gte: since, lt: until },
    },
    include: {
      owner: true,
      company: {
        include: {
          opportunities: {
            where: { stageChangedAt: { gte: since, lt: until } },
            select: { id: true, title: true, stage: true, amountUSD: true, stageChangedAt: true, updatedAt: true },
          },
        },
      },
    },
    orderBy: [{ createdAt: 'desc' }, { dueAt: 'asc' }],
    take: 500,
  });
  if (tasks.length === 0) return emptyCustomerHealthAutomationEffect();

  const now = new Date();
  const bySource = new Map<string, CustomerHealthEffectSourceRow>();
  const companyIds = new Set<string>();
  const ownerIds = new Set<string>();
  let doneTasks = 0;
  let openTasks = 0;
  let overdueTasks = 0;
  let downstreamOutcomes = 0;
  let wonDeals = 0;
  let wonRevenue = 0;

  const topTasks: CustomerHealthEffectTaskRow[] = [];

  for (const task of tasks) {
    companyIds.add(task.companyId);
    ownerIds.add(task.ownerId);
    const source = task.source;
    const current = bySource.get(source) || {
      source,
      sourceLabel: healthTaskSourceLabel(source),
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

    current.totalTasks += 1;
    current.doneTasks += isDone ? 1 : 0;
    current.openTasks += isOpen ? 1 : 0;
    current.overdueTasks += isOverdue ? 1 : 0;
    current.downstreamOutcomes += taskOutcomes;
    current.wonDeals += taskWonDeals;
    current.wonRevenue += taskWonRevenue;
    bySource.set(source, current);

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
      sourceLabel: healthTaskSourceLabel(source),
      status: task.status,
      statusLabel: task.status === 'DONE' ? '已完成' : task.status === 'TODO' ? (isOverdue ? '已逾期' : '待处理') : '已取消',
      isOverdue,
      createdAtLabel: task.createdAt.toLocaleDateString('zh-CN'),
      downstreamOutcomes: taskOutcomes,
      wonRevenue: taskWonRevenue,
    });
  }

  const bySourceRows = Array.from(bySource.values()).sort((a, b) => b.wonRevenue - a.wonRevenue || b.downstreamOutcomes - a.downstreamOutcomes || b.totalTasks - a.totalTasks);
  const sortedTopTasks = topTasks
    .sort((a, b) => b.wonRevenue - a.wonRevenue || b.downstreamOutcomes - a.downstreamOutcomes || Number(b.isOverdue) - Number(a.isOverdue))
    .slice(0, 8);
  const totalTasks = tasks.length;

  return {
    totalTasks,
    automationTasks: bySource.get('CUSTOMER_HEALTH_AUTOMATION')?.totalTasks || 0,
    bulkTasks: bySource.get('CUSTOMER_HEALTH_BULK')?.totalTasks || 0,
    manualTasks: bySource.get('CUSTOMER_HEALTH')?.totalTasks || 0,
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
    bySource: bySourceRows,
    topTasks: sortedTopTasks,
    maxSourceTasks: Math.max(1, ...bySourceRows.map((row) => row.totalTasks)),
    recommendation: customerHealthAutomationRecommendation({ totalTasks, doneTasks, openTasks, overdueTasks, downstreamOutcomes, wonRevenue }),
  };
}

function emptyCustomerHealthAutomationEffect() {
  return {
    totalTasks: 0,
    automationTasks: 0,
    bulkTasks: 0,
    manualTasks: 0,
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
    bySource: [] as CustomerHealthEffectSourceRow[],
    topTasks: [] as CustomerHealthEffectTaskRow[],
    maxSourceTasks: 1,
    recommendation: '近 30 天暂无客户健康修复任务。后续自动化/批量/客户详情生成任务后,这里会复盘完成率和后续商机推进。',
  };
}

function customerHealthAutomationRecommendation(input: { totalTasks: number; doneTasks: number; openTasks: number; overdueTasks: number; downstreamOutcomes: number; wonRevenue: number }) {
  if (input.totalTasks === 0) return '近 30 天暂无客户健康修复任务。先让低健康客户进入自动化或批量修复队列。';
  if (input.overdueTasks > 0) return `有 ${input.overdueTasks} 个客户健康修复任务已逾期。优先处理逾期项,否则自动化只是制造待办库存。`;
  if (input.doneTasks === 0) return `已生成 ${input.totalTasks} 个健康修复任务,但还没有完成记录。先要求销售关闭任务并写跟进结果。`;
  if (input.downstreamOutcomes > 0 && input.wonRevenue > 0) return `健康修复任务已带来 ${input.downstreamOutcomes} 次后续推进和 $${Math.round(input.wonRevenue).toLocaleString()} 赢单收入。建议复盘有效短板和话术。`;
  if (input.downstreamOutcomes > 0) return `健康修复任务已带来 ${input.downstreamOutcomes} 次后续商机推进,但暂未形成赢单收入。继续盯报价到成交的转化。`;
  return `健康修复任务完成率 ${formatLocalPercent(input.totalTasks ? input.doneTasks / input.totalTasks : null)},但暂未看到后续商机推进。需要检查任务内容是否足够具体。`;
}

function healthTaskSourceLabel(source: string) {
  const labels: Record<string, string> = {
    CUSTOMER_HEALTH_AUTOMATION: '健康自动化',
    CUSTOMER_HEALTH_BULK: '健康批量',
    CUSTOMER_HEALTH: '客户详情体检',
  };
  return labels[source] || source;
}

function taskAttributionType(source: string | null) {
  if (source === 'CUSTOMER_HEALTH_AUTOMATION') return 'HEALTH_AUTOMATION_TASK';
  if (source === 'CUSTOMER_HEALTH_BULK') return 'HEALTH_BULK_TASK';
  if (source === 'CUSTOMER_HEALTH') return 'HEALTH_DETAIL_TASK';
  if (source === 'AUTOMATION_NO_REPLY_TIMEOUT') return 'AUTOMATION_DRIP_TASK';
  if (source === 'EMAIL_ACTION_BULK') return 'EMAIL_ACTION_TASK';
  if (source === 'SALES_RADAR') return 'SALES_RADAR_TASK';
  return 'DONE_TASK';
}

function taskAttributionLabel(source: string | null) {
  const labels: Record<string, string> = {
    CUSTOMER_HEALTH_AUTOMATION: '健康自动化任务',
    CUSTOMER_HEALTH_BULK: '健康批量任务',
    CUSTOMER_HEALTH: '客户体检任务',
    AUTOMATION_NO_REPLY_TIMEOUT: '自动开发信任务',
    EMAIL_ACTION_BULK: '邮件动作任务',
    SALES_RADAR: '销售雷达任务',
  };
  return labels[source || ''] || '完成任务';
}

function emptySalesActionAttribution() {
  return {
    outcomes: 0,
    attributedOutcomes: 0,
    revenue: 0,
    wonDeals: 0,
    attributedRevenue: 0,
    attributionCoverage: null,
    touchCredits: 0,
    avgTouches: '0',
    bestType: null,
    byType: [],
    byOwner: [],
    topOutcomes: [],
    maxTypeCredit: 1,
    maxOwnerRevenue: 1,
    recommendation: '近 30 天暂无可分析的商机推进结果。先确保销售动作、任务完成和客户消息都沉淀到 CRM,后续才能做稳定归因。',
  };
}

function addAttributionBucket(map: Map<string, any>, key: string, label: string, revenueCredit: number, stageCredit: number) {
  const current = map.get(key) || { key, label, revenueCredit: 0, stageCredit: 0, touchCredits: 0 };
  current.revenueCredit += revenueCredit;
  current.stageCredit += stageCredit;
  current.touchCredits += 1;
  map.set(key, current);
}

function actionAttributionRecommendation(input: { attributedOutcomes: number; outcomes: number; attributedRevenue: number; revenue: number; bestType: any }) {
  if (input.outcomes === 0) return '近 30 天没有商机推进结果,先把进行中商机的阶段和下一步动作维护起来。';
  if (input.attributedOutcomes === 0) return '近期商机有推进,但推进前缺少可识别触点。需要让销售把跟进、任务完成和客户消息都记录进 CRM。';
  if (input.attributedRevenue > 0) return `已有 $${Math.round(input.attributedRevenue).toLocaleString()} 赢单收入可分摊到销售触点;当前最有效触点是“${input.bestType?.label || '未知'}”,建议复盘其话术和客户场景。`;
  return `近 30 天 ${input.attributedOutcomes}/${input.outcomes} 个推进结果能找到前置触点,但暂未形成赢单收入,下一步重点看报价到谈判、谈判到赢单的转化。`;
}

function formatLocalPercent(value: number | null) {
  if (value === null) return '-';
  return `${Math.round(value * 100)}%`;
}

function formatLocalNumber(value: number) {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) >= 10) return String(Math.round(value));
  return value.toFixed(1).replace(/\\.0$/, '');
}

function AttributionMetric({ label, value, detail, tone }: { label: string; value: string | number; detail: string; tone: 'blue' | 'emerald' | 'amber' | 'violet' | 'rose' | 'gray' }) {
  const color = tone === 'emerald'
    ? 'border-emerald-100 bg-emerald-50 text-emerald-800'
    : tone === 'amber'
      ? 'border-amber-100 bg-amber-50 text-amber-800'
      : tone === 'violet'
        ? 'border-violet-100 bg-violet-50 text-violet-800'
        : tone === 'rose'
          ? 'border-rose-100 bg-rose-50 text-rose-800'
          : tone === 'blue'
            ? 'border-blue-100 bg-blue-50 text-blue-800'
            : 'border-gray-100 bg-gray-50 text-gray-700';
  return (
    <div className={`rounded-xl border p-4 ${color}`}>
      <div className="text-xs font-black opacity-75">{label}</div>
      <div className="mt-1 truncate text-2xl font-black">{value}</div>
      <div className="mt-1 text-xs font-bold opacity-70">{detail}</div>
    </div>
  );
}

function GmailReadinessPanel({ readiness, plans, canManage }: { readiness: any; plans: any[]; canManage: boolean }) {
  const color = readiness.status === 'ready'
    ? 'border-emerald-100 bg-emerald-50 text-emerald-900'
    : readiness.status === 'empty'
      ? 'border-amber-100 bg-amber-50 text-amber-900'
      : 'border-rose-100 bg-rose-50 text-rose-900';
  return (
    <div id="gmail-label-plan" className={`mt-4 scroll-mt-24 rounded-xl border p-4 ${color}`}>
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h3 className="text-sm font-black">{readiness.title}</h3>
          <p className="mt-1 text-xs font-bold opacity-75">{readiness.detail}</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-black">
          <div className="rounded-lg bg-white/70 px-3 py-2">Gmail 标签计划 {plans.length}</div>
          <div className="rounded-lg bg-white/70 px-3 py-2">覆盖邮件 {plans.reduce((sum, plan) => sum + (plan.messageCount || 0), 0)}</div>
          <div className="rounded-lg bg-white/70 px-3 py-2">需动作 {plans.reduce((sum, plan) => sum + (plan.actionRequiredCount || 0), 0)}</div>
        </div>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {plans.slice(0, 10).map((plan) => (
          <div key={plan.key} className="rounded-lg bg-white/75 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 truncate text-xs font-black">{plan.labelName}</div>
              <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-black text-gray-600">{plan.slaHours ? `${plan.slaHours}h` : '归档'}</span>
            </div>
            <div className="mt-1 text-[11px] font-bold opacity-70">{plan.categoryLabel} · {plan.crmAction}</div>
            <div className="mt-2 flex flex-wrap gap-1 text-[10px] font-black opacity-75">
              <span className="rounded bg-white px-1.5 py-0.5">样本 {plan.messageCount || 0}</span>
              <span className="rounded bg-white px-1.5 py-0.5">动作 {plan.actionRequiredCount || 0}</span>
              <span className="rounded bg-white px-1.5 py-0.5">线索 {plan.leadCount || 0}</span>
              <span className="rounded bg-white px-1.5 py-0.5">{gmailExecutionModeLabel(plan.executionMode)}</span>
            </div>
            <div className="mt-1 line-clamp-2 text-[11px] font-bold opacity-70">{plan.executionHint || plan.description}</div>
            <div className="mt-1 truncate text-[11px] font-medium opacity-60">{plan.gmailQuery}</div>
            {canManage && (plan.messageCount || 0) > 0 && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <form action="/api/emails/label-plan/apply" method="post">
                  <input type="hidden" name="planKey" value={plan.key} />
                  <input type="hidden" name="limit" value="100" />
                  <button className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-[11px] font-black text-gray-700 hover:bg-gray-50">预演</button>
                </form>
                <form action="/api/emails/label-plan/apply" method="post">
                  <input type="hidden" name="planKey" value={plan.key} />
                  <input type="hidden" name="apply" value="true" />
                  <input type="hidden" name="limit" value="100" />
                  <button className="w-full rounded-lg bg-gray-900 px-2 py-1.5 text-[11px] font-black text-white hover:bg-gray-800">应用</button>
                </form>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function gmailExecutionModeLabel(mode: string) {
  const labels: Record<string, string> = {
    task: '转任务',
    review: '复核',
    archive: '打标归档',
    watch: '观察',
  };
  return labels[mode] || '观察';
}

function EmailAuditItem({ msg }: { msg: any }) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 truncate text-xs font-black text-gray-900">{msg.subject}</div>
        <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-black text-gray-600">{msg.classificationScore}</span>
      </div>
      <div className="mt-1 truncate text-[11px] font-bold text-gray-500">{msg.from}</div>
      <div className="mt-1 flex flex-wrap gap-1 text-[11px] font-bold text-gray-400">
        <span>{msg.categoryLabel}</span>
        <span>·</span>
        <span>{msg.dateLabel}</span>
        <span>·</span>
        <span>{msg.accountEmail}</span>
      </div>
      <div className="mt-1 truncate text-[11px] font-medium text-gray-400">{msg.categoryReason}</div>
    </div>
  );
}

function EmailBulkResultBanner({
  result,
}: {
  result: { bulk?: string; created?: string; cleared?: string; skipped?: string };
}) {
  const label: Record<string, string> = {
    tasks: '邮件任务已生成',
    cleared: '邮件噪音已清理',
    empty: '没有选中可处理邮件',
  };
  return (
    <div className="mb-3 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-800">
      {label[result.bulk || ''] || '邮件批量动作已执行'}
      <span className="ml-2">生成 {result.created || '0'}</span>
      <span className="ml-2">清理 {result.cleared || '0'}</span>
      {result.skipped ? <span className="ml-2 text-emerald-600">跳过 {result.skipped}</span> : null}
    </div>
  );
}

function EmailLabelPlanResultBanner({
  result,
}: {
  result: { status?: string; planKey?: string; candidates?: string; tagged?: string; created?: string; cleared?: string; skipped?: string };
}) {
  const dryRun = result.status === 'dry';
  const invalid = result.status === 'invalid';
  return (
    <div className={`mt-3 rounded-lg border px-4 py-3 text-xs font-bold ${invalid ? 'border-rose-100 bg-rose-50 text-rose-800' : dryRun ? 'border-blue-100 bg-blue-50 text-blue-800' : 'border-emerald-100 bg-emerald-50 text-emerald-800'}`}>
      {invalid ? '标签计划参数无效' : dryRun ? 'Gmail 标签计划预演完成' : 'Gmail 标签计划已应用到 CRM'}
      {result.planKey ? <span className="ml-2">计划 {result.planKey}</span> : null}
      <span className="ml-2">候选 {result.candidates || '0'}</span>
      <span className="ml-2">已标记 {result.tagged || '0'}</span>
      <span className="ml-2">生成任务 {result.created || '0'}</span>
      <span className="ml-2">清理 {result.cleared || '0'}</span>
      {result.skipped ? <span className="ml-2">跳过 {result.skipped}</span> : null}
    </div>
  );
}

function EmailAutopilotResultBanner({
  result,
}: {
  result: { status?: string; taskCandidates?: string; noiseCandidates?: string; created?: string; cleared?: string; skipped?: string };
}) {
  const dryRun = result.status === 'dry';
  return (
    <div className={`mb-3 rounded-lg border px-4 py-3 text-xs font-bold ${dryRun ? 'border-indigo-100 bg-indigo-50 text-indigo-800' : 'border-emerald-100 bg-emerald-50 text-emerald-800'}`}>
      {dryRun ? '邮件自动驾驶预演完成' : '邮件自动驾驶已执行'}
      <span className="ml-2">任务候选 {result.taskCandidates || '0'}</span>
      <span className="ml-2">噪音候选 {result.noiseCandidates || '0'}</span>
      <span className="ml-2">生成 {result.created || '0'}</span>
      <span className="ml-2">清理 {result.cleared || '0'}</span>
      {result.skipped ? <span className="ml-2 opacity-75">跳过 {result.skipped}</span> : null}
    </div>
  );
}

function EmailSecurityResultBanner({
  result,
}: {
  result: { status?: string; staleCandidates?: string; freshPending?: string; archived?: string; notified?: string; skippedDuplicates?: string };
}) {
  const dryRun = result.status === 'dry';
  return (
    <div className={`mb-3 rounded-lg border px-4 py-3 text-xs font-bold ${dryRun ? 'border-indigo-100 bg-indigo-50 text-indigo-800' : 'border-emerald-100 bg-emerald-50 text-emerald-800'}`}>
      {dryRun ? '安全邮件归档预演完成' : '安全邮件归档已执行'}
      <span className="ml-2">过期候选 {result.staleCandidates || '0'}</span>
      <span className="ml-2">近期待确认 {result.freshPending || '0'}</span>
      <span className="ml-2">已归档 {result.archived || '0'}</span>
      <span className="ml-2">通知 {result.notified || '0'}</span>
      {result.skippedDuplicates ? <span className="ml-2 opacity-75">重复跳过 {result.skippedDuplicates}</span> : null}
    </div>
  );
}

function EmailSecurityPreview({ title, rows, empty }: { title: string; rows: any[]; empty: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4">
      <h4 className="text-xs font-black text-gray-500">{title}</h4>
      <div className="mt-3 space-y-2">
        {rows.slice(0, 8).map((msg) => (
          <div key={msg.id} className="rounded-lg bg-gray-50 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 truncate text-xs font-black text-gray-900">{msg.subject}</div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-black ${msg.actionRequired ? 'bg-rose-50 text-rose-700' : 'bg-white text-gray-500'}`}>{msg.signalLabel}</span>
            </div>
            <div className="mt-1 truncate text-[11px] font-bold text-gray-500">{msg.from}</div>
            <div className="mt-1 flex flex-wrap gap-1 text-[11px] font-bold text-gray-400">
              <span>{msg.dateLabel}</span>
              <span>·</span>
              <span>{msg.accountEmail}</span>
              <span>·</span>
              <span>{msg.ageHours}h</span>
            </div>
            <div className="mt-1 truncate text-[11px] font-medium text-gray-400">{msg.reason}</div>
          </div>
        ))}
        {rows.length > 8 && <div className="text-[11px] font-bold text-gray-400">另有 {rows.length - 8} 封。</div>}
        {rows.length === 0 && <div className="rounded-lg bg-gray-50 p-3 text-xs font-bold text-gray-400">{empty}</div>}
      </div>
    </div>
  );
}

function EmailBulkActionCard({
  title,
  count,
  detail,
  action,
  buttonLabel,
  ids,
  tone,
}: {
  title: string;
  count: number;
  detail: string;
  action: string;
  buttonLabel: string;
  ids: string[];
  tone: 'blue' | 'slate';
}) {
  const color = tone === 'blue'
    ? 'border-blue-100 bg-blue-50 text-blue-900'
    : 'border-slate-100 bg-slate-50 text-slate-900';
  const buttonColor = tone === 'blue' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-slate-700 hover:bg-slate-800';
  return (
    <div className={`rounded-xl border p-4 ${color}`}>
      <div className="text-xs font-black opacity-75">{title}</div>
      <div className="mt-2 text-2xl font-black">{count}</div>
      <div className="mt-2 min-h-[34px] text-xs font-bold opacity-75">{detail}</div>
      <form action="/api/emails/bulk" method="post" className="mt-4">
        <input type="hidden" name="action" value={action} />
        <input type="hidden" name="ids" value={ids.join(',')} />
        <button
          type="submit"
          disabled={ids.length === 0}
          className={`w-full rounded-lg px-3 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:bg-gray-300 ${buttonColor}`}
        >
          {buttonLabel}
        </button>
      </form>
    </div>
  );
}

function EmailCleanupPreview({ title, rows, empty }: { title: string; rows: any[]; empty: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4">
      <div className="text-xs font-black text-gray-500">{title}</div>
      <div className="mt-3 space-y-2">
        {rows.slice(0, 5).map((msg) => (
          <EmailAuditItem key={msg.id} msg={msg} />
        ))}
        {rows.length > 5 && <div className="text-[11px] font-bold text-gray-400">另有 {rows.length - 5} 封已纳入本次批量队列。</div>}
        {rows.length === 0 && <div className="rounded-lg bg-gray-50 p-3 text-xs font-bold text-gray-400">{empty}</div>}
      </div>
    </div>
  );
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function AttributionBar({ label, value, max, detail }: { label: string; value: number; max: number; detail: string }) {
  const width = `${Math.max(4, Math.round((value / Math.max(1, max)) * 100))}%`;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs font-black text-gray-900">{label}</span>
        <span className="shrink-0 text-xs font-black text-gray-500">{formatLocalNumber(value)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-gray-100">
        <div className="h-full rounded-full bg-indigo-500" style={{ width }} />
      </div>
      <div className="mt-1 text-[11px] font-bold text-gray-400">{detail}</div>
    </div>
  );
}

function LoadBar({ label, value, max }: { label: string; value: number; max: number }) {
  const width = `${Math.max(4, Math.round((value / max) * 100))}%`;
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs font-bold text-gray-500">
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <div className="h-2 rounded-full bg-gray-100">
        <div className="h-2 rounded-full bg-indigo-500" style={{ width }} />
      </div>
    </div>
  );
}

function RadarCard({
  href,
  name,
  owner,
  score,
  level,
  levelLabel,
  title,
  action,
  reasons,
  companyId,
  ownerId,
  dueHours,
  priority,
}: {
  href: string;
  name: string;
  owner: string;
  score: number;
  level: string;
  levelLabel: string;
  title: string;
  action: string;
  reasons: string[];
  companyId: string;
  ownerId: string;
  dueHours: number;
  priority: string;
}) {
  const style: Record<string, string> = {
    hot: 'border-rose-200 bg-rose-50 text-rose-800',
    risk: 'border-amber-200 bg-amber-50 text-amber-800',
    warm: 'border-blue-200 bg-blue-50 text-blue-800',
    normal: 'border-slate-200 bg-slate-50 text-slate-700',
  };
  const meter: Record<string, string> = {
    hot: 'bg-rose-500',
    risk: 'bg-amber-500',
    warm: 'bg-blue-500',
    normal: 'bg-slate-400',
  };
  return (
    <div className={`rounded-xl border p-4 transition hover:-translate-y-0.5 hover:shadow-sm ${style[level] || style.normal}`}>
      <Link href={href} className="block">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-black text-gray-900">{name}</div>
            <div className="mt-1 text-xs font-bold opacity-70">{title} · {owner}</div>
          </div>
          <span className="shrink-0 rounded-full bg-white/80 px-2 py-1 text-xs font-black">{levelLabel}</span>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <div className="h-2 flex-1 rounded-full bg-white/80">
            <div className={`h-2 rounded-full ${meter[level] || meter.normal}`} style={{ width: `${score}%` }} />
          </div>
          <div className="text-sm font-black">{score}</div>
        </div>
        <div className="mt-3 rounded-lg bg-white/75 p-3 text-xs leading-relaxed text-gray-700">{action}</div>
      </Link>
      <div className="mt-3 space-y-1">
        {reasons.slice(0, 3).map((reason) => (
          <div key={reason} className="text-xs font-medium opacity-80">- {reason}</div>
        ))}
      </div>
      <form action={createRadarTask} className="mt-4">
        <input type="hidden" name="companyId" value={companyId} />
        <input type="hidden" name="ownerId" value={ownerId} />
        <input type="hidden" name="title" value={`跟进 ${name}`} />
        <input type="hidden" name="description" value={action} />
        <input type="hidden" name="priority" value={priority} />
        <input type="hidden" name="dueHours" value={dueHours} />
        <button className="w-full rounded-lg bg-white/90 px-3 py-2 text-xs font-black text-gray-800 shadow-sm hover:bg-white">
          生成跟进任务
        </button>
      </form>
    </div>
  );
}

function HealthQueueCard({
  href,
  name,
  owner,
  score,
  shortfalls,
  action,
  fitScore,
  contactScore,
  engagementScore,
  pipelineScore,
  ownerScore,
}: {
  href: string;
  name: string;
  owner: string;
  score: number;
  shortfalls: string[];
  action: string;
  fitScore: number;
  contactScore: number;
  engagementScore: number;
  pipelineScore: number;
  ownerScore: number;
}) {
  const style = score >= 75 ? 'border-emerald-200 bg-emerald-50' : score >= 55 ? 'border-amber-200 bg-amber-50' : 'border-rose-200 bg-rose-50';
  const label = score >= 75 ? '可优化' : score >= 55 ? '需补强' : '高风险';
  const dimensions = [
    { label: '资料', value: fitScore },
    { label: '联系人', value: contactScore },
    { label: '互动', value: engagementScore },
    { label: '商机', value: pipelineScore },
    { label: '下一步', value: ownerScore },
  ];
  return (
    <Link href={href} className={`block rounded-xl border p-4 transition hover:-translate-y-0.5 hover:shadow-sm ${style}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-black text-gray-900">{name}</div>
          <div className="mt-1 text-xs font-bold text-gray-500">{owner}</div>
        </div>
        <div className="shrink-0 rounded-lg bg-white/90 px-3 py-2 text-center shadow-sm">
          <div className="text-lg font-black text-gray-900">{score}</div>
          <div className="text-[10px] font-black text-gray-500">{label}</div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {(shortfalls.length ? shortfalls : ['暂无明显短板']).slice(0, 5).map((item) => (
          <span key={item} className="rounded-full bg-white/90 px-2 py-1 text-[11px] font-black text-gray-600">{item}</span>
        ))}
      </div>
      <div className="mt-3 rounded-lg bg-white/80 p-3 text-xs leading-relaxed text-gray-700">{action}</div>
      <div className="mt-3 grid grid-cols-5 gap-1.5">
        {dimensions.map((item) => {
          const tone = item.value >= 14 ? 'bg-emerald-500' : item.value >= 10 ? 'bg-amber-500' : 'bg-rose-500';
          return (
            <div key={item.label}>
              <div className="mb-1 truncate text-[10px] font-black text-gray-500">{item.label}</div>
              <div className="h-1.5 rounded-full bg-white/80">
                <div className={`h-1.5 rounded-full ${tone}`} style={{ width: `${Math.max(5, Math.round((item.value / 20) * 100))}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </Link>
  );
}

function TaskPriority({ priority }: { priority: string }) {
  const style: Record<string, string> = {
    URGENT: 'bg-rose-50 text-rose-700 border-rose-100',
    HIGH: 'bg-amber-50 text-amber-700 border-amber-100',
    NORMAL: 'bg-blue-50 text-blue-700 border-blue-100',
    LOW: 'bg-slate-50 text-slate-600 border-slate-100',
  };
  const label: Record<string, string> = {
    URGENT: '紧急',
    HIGH: '高',
    NORMAL: '普通',
    LOW: '低',
  };
  return <span className={`rounded-full border px-2 py-1 text-xs font-bold ${style[priority] || style.NORMAL}`}>{label[priority] || priority}</span>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold text-gray-500">{label}</span>
      {children}
    </label>
  );
}

function CheckboxGroup({ title, name, options, defaultValues }: { title: string; name: string; options: string[][]; defaultValues: string[] }) {
  return (
    <div>
      <div className="mb-2 text-xs font-bold text-gray-500">{title}</div>
      <div className="grid grid-cols-1 gap-2 rounded-xl border border-gray-100 p-3">
        {options.map(([value, label]) => (
          <label key={value} className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" name={name} value={value} defaultChecked={defaultValues.includes(value)} className="h-4 w-4 rounded border-gray-300" />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

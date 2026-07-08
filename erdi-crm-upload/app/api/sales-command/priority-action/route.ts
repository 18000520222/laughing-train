import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { repairAutomationRiskFlow } from '@/lib/automation-risk-repair';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'SALES']);
const SOURCE = 'DAILY_PRIORITY';

export async function POST(req: Request) {
  const auth = await requireSalesUser();
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const form = await req.formData();
  const itemIds = parsePriorityItemIds(form);
  if (itemIds.length === 0) return redirectBack(req, 'invalid', 0, 0, 1);

  let created = 0;
  let notified = 0;
  let skipped = 0;
  let lastStatus = 'invalid';
  for (const itemId of itemIds) {
    const [kind, targetId] = splitItemId(itemId);
    if (!kind || !targetId) {
      skipped++;
      continue;
    }
    const result = await handlePriorityItem({ kind, targetId, itemId, currentUserId: auth.user.id, role: auth.role });
    created += result.created;
    notified += result.notified;
    skipped += result.skipped;
    lastStatus = result.status;
  }
  return redirectBack(req, itemIds.length > 1 ? 'bulk' : lastStatus, created, notified, skipped);
}

async function requireSalesUser() {
  const cookieStore = cookies();
  const role = (cookieStore.get('auth_role')?.value || '').toUpperCase();
  const email = cookieStore.get('auth_email')?.value || '';
  const userId = cookieStore.get('auth_userId')?.value || '';
  if (!ALLOWED_ROLES.has(role)) return null;

  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : email
    ? await prisma.user.findUnique({ where: { email } })
    : null;
  if (!user || !user.isActive) return null;
  return { user, role };
}

async function handlePriorityItem({
  kind,
  targetId,
  itemId,
  currentUserId,
  role,
}: {
  kind: string;
  targetId: string;
  itemId: string;
  currentUserId: string;
  role: string;
}) {
  if (kind === 'MESSAGE_SLA') return createMessageTask(targetId, itemId, currentUserId, role);
  if (kind === 'OPPORTUNITY_STALL') return createOpportunityTask(targetId, itemId, currentUserId, role);
  if (kind === 'CUSTOMER_HEALTH') return createCustomerHealthTask(targetId, itemId, currentUserId, role);
  if (kind === 'AUTOMATION_RISK') return repairAutomationRisk(targetId, currentUserId);
  if (kind === 'SALES_TASK' || kind === 'EMAIL_ACTION' || kind === 'HEALTH_TASK') return remindTaskOwner(targetId, currentUserId, role);
  return { status: 'invalid', created: 0, notified: 0, skipped: 1 };
}

async function createMessageTask(messageId: string, itemId: string, currentUserId: string, role: string) {
  const message = await prisma.inboxMessage.findUnique({
    where: { id: messageId },
    include: { company: { select: { id: true, name: true, ownerId: true } } },
  });
  if (!message?.companyId || !message.company) return { status: 'missing', created: 0, notified: 0, skipped: 1 };
  if (role === 'SALES' && message.company.ownerId && message.company.ownerId !== currentUserId) return { status: 'forbidden', created: 0, notified: 0, skipped: 1 };

  const ownerId = message.company.ownerId || currentUserId;
  if (!message.company.ownerId) await prisma.company.update({ where: { id: message.companyId }, data: { ownerId } });
  const sourceRef = `priority:${itemId}`;
  const existing = await prisma.salesTask.findFirst({ where: { source: SOURCE, sourceRef, status: 'TODO' }, select: { id: true } });
  if (existing) {
    await createOwnerNotification(ownerId, '作战清单任务已存在', `${message.company.name}: 客户消息已有待办任务`, '/tasks?view=week');
    return { status: 'exists', created: 0, notified: 1, skipped: 1 };
  }

  const dueAt = new Date();
  dueAt.setHours(dueAt.getHours() + dueHoursForMessage(message.intent, message.sentAt || message.createdAt));
  await prisma.salesTask.create({
    data: {
      title: `处理高危客户消息: ${message.senderName || message.senderId}`,
      description: `来自${channelLabel(message.channel)}的${intentLabel(message.intent)}消息。原文: ${(message.translatedText || message.originalText).slice(0, 800)}`,
      type: 'EMAIL',
      priority: priorityForMessage(message.intent, message.sentAt || message.createdAt),
      dueAt,
      ownerId,
      createdById: currentUserId,
      companyId: message.companyId,
      source: SOURCE,
      sourceRef,
    },
  });
  await createOwnerNotification(ownerId, '作战清单已生成客户消息任务', `${message.company.name}: ${message.senderName || message.senderId}`, '/tasks?view=week');
  return { status: 'task', created: 1, notified: 1, skipped: 0 };
}

async function createOpportunityTask(opportunityId: string, itemId: string, currentUserId: string, role: string) {
  const opportunity = await prisma.opportunity.findUnique({
    where: { id: opportunityId },
    include: { company: { select: { id: true, name: true, ownerId: true } }, owner: { select: { id: true } } },
  });
  if (!opportunity) return { status: 'missing', created: 0, notified: 0, skipped: 1 };
  const ownerId = opportunity.ownerId || opportunity.company.ownerId || currentUserId;
  if (role === 'SALES' && ownerId !== currentUserId) return { status: 'forbidden', created: 0, notified: 0, skipped: 1 };
  const sourceRef = `priority:${itemId}`;
  const existing = await prisma.salesTask.findFirst({ where: { source: SOURCE, sourceRef, status: 'TODO' }, select: { id: true } });
  if (existing) {
    await createOwnerNotification(ownerId, '作战清单救援任务已存在', `${opportunity.company.name}: ${opportunity.title}`, `/opportunity/${opportunity.id}`);
    return { status: 'exists', created: 0, notified: 1, skipped: 1 };
  }

  const stageAt = opportunity.stageChangedAt || opportunity.updatedAt;
  const ageDays = Math.max(0, Math.floor((Date.now() - stageAt.getTime()) / 86400000));
  const dueAt = new Date();
  dueAt.setHours(dueAt.getHours() + (opportunity.amountUSD && opportunity.amountUSD >= 10000 ? 6 : 24));
  await prisma.salesTask.create({
    data: {
      title: `作战清单救援商机: ${opportunity.title}`,
      description: `${opportunity.company.name} 的商机在 ${stageLabel(opportunity.stage)} 停留 ${ageDays} 天。请确认报价、样品、规格、付款或交期堵点。`,
      type: 'RISK_RESCUE',
      priority: opportunity.amountUSD && opportunity.amountUSD >= 10000 ? 'URGENT' : 'HIGH',
      dueAt,
      ownerId,
      createdById: currentUserId,
      companyId: opportunity.companyId,
      opportunityId: opportunity.id,
      source: SOURCE,
      sourceRef,
    },
  });
  await createOwnerNotification(ownerId, '作战清单已生成商机救援任务', `${opportunity.company.name}: ${opportunity.title}`, `/opportunity/${opportunity.id}`);
  return { status: 'task', created: 1, notified: 1, skipped: 0 };
}

async function createCustomerHealthTask(companyId: string, itemId: string, currentUserId: string, role: string) {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true, ownerId: true, priorityScore: true } });
  if (!company) return { status: 'missing', created: 0, notified: 0, skipped: 1 };
  if (role === 'SALES' && company.ownerId && company.ownerId !== currentUserId) return { status: 'forbidden', created: 0, notified: 0, skipped: 1 };
  const ownerId = company.ownerId || currentUserId;
  if (!company.ownerId) await prisma.company.update({ where: { id: company.id }, data: { ownerId } });
  const sourceRef = `priority:${itemId}`;
  const existing = await prisma.salesTask.findFirst({ where: { source: SOURCE, sourceRef, status: 'TODO' }, select: { id: true } });
  if (existing) {
    await createOwnerNotification(ownerId, '作战清单健康修复任务已存在', `${company.name}: 已有待办任务`, `/customers/${company.id}`);
    return { status: 'exists', created: 0, notified: 1, skipped: 1 };
  }

  const dueAt = new Date();
  dueAt.setHours(dueAt.getHours() + (company.priorityScore >= 80 ? 12 : 24));
  await prisma.salesTask.create({
    data: {
      title: `作战清单修复客户健康: ${company.name}`,
      description: '补齐客户资料、联系人、最近互动、下一步动作和商机状态。',
      type: 'FOLLOW_UP',
      priority: company.priorityScore >= 80 ? 'HIGH' : 'NORMAL',
      dueAt,
      ownerId,
      createdById: currentUserId,
      companyId: company.id,
      source: SOURCE,
      sourceRef,
    },
  });
  await createOwnerNotification(ownerId, '作战清单已生成客户健康任务', `${company.name}: 请补齐客户健康短板`, `/customers/${company.id}`);
  return { status: 'task', created: 1, notified: 1, skipped: 0 };
}

async function remindTaskOwner(taskId: string, currentUserId: string, role: string) {
  const task = await prisma.salesTask.findUnique({ where: { id: taskId }, include: { company: true, owner: true } });
  if (!task) return { status: 'missing', created: 0, notified: 0, skipped: 1 };
  if (role === 'SALES' && task.ownerId !== currentUserId) return { status: 'forbidden', created: 0, notified: 0, skipped: 1 };
  await createOwnerNotification(task.ownerId, '作战清单提醒: 请处理销售任务', `${task.company.name}: ${task.title}`, '/tasks?view=week');
  await prisma.salesTask.update({ where: { id: task.id }, data: { reminderSentAt: new Date() } });
  return { status: 'notify', created: 0, notified: 1, skipped: 0 };
}

async function repairAutomationRisk(flowId: string, currentUserId: string) {
  const result = await repairAutomationRiskFlow({ flowId, userId: currentUserId });
  if (!result.ok) return { status: result.status, created: 0, notified: 0, skipped: result.skipped || 1 };
  const created = result.updated + result.createdRun + result.replayed;
  return { status: result.status, created, notified: result.notified, skipped: result.skipped };
}

async function createOwnerNotification(userId: string, title: string, body: string, link: string) {
  await prisma.notification.create({ data: { userId, type: 'SYSTEM', title, body, link } });
}

function splitItemId(value: string) {
  const index = value.indexOf(':');
  if (index === -1) return ['', ''] as const;
  return [value.slice(0, index), value.slice(index + 1)] as const;
}

function parsePriorityItemIds(form: FormData) {
  const values = [
    String(form.get('itemId') || ''),
    String(form.get('itemIds') || ''),
    ...form.getAll('itemIds').map((value) => String(value || '')),
  ];
  return Array.from(
    new Set(
      values
        .flatMap((value) => value.split(','))
        .map((value) => value.trim())
        .filter(Boolean)
    )
  ).slice(0, 20);
}

function redirectBack(req: Request, status: string, created: number, notified: number, skipped: number) {
  const url = new URL('/sales-command', req.url);
  url.searchParams.set('priorityAction', status);
  url.searchParams.set('priorityCreated', String(created));
  url.searchParams.set('priorityNotified', String(notified));
  if (skipped > 0) url.searchParams.set('prioritySkipped', String(skipped));
  url.hash = 'daily-priority';
  return NextResponse.redirect(url);
}

function priorityForMessage(intent: string | null, at: Date) {
  const ageHours = (Date.now() - at.getTime()) / 3600000;
  if (['PRICE_INQUIRY', 'SAMPLE_REQUEST', 'ORDER_STATUS', 'COMPLAINT'].includes(String(intent)) || ageHours >= 24) return 'URGENT';
  if (String(intent) === 'PRODUCT_QUESTION') return 'HIGH';
  return 'NORMAL';
}

function dueHoursForMessage(intent: string | null, at: Date) {
  const ageHours = (Date.now() - at.getTime()) / 3600000;
  if (ageHours >= 24 || ['PRICE_INQUIRY', 'SAMPLE_REQUEST', 'COMPLAINT'].includes(String(intent))) return 4;
  return 12;
}

function channelLabel(channel: string) {
  const labels: Record<string, string> = {
    EMAIL: '邮件',
    WHATSAPP: 'WhatsApp',
    ALIBABA: '阿里国际站',
    AMAZON: 'Amazon',
    SHOPEE: 'Shopee',
    FACEBOOK: 'Facebook',
    INSTAGRAM: 'Instagram',
    LINKEDIN: 'LinkedIn',
    SALESMARTLY: 'SaleSmartly',
    CHATWOOT: 'Chatwoot',
  };
  return labels[channel] || channel;
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

function stageLabel(stage: string) {
  const labels: Record<string, string> = {
    UNPROCESSED: '未处理',
    REPLIED: '已回复',
    QUOTING: '报价中',
    NEGOTIATING: '谈判中',
    SPEC_CONFIRMING: '规格确认',
  };
  return labels[stage] || stage;
}

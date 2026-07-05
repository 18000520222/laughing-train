import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN'];
const ALLOWED_ROLES = new Set(ADMIN_ROLES);

type BriefingTarget = {
  userId: string;
  line: string;
  link: string;
};

export async function POST(req: Request) {
  const auth = await requireAdminUser();
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const form = await req.formData();
  const itemIds = parsePriorityItemIds(form);
  if (itemIds.length === 0) return redirectBack(req, 'invalid', 0, 1);

  const admins = await prisma.user.findMany({
    where: { role: { in: ADMIN_ROLES as any }, isActive: true },
    select: { id: true },
  });
  const adminIds = admins.map((admin) => admin.id);
  const targets: BriefingTarget[] = [];
  let skipped = 0;

  for (const itemId of itemIds) {
    const [kind, targetId] = splitItemId(itemId);
    if (!kind || !targetId) {
      skipped++;
      continue;
    }
    const resolved = await resolveBriefingTarget(kind, targetId, adminIds);
    if (resolved.length === 0) skipped++;
    targets.push(...resolved);
  }

  const grouped = groupTargets(targets);
  if (grouped.length === 0) return redirectBack(req, 'empty', 0, skipped || itemIds.length);

  await prisma.notification.createMany({
    data: grouped.map((group) => ({
      userId: group.userId,
      type: 'SYSTEM' as any,
      title: '老板晨会摘要: 今日必须处理',
      body: group.lines.slice(0, 6).join('\n'),
      link: group.link,
    })),
  });

  return redirectBack(req, 'sent', grouped.length, skipped);
}

async function requireAdminUser() {
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

async function resolveBriefingTarget(kind: string, targetId: string, adminIds: string[]): Promise<BriefingTarget[]> {
  if (kind === 'MESSAGE_SLA') return messageTargets(targetId, adminIds);
  if (kind === 'OPPORTUNITY_STALL') return opportunityTargets(targetId, adminIds);
  if (kind === 'CUSTOMER_HEALTH') return companyTargets(targetId, adminIds);
  if (kind === 'SALES_TASK' || kind === 'EMAIL_ACTION' || kind === 'HEALTH_TASK') return taskTargets(targetId);
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

function redirectBack(req: Request, status: string, notified: number, skipped: number) {
  const url = new URL('/sales-command', req.url);
  url.searchParams.set('morningNotify', status);
  url.searchParams.set('morningNotified', String(notified));
  if (skipped > 0) url.searchParams.set('morningSkipped', String(skipped));
  url.hash = 'morning-briefing';
  return NextResponse.redirect(url);
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

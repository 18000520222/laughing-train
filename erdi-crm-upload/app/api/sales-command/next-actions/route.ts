import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { buildSalesRadar } from '@/lib/sales-radar';
import { buildCustomerHealthRow } from '@/lib/customer-health';
import { getSession } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { companyAccessWhere } from '@/lib/data-access';

export const dynamic = 'force-dynamic';

const ACTIVE_CUSTOMER_TYPES = ['INQUIRY', 'QUOTED', 'CONTRACT_SENT', 'PROSPECT', 'NEW'];
const HEALTH_CUSTOMER_TYPES = ['INQUIRY', 'QUOTED', 'CONTRACT_SENT', 'DEAL_WON', 'KEY_ACCOUNT', 'PROSPECT', 'NEW', 'EXISTING'];

export async function POST(req: Request) {
  const auth = await requireSalesUser();
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const form = await req.formData();
  const action = String(form.get('action') || 'next_action');
  const ids = parseIds(form.get('ids'));
  if (ids.length === 0) return redirectBack(req, 'empty', 0);

  const result = await createNextActionTasks(ids, auth.user.id, action, auth.session);
  return redirectBack(req, bulkResultKey(action), result.created, result.updated, result.skipped);
}

async function requireSalesUser() {
  const session = await getSession();
  if (!session || !can(session.role, 'sales.manage')) return null;
  return { user: { id: session.userId, email: session.email, name: session.name }, role: session.role, session };
}

async function createNextActionTasks(ids: string[], currentUserId: string, action: string, session: NonNullable<Awaited<ReturnType<typeof getSession>>>) {
  const typeScope = action === 'customer_health_repair' ? HEALTH_CUSTOMER_TYPES : ACTIVE_CUSTOMER_TYPES;
  const companies = await prisma.company.findMany({
    where: { ...companyAccessWhere(session), id: { in: ids }, type: { in: typeScope as any } },
    include: {
      owner: true,
      contacts: { take: 3, orderBy: { createdAt: 'asc' } },
      inboxMessages: { orderBy: { createdAt: 'desc' }, take: 6 },
      followUps: { orderBy: { createdAt: 'desc' }, take: 3 },
      opportunities: { orderBy: { updatedAt: 'desc' }, take: 6 },
      salesTasks: { where: { status: 'TODO' }, orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }], take: 3 },
      _count: { select: { inboxMessages: true, opportunities: true } },
    },
    orderBy: [{ priorityScore: 'desc' }, { updatedAt: 'asc' }],
  });

  let created = 0;
  let updated = 0;
  let skipped = ids.length - companies.length;
  for (const company of companies) {
    const radar = buildSalesRadar(company);
    const health = buildCustomerHealthRow(company);
    if (action === 'customer_health_repair' && health.shortfalls.length === 0 && health.score >= 75) {
      skipped++;
      continue;
    }
    const sourceRef = `${action}:${company.id}`;
    const existing = await prisma.salesTask.findFirst({
      where: { source: sourceFor(action), sourceRef, status: 'TODO' },
      select: { id: true },
    });
    if (existing) {
      skipped++;
      continue;
    }

    const ownerId = company.ownerId || currentUserId;
    if (!company.ownerId) {
      await prisma.company.update({ where: { id: company.id }, data: { ownerId } });
      updated++;
    }

    const recommendedAction = buildRecommendedNextAction(company, radar, health, action);
    if (!String(company.nextAction || '').trim()) {
      await prisma.company.update({
        where: { id: company.id },
        data: { nextAction: recommendedAction },
      });
      updated++;
    }

    const dueAt = new Date();
    dueAt.setHours(dueAt.getHours() + dueHoursFor(company, radar, health, action));
    await prisma.salesTask.create({
      data: {
        title: taskTitle(company.name, action, radar.title),
        description: taskDescription(company, radar, health, recommendedAction, action),
        type: taskType(action, radar, health),
        priority: taskPriority(action, radar, health),
        dueAt,
        ownerId,
        createdById: currentUserId,
        companyId: company.id,
        source: sourceFor(action),
        sourceRef,
      },
    });
    await prisma.notification.create({
      data: {
        userId: ownerId,
        type: 'SYSTEM',
        title: notificationTitle(action),
        body: `${company.name}: ${recommendedAction}`,
        link: '/tasks?view=week',
      },
    });
    created++;
  }

  return { created, updated, skipped };
}

function parseIds(value: FormDataEntryValue | null) {
  return Array.from(
    new Set(
      String(value || '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
    )
  ).slice(0, 100);
}

function redirectBack(req: Request, bulk: string, created: number, updated = 0, skipped = 0) {
  const url = new URL('/sales-command', req.url);
  url.searchParams.set('nextBulk', bulk);
  url.searchParams.set('created', String(created));
  url.searchParams.set('updated', String(updated));
  if (skipped > 0) url.searchParams.set('skipped', String(skipped));
  return NextResponse.redirect(url, { status: 303 });
}

function buildRecommendedNextAction(
  company: {
    nextAction: string | null;
    contacts: Array<{ email: string | null; phone: string | null }>;
  },
  radar: ReturnType<typeof buildSalesRadar>,
  health: ReturnType<typeof buildCustomerHealthRow>,
  action: string
) {
  if (action === 'customer_health_repair') return health.action;
  if (String(company.nextAction || '').trim()) return String(company.nextAction);
  if (action === 'stale_reactivate') {
    return '发送唤醒邮件或 WhatsApp,带最新产品/案例/交付能力,确认项目是否继续推进。';
  }
  if (radar.metrics.awaitingReply) return radar.recommendedAction;
  const contact = company.contacts.find((item) => item.email || item.phone);
  if (contact?.email) return `给 ${contact.email} 发送跟进邮件,确认需求、预算、交期和下一步资料。`;
  if (contact?.phone) return `通过电话/WhatsApp 联系 ${contact.phone},确认需求、预算、交期和下一步资料。`;
  return radar.recommendedAction;
}

function dueHoursFor(
  company: { priorityScore: number | null },
  radar: ReturnType<typeof buildSalesRadar>,
  health: ReturnType<typeof buildCustomerHealthRow>,
  action: string
) {
  if (action === 'customer_health_repair') {
    if (health.score < 55 || health.stalledOpportunityCount > 0 || health.overdueTaskCount > 0 || !health.hasOwner) return 24;
    if (health.score < 75) return 48;
    return 72;
  }
  if (radar.metrics.awaitingReply || radar.level === 'hot' || radar.level === 'risk') return 24;
  if (action === 'stale_reactivate') return 72;
  if ((company.priorityScore || 0) >= 60) return 48;
  return 96;
}

function taskTitle(companyName: string, action: string, radarTitle: string) {
  if (action === 'customer_health_repair') return `修复客户健康短板: ${companyName}`;
  if (action === 'stale_reactivate') return `激活沉睡客户: ${companyName}`;
  return `补齐下一步动作: ${companyName} (${radarTitle})`;
}

function taskDescription(
  company: {
    name: string;
    type: string;
    source: string;
    priorityScore: number | null;
    owner: { name: string | null; email: string } | null;
    contacts: Array<{ email: string | null; phone: string | null }>;
  },
  radar: ReturnType<typeof buildSalesRadar>,
  health: ReturnType<typeof buildCustomerHealthRow>,
  nextAction: string,
  action: string
) {
  const base = [
    `客户: ${company.name}`,
    `类型/来源: ${company.type} / ${company.source}`,
    `负责人: ${company.owner?.name || company.owner?.email || '当前执行人'}`,
    `优先级分: ${company.priorityScore || 0}`,
    `联系人: ${company.contacts.map((item) => item.email || item.phone).filter(Boolean).join(', ') || '-'}`,
  ];
  const healthLines =
    action === 'customer_health_repair'
      ? [
          `客户健康度: ${health.score}`,
          `五点短板: ${health.shortfalls.join('、') || '暂无明显短板'}`,
          `五维得分: 资料${health.fitScore}/20, 联系人${health.contactScore}/20, 互动${health.engagementScore}/20, 商机${health.pipelineScore}/20, 下一步${health.ownerScore}/20`,
        ]
      : [];
  return [
    ...base,
    ...healthLines,
    `雷达: ${radar.levelLabel} · ${radar.score} · ${radar.title}`,
    `建议动作: ${nextAction}`,
    '',
    '原因:',
    ...(action === 'customer_health_repair' ? health.shortfalls.map((item) => `- 体检短板: ${item}`) : radar.reasons.map((reason) => `- ${reason}`)),
  ].join('\n');
}

function bulkResultKey(action: string) {
  if (action === 'stale_reactivate') return 'reactivated';
  if (action === 'customer_health_repair') return 'health_repaired';
  return 'planned';
}

function sourceFor(action: string) {
  return action === 'customer_health_repair' ? 'CUSTOMER_HEALTH_BULK' : 'NEXT_ACTION_BULK';
}

function taskType(action: string, radar: ReturnType<typeof buildSalesRadar>, health: ReturnType<typeof buildCustomerHealthRow>) {
  if (action === 'customer_health_repair') {
    if (health.score < 55 || health.stalledOpportunityCount > 0 || health.overdueTaskCount > 0) return 'RISK_RESCUE';
    return 'FOLLOW_UP';
  }
  if (radar.metrics.awaitingReply) return 'EMAIL';
  if (action === 'stale_reactivate') return 'RISK_RESCUE';
  return 'FOLLOW_UP';
}

function taskPriority(action: string, radar: ReturnType<typeof buildSalesRadar>, health: ReturnType<typeof buildCustomerHealthRow>) {
  if (action === 'customer_health_repair') {
    if (health.score < 55 || health.stalledOpportunityCount > 0 || health.overdueTaskCount > 0 || !health.hasOwner) return 'URGENT';
    if (health.score < 75) return 'HIGH';
    return 'NORMAL';
  }
  return radar.level === 'hot' || radar.level === 'risk' ? 'HIGH' : 'NORMAL';
}

function notificationTitle(action: string) {
  if (action === 'customer_health_repair') return '已生成客户健康修复任务';
  if (action === 'stale_reactivate') return '已生成沉睡客户激活任务';
  return '已生成客户下一步任务';
}

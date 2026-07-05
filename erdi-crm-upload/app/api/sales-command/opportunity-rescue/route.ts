import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import type { SalesTaskPriority, SalesTaskType } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'SALES']);
const OPEN_STAGES = ['UNPROCESSED', 'REPLIED', 'QUOTING', 'NEGOTIATING', 'SPEC_CONFIRMING'];
const SOURCE = 'OPPORTUNITY_RESCUE_BULK';

const STAGE_LABEL: Record<string, string> = {
  UNPROCESSED: '未处理',
  REPLIED: '已回复',
  QUOTING: '报价中',
  NEGOTIATING: '谈判中',
  SPEC_CONFIRMING: '规格确认',
  CLOSED_WON: '已成交',
  CLOSED_LOST: '已流失',
};

export async function POST(req: Request) {
  const auth = await requireOpportunityRescueUser();
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const form = await req.formData();
  const action = String(form.get('action') || 'rescue_stale');
  const ids = parseIds(form.get('ids'));
  if (ids.length === 0) return redirectBack(req, 'empty', 0);

  const result = await rescueOpportunities(ids, auth.user.id, action);
  return redirectBack(req, action === 'rescue_priority' ? 'priority' : 'rescued', result.created, result.updated, result.skipped);
}

async function requireOpportunityRescueUser() {
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

async function rescueOpportunities(ids: string[], currentUserId: string, action: string) {
  const opportunities = await prisma.opportunity.findMany({
    where: { id: { in: ids }, stage: { in: OPEN_STAGES as any } },
    include: {
      company: { include: { owner: true, contacts: { take: 2, orderBy: { createdAt: 'asc' } } } },
      owner: true,
      product: true,
    },
    orderBy: [{ stageChangedAt: 'asc' }, { amountUSD: 'desc' }],
  });

  let created = 0;
  let updated = 0;
  let skipped = ids.length - opportunities.length;
  for (const opportunity of opportunities) {
    const sourceRef = `${action}:${opportunity.id}`;
    const existing = await prisma.salesTask.findFirst({
      where: { source: SOURCE, sourceRef, status: 'TODO' },
      select: { id: true },
    });
    if (existing) {
      skipped++;
      continue;
    }

    const ownerId = opportunity.ownerId || opportunity.company.ownerId || currentUserId;
    const patch: { ownerId?: string; nextStep?: string } = {};
    const recommendation = buildOpportunityRescueAction(opportunity);
    if (!opportunity.ownerId) patch.ownerId = ownerId;
    if (!String(opportunity.nextStep || '').trim()) patch.nextStep = recommendation;
    if (Object.keys(patch).length > 0) {
      await prisma.opportunity.update({ where: { id: opportunity.id }, data: patch });
      updated++;
    }
    if (!opportunity.company.ownerId) {
      await prisma.company.update({ where: { id: opportunity.companyId }, data: { ownerId } });
      updated++;
    }

    const ageDays = stageAgeDays(opportunity.stageChangedAt || opportunity.updatedAt);
    const dueAt = new Date();
    dueAt.setHours(dueAt.getHours() + dueHoursFor(opportunity, ageDays));
    await prisma.salesTask.create({
      data: {
        title: `救援停滞商机: ${opportunity.title}`,
        description: taskDescription(opportunity, recommendation, ageDays),
        type: taskType(opportunity.stage, ageDays),
        priority: taskPriority(opportunity.amountUSD || 0, opportunity.stage, ageDays),
        dueAt,
        ownerId,
        createdById: currentUserId,
        companyId: opportunity.companyId,
        opportunityId: opportunity.id,
        source: SOURCE,
        sourceRef,
      },
    });
    await prisma.notification.create({
      data: {
        userId: ownerId,
        type: 'SYSTEM',
        title: '已生成商机停滞救援任务',
        body: `${opportunity.company.name}: ${opportunity.title} 已停留 ${ageDays} 天, ${recommendation}`,
        link: `/opportunity/${opportunity.id}`,
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
  url.searchParams.set('oppBulk', bulk);
  url.searchParams.set('created', String(created));
  url.searchParams.set('updated', String(updated));
  if (skipped > 0) url.searchParams.set('skipped', String(skipped));
  return NextResponse.redirect(url, { status: 303 });
}

function buildOpportunityRescueAction(opportunity: {
  stage: string;
  nextStep: string | null;
  company: { contacts: Array<{ email: string | null; phone: string | null }> };
  product: { name: string } | null;
}) {
  if (String(opportunity.nextStep || '').trim()) return String(opportunity.nextStep);
  const contact = opportunity.company.contacts.find((item) => item.email || item.phone);
  const contactText = contact?.email ? `邮件联系 ${contact.email}` : contact?.phone ? `电话/WhatsApp 联系 ${contact.phone}` : '补齐联系人后联系客户';
  const productText = opportunity.product?.name ? `围绕 ${opportunity.product.name}` : '围绕当前需求';
  if (opportunity.stage === 'UNPROCESSED') return `${contactText},先完成首轮回复,确认需求、预算、交期和决策人。`;
  if (opportunity.stage === 'REPLIED') return `${productText}整理报价前问题清单,约定下一次回复时间。`;
  if (opportunity.stage === 'QUOTING') return `${contactText},确认报价/PI是否收到,补充交期、付款方式、认证和样品方案。`;
  if (opportunity.stage === 'NEGOTIATING') return '把价格、付款、交期、质保和决策人逐项列出,当天给出成交推进方案。';
  if (opportunity.stage === 'SPEC_CONFIRMING') return '整理规格差异、认证材料和测试资料,让客户确认最终配置并锁定下一步。';
  return `${contactText},确认项目是否继续推进并写明下一步动作。`;
}

function taskDescription(
  opportunity: {
    title: string;
    stage: string;
    amountUSD: number | null;
    nextStep: string | null;
    company: { name: string; source: string; owner: { name: string | null; email: string } | null; contacts: Array<{ email: string | null; phone: string | null }> };
    owner: { name: string | null; email: string } | null;
    product: { name: string } | null;
    stageChangedAt: Date;
  },
  recommendation: string,
  ageDays: number
) {
  const contacts = opportunity.company.contacts.map((item) => item.email || item.phone).filter(Boolean).join(', ') || '-';
  return [
    `商机: ${opportunity.title}`,
    `客户: ${opportunity.company.name}`,
    `来源: ${opportunity.company.source}`,
    `阶段: ${STAGE_LABEL[opportunity.stage] || opportunity.stage}`,
    `阶段停留: ${ageDays} 天`,
    `阶段更新时间: ${opportunity.stageChangedAt.toISOString()}`,
    `金额: $${Math.round(opportunity.amountUSD || 0).toLocaleString()}`,
    `产品: ${opportunity.product?.name || '-'}`,
    `负责人: ${opportunity.owner?.name || opportunity.owner?.email || opportunity.company.owner?.name || opportunity.company.owner?.email || '当前执行人'}`,
    `联系人: ${contacts}`,
    `当前下一步: ${opportunity.nextStep || '-'}`,
    '',
    `救援动作: ${recommendation}`,
    '',
    '核对清单:',
    '- 今天内确认客户是否收到上一轮报价/资料',
    '- 明确预算、交期、认证、规格和决策人',
    '- 把阻塞原因写入跟进记录,必要时升级给管理者',
  ].join('\n');
}

function stageAgeDays(date: Date) {
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
}

function dueHoursFor(opportunity: { amountUSD: number | null; stage: string }, ageDays: number) {
  if (ageDays >= 14 || (opportunity.amountUSD || 0) >= 10000 || opportunity.stage === 'NEGOTIATING') return 24;
  if (opportunity.stage === 'SPEC_CONFIRMING' || opportunity.stage === 'QUOTING') return 36;
  return 48;
}

function taskType(stage: string, ageDays: number): SalesTaskType {
  if (ageDays >= 14 || stage === 'NEGOTIATING' || stage === 'SPEC_CONFIRMING') return 'RISK_RESCUE';
  if (stage === 'QUOTING') return 'QUOTE';
  return 'FOLLOW_UP';
}

function taskPriority(amountUSD: number, stage: string, ageDays: number): SalesTaskPriority {
  if (ageDays >= 14 || amountUSD >= 10000 || stage === 'NEGOTIATING') return 'URGENT';
  if (ageDays >= 7 || stage === 'QUOTING' || stage === 'SPEC_CONFIRMING') return 'HIGH';
  return 'NORMAL';
}

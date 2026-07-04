import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createDefaultSalesAssignmentRules, executeSalesAssignmentRules } from '@/lib/sales-assignment';
import { emailCategoryLabel } from '@/lib/email-classifier';
import { buildSalesRadar } from '@/lib/sales-radar';

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

export default async function SalesCommandPage() {
  const role = (cookies().get('auth_role')?.value || '').toUpperCase();
  if (role !== 'SUPER_ADMIN' && role !== 'ADMIN' && role !== 'SALES') redirect('/dashboard');
  const canManage = role === 'SUPER_ADMIN' || role === 'ADMIN';

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
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
    staleOpportunities,
    lostReasonRows,
    emailCategoryRows,
    actionEmailCount,
    leadEmailCount,
    unclassifiedEmailCount,
    openTaskCount,
    overdueTaskCount,
    todayTaskCount,
    salesTasks,
    ownerRows,
    sourceRows,
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
    prisma.emailMessage.groupBy({
      by: ['category'],
      _count: { _all: true },
      orderBy: { _count: { category: 'desc' } },
      take: 12,
    }),
    prisma.emailMessage.count({ where: { actionRequired: true } }),
    prisma.emailMessage.count({ where: { isLead: true } }),
    prisma.emailMessage.count({ where: { category: 'UNCLASSIFIED' } }),
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
  ]);

  const usersById = new Map(users.map((u) => [u.id, u]));
  const assignedTotal = ownerRows.reduce((sum, r) => sum + r._count._all, 0);
  const salesRadarItems = topQueue
    .map((company) => ({ company, radar: buildSalesRadar(company) }))
    .sort((a, b) => b.radar.score - a.radar.score)
    .slice(0, 6);

  return (
    <div className="min-h-screen bg-gray-50 p-6 md:p-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">销售指挥台</h1>
          <p className="text-sm text-gray-500 mt-1">线索分配、跟进 SLA、客户优先级和团队负载集中处理</p>
        </div>
        <div className="flex gap-2">
          <Link href="/customers" className="px-4 py-2 rounded-lg border border-gray-200 bg-white text-gray-700 text-sm font-bold hover:bg-gray-50">客户列表</Link>
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

      <section className="mb-6 bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-gray-900">Gmail / 邮件分类审计</h2>
            <p className="text-xs text-gray-400 mt-1">从 EmailMessage 表统计,用于区分询盘、报价、订单、财务、物流、平台通知和营销噪音</p>
          </div>
          <div className="flex gap-2 text-xs font-bold">
            <span className="rounded-lg bg-rose-50 px-3 py-2 text-rose-700">待处理 {actionEmailCount}</span>
            <span className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-700">线索 {leadEmailCount}</span>
            <span className="rounded-lg bg-gray-100 px-3 py-2 text-gray-600">未分类 {unclassifiedEmailCount}</span>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {emailCategoryRows.map((row) => (
            <div key={row.category} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
              <div className="text-xs font-bold text-gray-500">{emailCategoryLabel(row.category)}</div>
              <div className="mt-1 text-2xl font-black text-gray-900">{row._count._all}</div>
            </div>
          ))}
          {emailCategoryRows.length === 0 && <div className="text-sm text-gray-400">暂无邮件分类数据。</div>}
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

      <section className="mt-6 grid grid-cols-1 xl:grid-cols-[1fr_0.8fr] gap-6">
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

import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';

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
  const owners = await prisma.user.findMany({
    where: { role: { in: ['SUPER_ADMIN', 'ADMIN', 'SALES'] as any }, isActive: true },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    select: { id: true },
  });
  const ownerIds = owners.map((u) => u.id);
  if (ownerIds.length === 0) return;

  const templates = [
    {
      name: '高优先级询盘优先分配',
      description: '优先级评分 >= 70 的新询盘先分给当前客户负载最少的业务员。',
      priority: 10,
      customerTypes: ['INQUIRY', 'QUOTED', 'PROSPECT', 'NEW'],
      minPriorityScore: 70,
      sources: [] as string[],
      distribution: 'LOWEST_LOAD',
    },
    {
      name: '邮件/Gmail 询盘轮流分配',
      description: '来自邮箱聚合的新询盘按轮流方式分配,避免客户无人跟。',
      priority: 20,
      customerTypes: ['INQUIRY', 'PROSPECT', 'NEW'],
      minPriorityScore: 0,
      sources: ['EMAIL', 'GMAIL_INBOX'],
      distribution: 'ROUND_ROBIN',
    },
    {
      name: '重点渠道线索轮流分配',
      description: '阿里、WhatsApp、LinkedIn、Facebook 等渠道线索进入销售队列。',
      priority: 30,
      customerTypes: ['INQUIRY', 'PROSPECT', 'NEW'],
      minPriorityScore: 0,
      sources: ['ALIBABA', 'WHATSAPP', 'LINKEDIN', 'FACEBOOK'],
      distribution: 'ROUND_ROBIN',
    },
  ];

  for (const tpl of templates) {
    const exists = await prisma.salesAssignmentRule.findFirst({ where: { name: tpl.name } });
    if (exists) continue;
    await prisma.salesAssignmentRule.create({
      data: {
        ...tpl,
        customerTypes: tpl.customerTypes as any,
        countries: [],
        ownerIds,
        distribution: tpl.distribution as any,
        createdById: user?.id || null,
      },
    });
  }

  redirect('/sales-command');
}

async function executeAssignmentRules() {
  'use server';
  await requireAdminUser();

  const [rules, candidates, salesUsers] = await Promise.all([
    prisma.salesAssignmentRule.findMany({ where: { isActive: true }, orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] }),
    prisma.company.findMany({
      where: { ownerId: null },
      orderBy: [{ priorityScore: 'desc' }, { createdAt: 'desc' }],
      take: 200,
      include: { _count: { select: { inboxMessages: true, opportunities: true } } },
    }),
    prisma.user.findMany({ where: { role: { in: ['SUPER_ADMIN', 'ADMIN', 'SALES'] as any }, isActive: true }, select: { id: true, name: true, email: true } }),
  ]);

  const ownerLoad = new Map(
    await Promise.all(
      salesUsers.map(async (u) => [u.id, await prisma.company.count({ where: { ownerId: u.id } })] as const)
    )
  );
  const usersById = new Map(salesUsers.map((u) => [u.id, u]));
  const runStats = new Map<string, { scannedCount: number; assignedCount: number; customers: string[] }>();

  const matches = (rule: any, company: any) => {
    if (company.priorityScore < rule.minPriorityScore) return false;
    if (rule.customerTypes.length > 0 && !rule.customerTypes.includes(company.type)) return false;
    if (rule.countries.length > 0) {
      const country = String(company.country || '').toLowerCase();
      if (!rule.countries.some((c: string) => country.includes(c.toLowerCase()))) return false;
    }
    if (rule.sources.length > 0) {
      const source = String(company.source || '').toLowerCase();
      if (!rule.sources.some((s: string) => source.includes(s.toLowerCase()))) return false;
    }
    return true;
  };

  const pickOwner = (rule: any) => {
    const ownerIds = rule.ownerIds.filter((id: string) => usersById.has(id));
    if (ownerIds.length === 0) return null;
    if (rule.distribution === 'FIXED_OWNER') return ownerIds[0];
    if (rule.distribution === 'LOWEST_LOAD') {
      return ownerIds.sort((a: string, b: string) => (ownerLoad.get(a) || 0) - (ownerLoad.get(b) || 0))[0];
    }
    const lastIndex = ownerIds.indexOf(rule.lastAssignedOwnerId || '');
    return ownerIds[(lastIndex + 1) % ownerIds.length];
  };

  for (const company of candidates) {
    for (const rule of rules) {
      const stat = runStats.get(rule.id) || { scannedCount: 0, assignedCount: 0, customers: [] };
      stat.scannedCount++;
      runStats.set(rule.id, stat);
      if (!matches(rule, company)) continue;

      const ownerId = pickOwner(rule);
      if (!ownerId) continue;
      const nextAction = company.nextAction || (company.priorityScore >= 70 ? '高优先级询盘:今天内完成首轮跟进' : '新线索:24小时内完成首轮跟进');

      await prisma.company.update({
        where: { id: company.id },
        data: {
          ownerId,
          nextAction,
          priorityScore: Math.max(company.priorityScore || 0, company._count.inboxMessages > 0 ? 60 : 0),
        },
      });
      await prisma.notification.create({
        data: {
          userId: ownerId,
          type: 'SYSTEM',
          title: '新客户已分配',
          body: `${company.name} 已按规则「${rule.name}」分配给你。下一步:${nextAction}`,
          link: `/customers/${company.id}`,
        },
      });
      await prisma.salesAssignmentRule.update({ where: { id: rule.id }, data: { lastAssignedOwnerId: ownerId } });

      ownerLoad.set(ownerId, (ownerLoad.get(ownerId) || 0) + 1);
      stat.assignedCount++;
      stat.customers.push(company.name);
      break;
    }
  }

  for (const rule of rules) {
    const stat = runStats.get(rule.id) || { scannedCount: 0, assignedCount: 0, customers: [] };
    await prisma.salesAssignmentRun.create({
      data: {
        ruleId: rule.id,
        scannedCount: stat.scannedCount,
        assignedCount: stat.assignedCount,
        summary: { customers: stat.customers.slice(0, 20) },
      },
    });
  }

  redirect('/sales-command');
}

export default async function SalesCommandPage() {
  const role = (cookies().get('auth_role')?.value || '').toUpperCase();
  if (role !== 'SUPER_ADMIN' && role !== 'ADMIN' && role !== 'SALES') redirect('/dashboard');
  const canManage = role === 'SUPER_ADMIN' || role === 'ADMIN';

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const [
    users,
    rules,
    recentRuns,
    unassignedCount,
    highPriorityUnassigned,
    needsNextAction,
    staleCustomers,
    topQueue,
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
      include: { owner: true, contacts: { take: 1 }, _count: { select: { inboxMessages: true, opportunities: true } } },
    }),
    prisma.company.groupBy({ by: ['ownerId'], _count: { _all: true } }),
    prisma.company.groupBy({ by: ['source'], _count: { _all: true }, orderBy: { _count: { source: 'desc' } }, take: 8 }),
  ]);

  const usersById = new Map(users.map((u) => [u.id, u]));
  const assignedTotal = ownerRows.reduce((sum, r) => sum + r._count._all, 0);

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
        <Metric label="7天未动询盘" value={staleCustomers} tone="violet" />
        <Metric label="已分配客户" value={assignedTotal} tone="emerald" />
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

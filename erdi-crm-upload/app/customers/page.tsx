import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ensureCustomerCode } from '@/lib/customer-code';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 30;

const TYPE_LABEL: Record<string, string> = {
  INQUIRY: '询盘客户',
  QUOTED: '已报价客户',
  CONTRACT_SENT: '已发合同客户',
  DEAL_WON: '已成交客户',
  NEW: '新客户',
  EXISTING: '已成交/老客户',
  PROSPECT: '潜在客户',
  KEY_ACCOUNT: '老客户/大客户',
  LOST: '流失客户',
};

const TYPE_STYLE: Record<string, string> = {
  INQUIRY: 'bg-blue-50 text-blue-700 border-blue-100',
  QUOTED: 'bg-violet-50 text-violet-700 border-violet-100',
  CONTRACT_SENT: 'bg-orange-50 text-orange-700 border-orange-100',
  DEAL_WON: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  NEW: 'bg-sky-50 text-sky-700 border-sky-100',
  EXISTING: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  PROSPECT: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  KEY_ACCOUNT: 'bg-amber-50 text-amber-700 border-amber-100',
  LOST: 'bg-rose-50 text-rose-700 border-rose-100',
};

const CUSTOMER_SEGMENTS = [
  { key: 'inquiry', label: '询盘客户', types: ['INQUIRY', 'PROSPECT', 'NEW'] },
  { key: 'quoted', label: '已报价客户', types: ['QUOTED'] },
  { key: 'contract', label: '已发合同客户', types: ['CONTRACT_SENT'] },
  { key: 'won', label: '已成交客户', types: ['DEAL_WON', 'EXISTING'] },
  { key: 'key', label: '老客户/大客户', types: ['KEY_ACCOUNT'] },
];

async function addCustomer(formData: FormData) {
  'use server';
  const role = (cookies().get('auth_role')?.value || '').toUpperCase();
  if (role !== 'SALES' && role !== 'SUPER_ADMIN' && role !== 'ADMIN') return;

  const s = (k: string) => {
    const v = formData.get(k);
    const str = v === null ? '' : String(v).trim();
    return str === '' ? null : str;
  };

  const name = s('name');
  if (!name) return;

  const customerCode = await ensureCustomerCode(s('customerCode'));

  const company = await prisma.company.create({
    data: {
      name,
      customerCode,
      type: (s('type') as any) || 'INQUIRY',
      country: s('country'),
      industry: s('industry'),
      website: s('website'),
      source: 'MANUAL',
    },
  });

  // 可选：同时创建首个联系人
  const contactFirst = s('contactFirstName');
  const contactEmail = s('contactEmail');
  if (contactFirst && contactEmail) {
    const exists = await prisma.contact.findUnique({ where: { email: contactEmail } });
    if (!exists) {
      await prisma.contact.create({
        data: {
          firstName: contactFirst,
          lastName: s('contactLastName'),
          email: contactEmail,
          phone: s('contactPhone'),
          title: s('contactTitle'),
          companyId: company.id,
        },
      });
    }
  }

  redirect(`/customers/${company.id}`);
}

export default async function CustomersPage(props: any) {
  const role = (cookies().get('auth_role')?.value || '').toUpperCase();
  if (role !== 'SALES' && role !== 'SUPER_ADMIN' && role !== 'ADMIN') {
    redirect('/');
  }

  const sp = props.searchParams || {};
  const q = String(sp.q || '').trim();
  const segment = String(sp.segment || '').trim();
  const page = Math.max(1, parseInt(String(sp.page || '1'), 10) || 1);
  const activeSegment = CUSTOMER_SEGMENTS.find((item) => item.key === segment);

  const where: any = {};
  if (q) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' as const } },
      { customerCode: { contains: q, mode: 'insensitive' as const } },
      { country: { contains: q, mode: 'insensitive' as const } },
      { source: { contains: q, mode: 'insensitive' as const } },
      { owner: { email: { contains: q, mode: 'insensitive' as const } } },
      { contacts: { some: { email: { contains: q, mode: 'insensitive' as const } } } },
    ];
  }
  if (activeSegment) where.type = { in: activeSegment.types as any };

  const [total, customers, typeCounts, unassignedCount, healthCustomers] = await Promise.all([
    prisma.company.count({ where }),
    prisma.company.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { contacts: true, owner: true, _count: { select: { opportunities: true, inboxMessages: true } } },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.company.groupBy({ by: ['type'], _count: { _all: true } }),
    prisma.company.count({ where: { ownerId: null } }),
    prisma.company.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 500,
      include: {
        contacts: { orderBy: { createdAt: 'asc' }, take: 3 },
        owner: true,
        opportunities: {
          orderBy: { updatedAt: 'desc' },
          take: 8,
          select: { id: true, title: true, stage: true, amountUSD: true, stageChangedAt: true, updatedAt: true },
        },
        followUps: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
        inboxMessages: { orderBy: { createdAt: 'desc' }, take: 3, select: { direction: true, sentAt: true, createdAt: true } },
        salesTasks: { where: { status: 'TODO' }, orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }], take: 3, select: { dueAt: true, priority: true } },
      },
    }),
  ]);

  const countByType = Object.fromEntries(typeCounts.map((item) => [item.type, item._count._all]));
  const countBySegment = Object.fromEntries(
    CUSTOMER_SEGMENTS.map((item) => [item.key, item.types.reduce((sum, t) => sum + (countByType[t] || 0), 0)])
  );
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = (extra: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (segment) params.set('segment', segment);
    Object.entries(extra).forEach(([key, value]) => {
      if (value !== undefined && value !== '') params.set(key, String(value));
      if (value === '') params.delete(key);
    });
    return params.toString();
  };
  const mkHref = (p: number) => `/customers?${qs({ page: p })}`;
  const healthReport = buildCustomerHealthReport(healthCustomers);

  return (
    <div className="min-h-screen bg-gray-50 p-6 md:p-8">
      <header className="mb-6 flex flex-wrap justify-between items-center gap-4 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 tracking-tight">👥 客户管理中心</h1>
          <p className="text-sm text-gray-500 mt-1">共 {total} 家客户{q ? `（搜索 “${q}”）` : ''}{activeSegment ? ` · ${activeSegment.label}` : ''}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/import" className="bg-blue-50 text-blue-700 border border-blue-200 px-4 py-2 rounded-lg font-bold hover:bg-blue-100 transition-all">
            📥 批量导入
          </Link>
          <a href={`/api/customers/export${q ? `?q=${encodeURIComponent(q)}` : ''}`} className="bg-green-50 text-green-700 border border-green-200 px-4 py-2 rounded-lg font-bold hover:bg-green-100 transition-all">
            📤 导出CSV
          </a>
          <Link href="/dashboard" className="bg-gray-800 text-white px-4 py-2 rounded-lg font-bold hover:bg-gray-700 transition-all">
            返回看板
          </Link>
        </div>
      </header>

      <section className="mb-6 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-bold text-gray-900">客户五点体检</h2>
            <p className="mt-1 text-xs text-gray-500">按资料完整、联系人、互动热度、商机推进、下一步/负责人五个维度给客户打分,优先处理最影响成交的缺口。</p>
          </div>
          <span className={`rounded-lg px-3 py-2 text-xs font-black ${healthReport.avgScore >= 75 ? 'bg-emerald-50 text-emerald-700' : healthReport.avgScore >= 55 ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'}`}>
            平均健康度 {healthReport.avgScore}
          </span>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <HealthMetric label="体检客户" value={healthReport.customerCount} detail="当前筛选样本" tone="blue" />
          <HealthMetric label="高意向客户" value={healthReport.hotCount} detail="高分且有近期信号" tone={healthReport.hotCount > 0 ? 'emerald' : 'slate'} />
          <HealthMetric label="需补资料" value={healthReport.missingProfileCount} detail="画像/产品/国家/行业缺口" tone={healthReport.missingProfileCount > 0 ? 'amber' : 'emerald'} />
          <HealthMetric label="未分配" value={healthReport.unassignedCount} detail="没有负责人" tone={healthReport.unassignedCount > 0 ? 'rose' : 'emerald'} />
          <HealthMetric label="无下一步" value={healthReport.noNextActionCount} detail="缺少可执行动作" tone={healthReport.noNextActionCount > 0 ? 'amber' : 'emerald'} />
          <HealthMetric label="沉睡/停滞" value={healthReport.staleCount} detail="互动或商机超过30天" tone={healthReport.staleCount > 0 ? 'rose' : 'emerald'} />
        </div>
        <div className="mt-4 rounded-xl bg-gray-50 px-4 py-3 text-xs font-bold text-gray-600">{healthReport.recommendation}</div>
        <div className="mt-4 grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="overflow-hidden rounded-xl border border-gray-100">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs font-black text-gray-500">
                <tr>
                  <th className="p-3">重点客户</th>
                  <th className="p-3">健康度</th>
                  <th className="p-3">五点短板</th>
                  <th className="p-3">建议动作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {healthReport.priorityRows.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="p-3">
                      <Link href={`/customers/${row.id}`} className="font-black text-gray-900 hover:text-indigo-700">{row.name}</Link>
                      <div className="mt-0.5 text-[11px] font-bold text-gray-400">{row.typeLabel} · {row.ownerLabel}</div>
                    </td>
                    <td className="p-3">
                      <div className={`inline-flex min-w-12 justify-center rounded-full px-2 py-1 text-xs font-black ${row.score >= 75 ? 'bg-emerald-50 text-emerald-700' : row.score >= 55 ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'}`}>{row.score}</div>
                    </td>
                    <td className="p-3 text-xs font-bold text-gray-600">{row.shortfalls.join('、') || '无明显短板'}</td>
                    <td className="p-3 text-xs font-bold text-gray-600">{row.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {healthReport.priorityRows.length === 0 && <div className="p-8 text-center text-sm font-bold text-gray-400">当前筛选下暂无可体检客户。</div>}
          </div>
          <div className="rounded-xl border border-gray-100 p-4">
            <h3 className="text-xs font-black text-gray-500">五点覆盖</h3>
            <div className="mt-3 space-y-3">
              {healthReport.dimensionRows.map((row) => (
                <HealthBar key={row.key} label={row.label} value={row.avgScore} max={100} detail={`${row.passCount}/${healthReport.customerCount || 0} 达标`} />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 手动新增客户 */}
      <details className="mb-6 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden group">
        <summary className="cursor-pointer select-none px-6 py-4 font-bold text-gray-800 hover:bg-gray-50 flex items-center gap-2">
          <span className="text-indigo-600">➕</span> 手动新增客户
          <span className="text-xs font-normal text-gray-400 ml-2">（人工录入，可自行填写客户编号）</span>
        </summary>
        <form action={addCustomer} className="px-6 pb-6 pt-2 border-t border-gray-100">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">公司名称 *</label>
              <input name="name" required placeholder="如：Optisiv Ltd" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">客户编号</label>
              <input name="customerCode" placeholder="留空自动生成 CUST-年-序号" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">客户类型</label>
              <select name="type" defaultValue="INQUIRY" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none bg-white">
                <option value="INQUIRY">询盘客户</option>
                <option value="QUOTED">已报价客户</option>
                <option value="CONTRACT_SENT">已发合同客户</option>
                <option value="DEAL_WON">已成交客户</option>
                <option value="KEY_ACCOUNT">老客户/大客户</option>
                <option value="PROSPECT">潜在客户(旧)</option>
                <option value="NEW">新客户(旧)</option>
                <option value="EXISTING">老客户(旧)</option>
                <option value="LOST">流失客户</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">国家 / 地区</label>
              <input name="country" placeholder="如：United States" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">行业</label>
              <input name="industry" placeholder="如：光电 / 安防" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">官网</label>
              <input name="website" placeholder="https://..." className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-dashed border-gray-200">
            <p className="text-xs font-semibold text-gray-400 mb-3">主要联系人（选填）</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <input name="contactFirstName" placeholder="联系人名" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
              <input name="contactLastName" placeholder="联系人姓" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
              <input name="contactTitle" placeholder="职位" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
              <input name="contactEmail" type="email" placeholder="邮箱（填了才创建联系人）" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
              <input name="contactPhone" placeholder="电话" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
            </div>
          </div>

          <button type="submit" className="mt-5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-6 py-2.5 rounded-lg transition-all">
            保存客户
          </button>
        </form>
      </details>

      <section className="mb-6 grid grid-cols-2 md:grid-cols-7 gap-3">
        <SegmentCard href={`/customers?${qs({ segment: '', page: 1 })}`} active={!segment} label="全部客户" value={Object.values(countByType).reduce((sum, n) => sum + n, 0)} />
        {CUSTOMER_SEGMENTS.map((item) => (
          <SegmentCard key={item.key} href={`/customers?${qs({ segment: item.key, page: 1 })}`} active={segment === item.key} label={item.label} value={countBySegment[item.key] || 0} />
        ))}
        <SegmentCard href="/omnibox" active={false} label="待分配客户" value={unassignedCount} />
      </section>

      {/* 搜索栏 */}
      <form action="/customers" method="get" className="mb-6 flex gap-3">
        {segment && <input type="hidden" name="segment" value={segment} />}
        <input
          name="q"
          defaultValue={q}
          placeholder="搜索公司名称 / 客户编号 / 国家 / 联系人邮箱…"
          className="flex-1 bg-white border-2 border-gray-200 rounded-xl px-4 py-3 text-gray-800 focus:border-indigo-500 focus:outline-none transition-all"
        />
        <button type="submit" className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-6 rounded-xl transition-all">
          搜索
        </button>
        {q && (
          <Link href="/customers" className="flex items-center px-4 text-gray-500 hover:text-gray-800 font-medium">
            清除
          </Link>
        )}
      </form>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="p-4 font-bold text-gray-600 text-sm">客户编号</th>
              <th className="p-4 font-bold text-gray-600 text-sm">公司名称</th>
              <th className="p-4 font-bold text-gray-600 text-sm">类型</th>
              <th className="p-4 font-bold text-gray-600 text-sm">优先级/下一步</th>
              <th className="p-4 font-bold text-gray-600 text-sm">国家</th>
              <th className="p-4 font-bold text-gray-600 text-sm">来源/负责人</th>
              <th className="p-4 font-bold text-gray-600 text-sm">主要联系人</th>
              <th className="p-4 font-bold text-gray-600 text-sm">邮件/商机</th>
              <th className="p-4 font-bold text-gray-600 text-sm">操作</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                <td className="p-4">
                  <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded font-mono text-sm font-bold">
                    {c.customerCode || '未分配'}
                  </span>
                </td>
                <td className="p-4">
                  <Link href={`/customers/${c.id}`} className="font-bold text-gray-800 hover:text-indigo-600 hover:underline">
                    {c.name}
                  </Link>
                </td>
                <td className="p-4">
                  <span className={`px-2 py-1 rounded border text-xs font-bold ${TYPE_STYLE[c.type] || 'bg-gray-50 text-gray-600 border-gray-100'}`}>
                    {TYPE_LABEL[c.type] || c.type}
                  </span>
                </td>
                <td className="p-4 text-sm">
                  <div className="font-bold text-gray-800">{c.priorityScore || 0}/100</div>
                  <div className="text-xs text-gray-400 max-w-[180px] truncate">{c.nextAction || '未填写'}</div>
                </td>
                <td className="p-4 text-gray-600 text-sm">{c.country || '-'}</td>
                <td className="p-4 text-gray-600 text-sm">
                  <div>{c.source || '-'}</div>
                  <div className="text-xs text-gray-400">{c.owner?.name || c.owner?.email || '未分配'}</div>
                </td>
                <td className="p-4 text-gray-600 text-sm">
                  {c.contacts[0]?.firstName || '-'}
                  {c.contacts[0]?.email ? <span className="text-gray-400"> · {c.contacts[0].email}</span> : ''}
                </td>
                <td className="p-4 space-y-1">
                  <div className="bg-blue-50 text-blue-700 px-2 py-1 rounded text-xs font-bold w-fit">
                    {c._count.inboxMessages} 封/条
                  </div>
                  <div className="bg-green-50 text-green-700 px-2 py-1 rounded text-xs font-bold w-fit">
                    {c._count.opportunities} 个商机
                  </div>
                </td>
                <td className="p-4">
                  <Link href={`/customers/${c.id}`} className="text-blue-600 hover:underline text-sm font-medium">
                    查看详情
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {customers.length === 0 && (
          <div className="p-20 text-center text-gray-400">
            {q ? `📭 没有匹配 “${q}” 的客户` : '📭 暂无客户数据，请先同步 Gmail 客户。'}
          </div>
        )}
      </div>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-2">
          {page > 1 && (
            <Link href={mkHref(page - 1)} className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium hover:bg-gray-50">
              上一页
            </Link>
          )}
          <span className="px-4 py-2 text-sm text-gray-500">
            第 {page} / {totalPages} 页
          </span>
          {page < totalPages && (
            <Link href={mkHref(page + 1)} className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium hover:bg-gray-50">
              下一页
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function SegmentCard({ href, active, label, value }: { href: string; active: boolean; label: string; value: number }) {
  return (
    <Link
      href={href}
      className={`rounded-xl border p-4 shadow-sm transition-colors ${
        active ? 'border-indigo-300 bg-indigo-50 text-indigo-900' : 'border-gray-100 bg-white text-gray-700 hover:border-indigo-200'
      }`}
    >
      <div className="text-xs font-bold text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </Link>
  );
}

function buildCustomerHealthReport(customers: any[]) {
  const rows = customers.map(customerHealthRow);
  const customerCount = rows.length;
  const avgScore = customerCount ? Math.round(rows.reduce((sum, row) => sum + row.score, 0) / customerCount) : 0;
  const hotCount = rows.filter((row) => row.score >= 75 && (row.openOpportunityCount > 0 || row.daysSinceLastInteraction <= 14)).length;
  const missingProfileCount = rows.filter((row) => row.fitScore < 14).length;
  const unassignedCount = rows.filter((row) => row.ownerScore < 8).length;
  const noNextActionCount = rows.filter((row) => row.noNextAction).length;
  const staleCount = rows.filter((row) => row.isStale || row.stalledOpportunityCount > 0).length;
  const priorityRows = rows
    .filter((row) => row.shortfalls.length > 0 || row.score >= 75)
    .sort((a, b) => b.priorityWeight - a.priorityWeight || b.score - a.score || a.daysSinceLastInteraction - b.daysSinceLastInteraction)
    .slice(0, 8);
  const dimensionRows = [
    dimensionSummary(rows, 'fitScore', '资料完整'),
    dimensionSummary(rows, 'contactScore', '联系人'),
    dimensionSummary(rows, 'engagementScore', '互动热度'),
    dimensionSummary(rows, 'pipelineScore', '商机推进'),
    dimensionSummary(rows, 'ownerScore', '下一步/负责人'),
  ];

  return {
    customerCount,
    avgScore,
    hotCount,
    missingProfileCount,
    unassignedCount,
    noNextActionCount,
    staleCount,
    priorityRows,
    dimensionRows,
    recommendation: customerHealthRecommendation({ customerCount, avgScore, hotCount, missingProfileCount, unassignedCount, noNextActionCount, staleCount }),
  };
}

function customerHealthRow(customer: any) {
  const now = new Date();
  const latestInboxAt = latestDate(customer.inboxMessages.map((m: any) => m.sentAt || m.createdAt));
  const latestFollowUpAt = latestDate(customer.followUps.map((f: any) => f.createdAt));
  const lastInteractionAt = latestDate([latestInboxAt, latestFollowUpAt, customer.updatedAt, customer.createdAt]);
  const daysSinceLastInteraction = daysSince(lastInteractionAt, now);
  const openOpportunities = customer.opportunities.filter((opp: any) => opp.stage !== 'CLOSED_WON' && opp.stage !== 'CLOSED_LOST');
  const stalledOpportunityCount = openOpportunities.filter((opp: any) => daysSince(opp.stageChangedAt || opp.updatedAt, now) >= 14).length;
  const hasEmailContact = customer.contacts.some((contact: any) => Boolean(contact.email));
  const hasPhoneContact = customer.contacts.some((contact: any) => Boolean(contact.phone));
  const hasRecentInbound = customer.inboxMessages.some((msg: any) => msg.direction === 'IN' && daysSince(msg.sentAt || msg.createdAt, now) <= 14);
  const overdueTaskCount = customer.salesTasks.filter((task: any) => task.dueAt && new Date(task.dueAt).getTime() < now.getTime()).length;
  const noNextAction = !String(customer.nextAction || '').trim();

  const fitScore =
    points(customer.customerCode, 3) +
    points(customer.country, 3) +
    points(customer.industry, 3) +
    points(customer.website, 2) +
    points(customer.mainProducts, 4) +
    points(customer.customerProfile || customer.painPoints || customer.competitors, 5);
  const contactScore = Math.min(20, customer.contacts.length * 5 + (hasEmailContact ? 8 : 0) + (hasPhoneContact ? 4 : 0) + (customer.contacts.length > 1 ? 3 : 0));
  const engagementScore = daysSinceLastInteraction <= 7 ? 20 : daysSinceLastInteraction <= 14 ? 17 : daysSinceLastInteraction <= 30 ? 12 : daysSinceLastInteraction <= 90 ? 6 : 0;
  const pipelineScore = Math.min(
    20,
    (openOpportunities.length > 0 ? 10 : 0) +
      (customer.opportunities.some((opp: any) => opp.stage === 'CLOSED_WON') ? 7 : 0) +
      (customer.opportunities.length > 0 ? 3 : 0) -
      Math.min(8, stalledOpportunityCount * 4)
  );
  const ownerScore = Math.min(20, (customer.ownerId ? 8 : 0) + (!noNextAction ? 8 : 0) + (customer.salesTasks.length > 0 ? 4 : 0) - Math.min(8, overdueTaskCount * 4));
  const score = Math.max(0, Math.min(100, fitScore + contactScore + engagementScore + pipelineScore + ownerScore));

  const shortfalls: string[] = [];
  if (fitScore < 14) shortfalls.push('资料');
  if (contactScore < 14) shortfalls.push('联系人');
  if (engagementScore < 12) shortfalls.push('互动');
  if (pipelineScore < 10) shortfalls.push('商机');
  if (ownerScore < 14) shortfalls.push('下一步');
  if (stalledOpportunityCount > 0) shortfalls.push('停滞');
  if (overdueTaskCount > 0) shortfalls.push('逾期任务');

  const isStale = daysSinceLastInteraction >= 30;
  const priorityWeight =
    (score >= 75 ? 18 : 0) +
    (hasRecentInbound ? 16 : 0) +
    (openOpportunities.length > 0 ? 12 : 0) +
    stalledOpportunityCount * 10 +
    overdueTaskCount * 9 +
    (isStale ? 8 : 0) +
    (!customer.ownerId ? 7 : 0) +
    (noNextAction ? 5 : 0);

  return {
    id: customer.id,
    name: customer.name,
    typeLabel: TYPE_LABEL[customer.type] || customer.type,
    ownerLabel: customer.owner?.name || customer.owner?.email || '未分配',
    score,
    fitScore,
    contactScore,
    engagementScore,
    pipelineScore,
    ownerScore,
    shortfalls,
    action: customerHealthAction({ hasRecentInbound, openOpportunityCount: openOpportunities.length, stalledOpportunityCount, overdueTaskCount, isStale, noNextAction, hasOwner: Boolean(customer.ownerId), score }),
    daysSinceLastInteraction,
    openOpportunityCount: openOpportunities.length,
    stalledOpportunityCount,
    noNextAction,
    isStale,
    priorityWeight,
  };
}

function dimensionSummary(rows: any[], key: string, label: string) {
  const avgScore = rows.length ? Math.round(rows.reduce((sum, row) => sum + row[key], 0) / rows.length) : 0;
  return {
    key,
    label,
    avgScore,
    passCount: rows.filter((row) => row[key] >= 14).length,
  };
}

function customerHealthAction(input: { hasRecentInbound: boolean; openOpportunityCount: number; stalledOpportunityCount: number; overdueTaskCount: number; isStale: boolean; noNextAction: boolean; hasOwner: boolean; score: number }) {
  if (!input.hasOwner) return '先分配负责人,否则任何线索都没有闭环责任人。';
  if (input.overdueTaskCount > 0) return '先处理逾期任务,补跟进记录并更新下一步。';
  if (input.stalledOpportunityCount > 0) return '先推进停滞商机,更新阶段、报价或丢单原因。';
  if (input.hasRecentInbound) return '客户近期有来信,优先回复并把意向转成商机/报价。';
  if (input.noNextAction) return '补一条明确下一步动作,例如发资料、报价或约测试反馈。';
  if (input.isStale) return '客户已沉睡,发送激活邮件或释放到公海重分配。';
  if (input.openOpportunityCount > 0) return '继续推进当前商机,保持 7 天内有阶段动作。';
  if (input.score >= 75) return '资料和互动质量较好,可以创建商机或加入重点开发名单。';
  return '先补客户资料、联系人和画像,再判断是否值得继续开发。';
}

function customerHealthRecommendation(input: { customerCount: number; avgScore: number; hotCount: number; missingProfileCount: number; unassignedCount: number; noNextActionCount: number; staleCount: number }) {
  if (input.customerCount === 0) return '当前筛选下暂无客户。先导入/同步客户,再做五点体检。';
  if (input.unassignedCount > 0) return `有 ${input.unassignedCount} 个客户未分配负责人。先分配责任人,否则后续跟进和自动化都无法闭环。`;
  if (input.staleCount > 0) return `有 ${input.staleCount} 个客户存在沉睡或商机停滞。优先处理这些客户,避免询盘变成无效库存。`;
  if (input.missingProfileCount > 0) return `有 ${input.missingProfileCount} 个客户资料/画像不足。补齐国家、行业、关注产品、痛点和竞品后,AI 跟进会更准。`;
  if (input.noNextActionCount > 0) return `有 ${input.noNextActionCount} 个客户没有下一步动作。每个有效客户至少要有一个可执行动作。`;
  if (input.hotCount > 0) return `当前有 ${input.hotCount} 个高意向客户。建议销售主管优先检查是否已报价、建商机和安排下一轮跟进。`;
  return `客户平均健康度 ${input.avgScore},整体稳定。下一步可以把高分客户沉淀为重点账户运营。`;
}

function HealthMetric({ label, value, detail, tone }: { label: string; value: number | string; detail: string; tone: string }) {
  const color: Record<string, string> = {
    blue: 'border-blue-100 bg-blue-50 text-blue-800',
    emerald: 'border-emerald-100 bg-emerald-50 text-emerald-800',
    amber: 'border-amber-100 bg-amber-50 text-amber-800',
    rose: 'border-rose-100 bg-rose-50 text-rose-800',
    slate: 'border-slate-100 bg-slate-50 text-slate-800',
  };
  return (
    <div className={`rounded-xl border p-3 ${color[tone] || color.slate}`}>
      <div className="text-xs font-bold opacity-70">{label}</div>
      <div className="mt-1 text-xl font-black">{value}</div>
      <div className="mt-1 text-[11px] font-bold opacity-70">{detail}</div>
    </div>
  );
}

function HealthBar({ label, value, max, detail }: { label: string; value: number; max: number; detail: string }) {
  const width = Math.max(3, Math.round((value / Math.max(1, max)) * 100));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3">
        <div className="truncate text-xs font-black text-gray-700">{label}</div>
        <div className="text-xs font-bold text-gray-400">{value}</div>
      </div>
      <div className="h-2 rounded-full bg-gray-100">
        <div className="h-2 rounded-full bg-indigo-500" style={{ width: `${width}%` }} />
      </div>
      <div className="mt-1 text-[11px] font-bold text-gray-400">{detail}</div>
    </div>
  );
}

function points(value: unknown, score: number) {
  return String(value || '').trim() ? score : 0;
}

function latestDate(values: Array<Date | string | null | undefined>) {
  const times = values
    .filter(Boolean)
    .map((value) => new Date(value as Date | string).getTime())
    .filter((time) => Number.isFinite(time));
  if (!times.length) return null;
  return new Date(Math.max(...times));
}

function daysSince(value: Date | string | null | undefined, now = new Date()) {
  if (!value) return 999;
  return Math.max(0, Math.floor((now.getTime() - new Date(value).getTime()) / 86400000));
}

import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ensureCustomerCode } from '@/lib/customer-code';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 30;

const TYPE_LABEL: Record<string, string> = {
  NEW: '新客户',
  EXISTING: '老客户',
  PROSPECT: '潜在客户',
  KEY_ACCOUNT: '重点客户',
  LOST: '流失客户',
};

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
      type: (s('type') as any) || 'PROSPECT',
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
  const page = Math.max(1, parseInt(String(sp.page || '1'), 10) || 1);

  const where = q
    ? {
        OR: [
          { name: { contains: q, mode: 'insensitive' as const } },
          { customerCode: { contains: q, mode: 'insensitive' as const } },
          { country: { contains: q, mode: 'insensitive' as const } },
          { contacts: { some: { email: { contains: q, mode: 'insensitive' as const } } } },
        ],
      }
    : {};

  const [total, customers] = await Promise.all([
    prisma.company.count({ where }),
    prisma.company.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { contacts: true, _count: { select: { opportunities: true } } },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const mkHref = (p: number) => `/customers?${q ? `q=${encodeURIComponent(q)}&` : ''}page=${p}`;

  return (
    <div className="min-h-screen bg-gray-50 p-6 md:p-8">
      <header className="mb-6 flex flex-wrap justify-between items-center gap-4 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 tracking-tight">👥 客户管理中心</h1>
          <p className="text-sm text-gray-500 mt-1">共 {total} 家客户{q ? `（搜索 “${q}”）` : ''}</p>
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
              <select name="type" defaultValue="PROSPECT" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none bg-white">
                <option value="PROSPECT">潜在客户</option>
                <option value="NEW">新客户</option>
                <option value="EXISTING">老客户</option>
                <option value="KEY_ACCOUNT">重点客户</option>
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

      {/* 搜索栏 */}
      <form action="/customers" method="get" className="mb-6 flex gap-3">
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
              <th className="p-4 font-bold text-gray-600 text-sm">国家</th>
              <th className="p-4 font-bold text-gray-600 text-sm">主要联系人</th>
              <th className="p-4 font-bold text-gray-600 text-sm">商机数</th>
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
                  <span className="bg-indigo-50 text-indigo-700 px-2 py-1 rounded text-xs font-bold">
                    {TYPE_LABEL[c.type] || c.type}
                  </span>
                </td>
                <td className="p-4 text-gray-600 text-sm">{c.country || '-'}</td>
                <td className="p-4 text-gray-600 text-sm">
                  {c.contacts[0]?.firstName || '-'}
                  {c.contacts[0]?.email ? <span className="text-gray-400"> · {c.contacts[0].email}</span> : ''}
                </td>
                <td className="p-4">
                  <span className="bg-green-50 text-green-700 px-2 py-1 rounded text-xs font-bold">
                    {c._count.opportunities} 个商机
                  </span>
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

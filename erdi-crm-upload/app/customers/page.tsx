import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 30;

const TYPE_LABEL: Record<string, string> = {
  NEW: '新客户',
  EXISTING: '老客户',
  PROSPECT: '潜在客户',
  KEY_ACCOUNT: '重点客户',
  LOST: '流失客户',
};

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
        <Link href="/dashboard" className="bg-gray-800 text-white px-4 py-2 rounded-lg font-bold hover:bg-gray-700 transition-all">
          返回看板
        </Link>
      </header>

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

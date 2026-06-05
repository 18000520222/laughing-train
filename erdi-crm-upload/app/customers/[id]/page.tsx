import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const STAGE_LABEL: Record<string, string> = {
  UNPROCESSED: '未处理',
  REPLIED: '已回复',
  QUOTING: '报价中',
  NEGOTIATING: '谈判中',
  SPEC_CONFIRMING: '确认规格',
  CLOSED_WON: '已成交',
  CLOSED_LOST: '已流失',
};

const STAGE_COLOR: Record<string, string> = {
  UNPROCESSED: 'bg-gray-100 text-gray-600',
  REPLIED: 'bg-blue-50 text-blue-700',
  QUOTING: 'bg-amber-50 text-amber-700',
  NEGOTIATING: 'bg-orange-50 text-orange-700',
  SPEC_CONFIRMING: 'bg-purple-50 text-purple-700',
  CLOSED_WON: 'bg-green-50 text-green-700',
  CLOSED_LOST: 'bg-red-50 text-red-600',
};

const TYPE_LABEL: Record<string, string> = {
  NEW: '新客户',
  EXISTING: '老客户',
  PROSPECT: '潜在客户',
  KEY_ACCOUNT: '重点客户',
  LOST: '流失客户',
};

function fmtDate(d: Date | null | undefined): string {
  if (!d) return '-';
  return new Date(d).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

export default async function CustomerDetailPage(props: any) {
  const role = (cookies().get('auth_role')?.value || '').toUpperCase();
  if (role !== 'SALES' && role !== 'SUPER_ADMIN' && role !== 'ADMIN') {
    redirect('/');
  }

  const id = props.params.id as string;

  const company = await prisma.company.findUnique({
    where: { id },
    include: {
      owner: true,
      contacts: { orderBy: { createdAt: 'asc' } },
      opportunities: { orderBy: { updatedAt: 'desc' }, include: { product: true } },
      followUps: { orderBy: { createdAt: 'desc' }, take: 20, include: { user: true } },
      inboxMessages: { orderBy: { createdAt: 'desc' }, take: 15 },
    },
  });

  if (!company) notFound();

  const wonAmount = company.opportunities
    .filter((o) => o.stage === 'CLOSED_WON')
    .reduce((s, o) => s + (o.amountUSD || 0), 0);
  const openCount = company.opportunities.filter(
    (o) => o.stage !== 'CLOSED_WON' && o.stage !== 'CLOSED_LOST'
  ).length;

  return (
    <div className="min-h-screen bg-gray-50 p-6 md:p-8">
      {/* 顶部 */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3 text-sm text-gray-500">
          <Link href="/customers" className="hover:text-gray-800 font-medium">← 客户列表</Link>
          <span>/</span>
          <span className="text-gray-800 font-semibold">{company.name}</span>
        </div>
        <Link href="/dashboard" className="bg-gray-800 text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-gray-700 transition-all">
          返回看板
        </Link>
      </div>

      {/* 公司概览卡片 */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-black text-gray-900">{company.name}</h1>
              <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded font-mono text-xs font-bold">
                {company.customerCode || '未分配编号'}
              </span>
              <span className="bg-indigo-50 text-indigo-700 px-2 py-1 rounded text-xs font-bold">
                {TYPE_LABEL[company.type] || company.type}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-600">
              <span>🌍 国家：{company.country || '-'}</span>
              <span>🏭 行业：{company.industry || '-'}</span>
              <span>🔗 来源：{company.source || '-'}</span>
              {company.website && (
                <a href={company.website.startsWith('http') ? company.website : `https://${company.website}`}
                   target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                  🌐 {company.website}
                </a>
              )}
              <span>👤 负责人：{company.owner?.name || company.owner?.email || '未分配'}</span>
              <span>🕒 创建：{fmtDate(company.createdAt)}</span>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="bg-green-50 rounded-xl px-5 py-3 text-center">
              <div className="text-2xl font-black text-green-700">${wonAmount.toLocaleString()}</div>
              <div className="text-xs text-green-600 font-bold mt-1">成交金额</div>
            </div>
            <div className="bg-orange-50 rounded-xl px-5 py-3 text-center">
              <div className="text-2xl font-black text-orange-700">{openCount}</div>
              <div className="text-xs text-orange-600 font-bold mt-1">进行中商机</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 左列：联系人 + 商机 */}
        <div className="lg:col-span-2 space-y-6">
          {/* 联系人 */}
          <section className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <h2 className="px-6 py-4 font-bold text-gray-800 border-b border-gray-100">
              📇 联系人 <span className="text-gray-400 font-normal">（{company.contacts.length}）</span>
            </h2>
            {company.contacts.length === 0 ? (
              <p className="px-6 py-8 text-center text-gray-400 text-sm">暂无联系人</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-xs">
                    <th className="text-left px-6 py-2 font-bold">姓名</th>
                    <th className="text-left px-4 py-2 font-bold">职位</th>
                    <th className="text-left px-4 py-2 font-bold">邮箱</th>
                    <th className="text-left px-4 py-2 font-bold">电话</th>
                  </tr>
                </thead>
                <tbody>
                  {company.contacts.map((ct) => (
                    <tr key={ct.id} className="border-t border-gray-50">
                      <td className="px-6 py-3 font-semibold text-gray-800">
                        {ct.firstName} {ct.lastName || ''}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{ct.title || '-'}</td>
                      <td className="px-4 py-3">
                        <a href={`mailto:${ct.email}`} className="text-blue-600 hover:underline">{ct.email}</a>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{ct.phone || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* 商机 */}
          <section className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <h2 className="px-6 py-4 font-bold text-gray-800 border-b border-gray-100">
              💼 商机 <span className="text-gray-400 font-normal">（{company.opportunities.length}）</span>
            </h2>
            {company.opportunities.length === 0 ? (
              <p className="px-6 py-8 text-center text-gray-400 text-sm">暂无商机</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {company.opportunities.map((op) => (
                  <Link key={op.id} href={`/opportunity/${op.id}`}
                        className="flex items-center justify-between px-6 py-4 hover:bg-gray-50 transition-colors">
                    <div className="min-w-0">
                      <div className="font-semibold text-gray-800 truncate">{op.title}</div>
                      <div className="text-xs text-gray-400 mt-1">
                        {op.opportunityCode || op.id.slice(0, 8)} · {op.product?.name || '未关联产品'} · 更新 {fmtDate(op.updatedAt)}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 ml-4">
                      {op.amountUSD ? (
                        <span className="font-bold text-gray-700">${op.amountUSD.toLocaleString()}</span>
                      ) : null}
                      <span className={`px-2 py-1 rounded text-xs font-bold ${STAGE_COLOR[op.stage] || 'bg-gray-100 text-gray-600'}`}>
                        {STAGE_LABEL[op.stage] || op.stage}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* 右列：往来邮件 + 跟进 */}
        <div className="space-y-6">
          <section className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <h2 className="px-6 py-4 font-bold text-gray-800 border-b border-gray-100">📨 最近往来</h2>
            {company.inboxMessages.length === 0 ? (
              <p className="px-6 py-8 text-center text-gray-400 text-sm">暂无往来消息</p>
            ) : (
              <ul className="divide-y divide-gray-50 max-h-[420px] overflow-y-auto">
                {company.inboxMessages.map((m) => (
                  <li key={m.id} className="px-6 py-3">
                    <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
                      <span className={`font-bold ${m.direction === 'IN' ? 'text-blue-600' : 'text-green-600'}`}>
                        {m.direction === 'IN' ? '↓ 客户来信' : '↑ 我方回复'} · {m.channel}
                      </span>
                      <span>{fmtDate(m.sentAt || m.createdAt)}</span>
                    </div>
                    <p className="text-sm text-gray-700 line-clamp-2">{m.translatedText || m.originalText}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <h2 className="px-6 py-4 font-bold text-gray-800 border-b border-gray-100">📝 跟进记录</h2>
            {company.followUps.length === 0 ? (
              <p className="px-6 py-8 text-center text-gray-400 text-sm">暂无跟进记录</p>
            ) : (
              <ul className="divide-y divide-gray-50 max-h-[320px] overflow-y-auto">
                {company.followUps.map((f) => (
                  <li key={f.id} className="px-6 py-3">
                    <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
                      <span className="font-bold text-gray-500">{f.user?.name || f.user?.email || '系统'} · {f.type}</span>
                      <span>{fmtDate(f.createdAt)}</span>
                    </div>
                    <p className="text-sm text-gray-700">{f.content}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

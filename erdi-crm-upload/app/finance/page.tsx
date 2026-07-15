import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';


export default async function FinanceDashboard() {
  // 🔒 安全校验：拦截没买票的黑客
  const role = (cookies().get('auth_role')?.value || '').toUpperCase();
  if (role !== 'FINANCE' && role !== 'SALES' && role !== 'SUPER_ADMIN' && role !== 'ADMIN') {
    redirect('/');
  }

  // 财务只能看到“测试中”和“已成单”的业务
  const opps = await prisma.opportunity.findMany({
    where: { stage: { in: ['CLOSED_WON', 'NEGOTIATING'] } },
    orderBy: { updatedAt: 'desc' },
    include: {
      company: { select: { name: true, customerCode: true } },
      payments: { orderBy: { createdAt: 'desc' }, include: { bankAccount: true } },
    },
  });

  const totalRevenue = opps.filter(o => o.stage === 'CLOSED_WON').reduce((sum, o) => sum + (o.amountUSD || 0), 0);
  const confirmedReceiptsUSD = opps.flatMap((opp) => opp.payments).filter((payment) => payment.status === 'CONFIRMED' && payment.currency === 'USD').reduce((sum, payment) => sum + (payment.amount || 0), 0);

  async function logout() {
    'use server';
    cookies().delete('auth_role');
    redirect('/');
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <header className="mb-8 flex justify-between items-center bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <div>
            <h1 className="text-2xl font-bold text-gray-800 tracking-tight">ERDI 财务数据中心</h1>
            <p className="text-sm text-gray-500 mt-1 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-500"></span>
              当前权限: 财务审计 (只读模式)
            </p>
          </div>
          <div className="flex items-center gap-8">
            <div className="text-right">
              <p className="text-sm text-gray-500">已成交订单额</p>
              <p className="text-3xl font-bold text-green-600">${totalRevenue.toLocaleString()}</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-500">已登记确认收款</p>
              <p className="text-2xl font-bold text-blue-600">${confirmedReceiptsUSD.toLocaleString()}</p>
            </div>
            <form action={logout}>
              <button type="submit" className="text-sm bg-gray-100 hover:bg-red-50 text-gray-600 hover:text-red-600 border border-gray-200 px-4 py-2 rounded-lg font-medium transition-colors">
                退出登录
              </button>
            </form>
          </div>
        </header>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-100 text-gray-600 text-sm border-b border-gray-200">
                <th className="p-4 font-semibold">商机 ID (短码)</th>
                <th className="p-4 font-semibold">客户公司</th>
                <th className="p-4 font-semibold">当前阶段</th>
                <th className="p-4 font-semibold text-right">订单金额</th>
                <th className="p-4 font-semibold">付款 / 收款账户</th>
                <th className="p-4 font-semibold text-right">最后更新时间</th>
                <th className="p-4 font-semibold text-center">发票</th>
              </tr>
            </thead>
            <tbody className="text-sm text-gray-800">
              {opps.length === 0 && (
                <tr><td colSpan={7} className="p-10 text-center text-gray-400">暂无财务数据记录</td></tr>
              )}
              {opps.map(opp => (
                <tr key={opp.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                  <td className="p-4 font-mono text-gray-500">{opp.id.substring(0,8)}</td>
                  <td className="p-4 font-medium text-blue-700">{opp.company?.name || '未填写'}<div className="text-xs text-gray-400">{opp.company?.customerCode || ''}</div></td>
                  <td className="p-4">
                    <span className={`px-2 py-1 rounded text-xs font-bold ${opp.stage === 'CLOSED_WON' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                      {opp.stage === 'CLOSED_WON' ? '✔️ 已打款成单' : '⏳ 样品测试中'}
                    </span>
                  </td>
                  <td className="p-4 text-right font-bold text-gray-800">${opp.amountUSD || 0}</td>
                  <td className="p-4 text-xs text-gray-600">
                    {opp.payments[0] ? (
                      <><span className="font-bold text-green-700">{opp.payments[0].status === 'CONFIRMED' ? '已确认' : opp.payments[0].status}</span><div>{opp.payments[0].currency} {(opp.payments[0].amount || 0).toLocaleString()} · {opp.payments[0].bankAccount?.label || opp.payments[0].method || '账户未指定'} {opp.payments[0].bankAccount?.accountNo ? `· ****${opp.payments[0].bankAccount.accountNo.replace(/\s+/g, '').slice(-4)}` : ''}</div></>
                    ) : <span className="text-amber-600">未登记付款</span>}
                  </td>
                  <td className="p-4 text-right text-gray-500">{opp.updatedAt.toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai'})}</td>
                  <td className="p-4 text-center">
                    <Link href={`/pi/${opp.id}`} className="text-blue-600 hover:underline text-xs">查看 PI</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

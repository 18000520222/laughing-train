import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { clearSession } from '@/lib/auth';
import { can, requirePermission } from '@/lib/permissions';
import { revalidatePath } from 'next/cache';
import { writeAuditLog } from '@/lib/audit';

export const dynamic = 'force-dynamic';


export default async function FinanceDashboard() {
  const session = await requirePermission('finance.read');
  const canManage = can(session.role, 'finance.manage');

  async function reviewPayment(formData: FormData) {
    'use server';
    const actor = await requirePermission('finance.manage');
    const paymentId = String(formData.get('paymentId') || '');
    const nextStatus = String(formData.get('status') || '');
    const allowed = ['CONFIRMED', 'FAILED', 'REFUNDED'];
    if (!paymentId || !allowed.includes(nextStatus)) return;
    const payment = await prisma.paymentRecord.findUnique({ where: { id: paymentId } });
    if (!payment) return;
    if (nextStatus === 'REFUNDED' && payment.status !== 'CONFIRMED') return;
    if ((nextStatus === 'CONFIRMED' || nextStatus === 'FAILED') && payment.status !== 'PENDING') return;

    await prisma.paymentRecord.update({
      where: { id: paymentId },
      data: {
        status: nextStatus as 'CONFIRMED' | 'FAILED' | 'REFUNDED',
        paidAt: nextStatus === 'CONFIRMED' ? payment.paidAt || new Date() : payment.paidAt,
      },
    });
    await writeAuditLog(actor, {
      action: 'payment.review',
      entityType: 'PaymentRecord',
      entityId: paymentId,
      summary: `${payment.status} -> ${nextStatus}`,
      metadata: { opportunityId: payment.opportunityId, amount: payment.amount, currency: payment.currency },
    });
    revalidatePath('/finance');
  }

  async function reviewPurchaseOrder(formData: FormData) {
    'use server';
    const actor = await requirePermission('finance.manage');
    const id = String(formData.get('id') || '');
    const decision = String(formData.get('decision') || '');
    if (!id || !['APPROVED', 'REJECTED'].includes(decision)) return;
    const order = await prisma.purchaseOrder.findUnique({ where: { id }, select: { id: true, poNumber: true, status: true, totalAmountCNY: true } });
    if (!order || order.status !== 'PENDING') return;
    await prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: decision,
        approvedById: actor.userId,
        approvedAt: new Date(),
      },
    });
    await writeAuditLog(actor, {
      action: 'purchase_order.review',
      entityType: 'PurchaseOrder',
      entityId: id,
      summary: `${order.poNumber}: PENDING -> ${decision}`,
      metadata: { totalAmountCNY: order.totalAmountCNY },
    });
    revalidatePath('/finance');
    revalidatePath('/suppliers');
  }

  // 财务只能看到“测试中”和“已成单”的业务
  const [opps, pendingPayments, pendingPurchaseOrders] = await Promise.all([
    prisma.opportunity.findMany({
      where: { OR: [{ stage: { in: ['CLOSED_WON', 'NEGOTIATING'] } }, { payments: { some: {} } }] },
      orderBy: { updatedAt: 'desc' },
      include: {
        company: { select: { name: true, customerCode: true } },
        payments: { orderBy: { createdAt: 'desc' }, include: { bankAccount: true } },
      },
      take: 200,
    }),
    prisma.paymentRecord.findMany({
      where: { status: 'PENDING' },
      include: {
        company: { select: { name: true, customerCode: true } },
        opportunity: { select: { id: true, title: true, opportunityCode: true } },
        bankAccount: true,
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    }),
    prisma.purchaseOrder.findMany({
      where: { status: 'PENDING' },
      include: {
        supplier: true,
        opportunity: { include: { company: true } },
        lineItems: true,
        createdBy: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    }),
  ]);

  const totalRevenue = opps.filter(o => o.stage === 'CLOSED_WON').reduce((sum, o) => sum + (o.amountUSD || 0), 0);
  const confirmedReceiptsUSD = opps.flatMap((opp) => opp.payments).filter((payment) => payment.status === 'CONFIRMED' && payment.currency === 'USD').reduce((sum, payment) => sum + (payment.amount || 0), 0);

  async function logout() {
    'use server';
    await clearSession();
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
              当前权限: {canManage ? '财务复核与审批' : '财务数据只读'}
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

        <section className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-black text-amber-900">待复核收款</h2>
              <p className="text-sm text-amber-700">业务登记付款后必须由财务确认，确认前不会被计入到账金额。</p>
            </div>
            <span className="rounded-full bg-amber-600 px-3 py-1 text-sm font-black text-white">{pendingPayments.length}</span>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {pendingPayments.map((payment) => (
              <article key={payment.id} className="rounded-lg border border-amber-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-black text-gray-900">{payment.company.name}</p>
                    <p className="text-xs text-gray-500">{payment.opportunity?.opportunityCode || payment.opportunity?.title || '未关联商机'}</p>
                  </div>
                  <p className="text-lg font-black text-amber-700">{payment.currency} {(payment.amount || 0).toLocaleString()}</p>
                </div>
                <p className="mt-2 text-xs text-gray-600">账户：{payment.bankAccount?.label || '未指定'} · 方式：{payment.method || '未填写'} · 参考号：{payment.reference || '未填写'}</p>
                {canManage && (
                  <div className="mt-3 flex gap-2">
                    <PaymentButton action={reviewPayment} id={payment.id} status="CONFIRMED" label="确认到账" tone="green" />
                    <PaymentButton action={reviewPayment} id={payment.id} status="FAILED" label="标记未到账" tone="red" />
                  </div>
                )}
              </article>
            ))}
            {pendingPayments.length === 0 && <p className="text-sm text-amber-700">没有待复核收款。</p>}
          </div>
        </section>

        <section className="mb-6 rounded-xl border border-indigo-200 bg-indigo-50 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div><h2 className="text-lg font-black text-indigo-950">待审批采购单</h2><p className="text-sm text-indigo-700">采购提交后由财务或管理员审批，采购岗不能自批。</p></div>
            <span className="rounded-full bg-indigo-600 px-3 py-1 text-sm font-black text-white">{pendingPurchaseOrders.length}</span>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {pendingPurchaseOrders.map((order) => (
              <article key={order.id} className="rounded-lg border border-indigo-200 bg-white p-4">
                <div className="flex justify-between gap-3"><div><p className="font-mono font-black">{order.poNumber}</p><p className="text-xs text-gray-500">{order.supplier.name} · {order.createdBy?.name || order.createdBy?.email || '采购岗'}</p></div><p className="text-lg font-black text-indigo-700">¥{order.totalAmountCNY.toLocaleString()}</p></div>
                <p className="mt-2 text-xs text-gray-600">{order.lineItems.map((item) => `${item.productName} × ${item.quantity}`).join('；')}</p>
                <p className="mt-1 text-xs text-gray-500">关联订单：{order.opportunity ? `${order.opportunity.company.name} · ${order.opportunity.title}` : '无'}</p>
                {canManage && <div className="mt-3 flex gap-2"><PurchaseReviewButton action={reviewPurchaseOrder} id={order.id} decision="APPROVED" label="批准" tone="green" /><PurchaseReviewButton action={reviewPurchaseOrder} id={order.id} decision="REJECTED" label="拒绝" tone="red" /></div>}
              </article>
            ))}
            {pendingPurchaseOrders.length === 0 && <p className="text-sm text-indigo-700">没有待审批采购单。</p>}
          </div>
        </section>

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
                      <><span className="font-bold text-green-700">{opp.payments[0].status === 'CONFIRMED' ? '已确认' : opp.payments[0].status}</span><div>{opp.payments[0].currency} {(opp.payments[0].amount || 0).toLocaleString()} · {opp.payments[0].bankAccount?.label || opp.payments[0].method || '账户未指定'} {opp.payments[0].bankAccount?.accountNo ? `· ****${opp.payments[0].bankAccount.accountNo.replace(/\s+/g, '').slice(-4)}` : ''}</div>{canManage && opp.payments[0].status === 'CONFIRMED' && <div className="mt-2"><PaymentButton action={reviewPayment} id={opp.payments[0].id} status="REFUNDED" label="登记退款" tone="red" /></div>}</>
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

function PaymentButton({ action, id, status, label, tone }: { action: (formData: FormData) => Promise<void>; id: string; status: string; label: string; tone: 'green' | 'red' }) {
  return (
    <form action={action}>
      <input type="hidden" name="paymentId" value={id} />
      <input type="hidden" name="status" value={status} />
      <button className={`rounded-lg px-3 py-1.5 text-xs font-black ${tone === 'green' ? 'bg-green-600 text-white' : 'border border-red-200 bg-red-50 text-red-700'}`}>{label}</button>
    </form>
  );
}

function PurchaseReviewButton({ action, id, decision, label, tone }: { action: (formData: FormData) => Promise<void>; id: string; decision: string; label: string; tone: 'green' | 'red' }) {
  return <form action={action}><input type="hidden" name="id" value={id} /><input type="hidden" name="decision" value={decision} /><button className={`rounded-lg px-3 py-1.5 text-xs font-black ${tone === 'green' ? 'bg-green-600 text-white' : 'border border-red-200 bg-red-50 text-red-700'}`}>{label}</button></form>;
}

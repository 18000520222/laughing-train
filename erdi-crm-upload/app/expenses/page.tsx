import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

async function createExpense(formData: FormData) {
  'use server';
  const session = await getSession();
  if (!session) redirect('/');

  const title = String(formData.get('title') || '').trim();
  const amount = Number(formData.get('amount') || 0);
  const currency = String(formData.get('currency') || 'CNY');
  const category = String(formData.get('category') || '业务费用');
  const description = String(formData.get('description') || '').trim();
  const opportunityId = String(formData.get('opportunityId') || '').trim();

  if (!title || !amount || amount <= 0) return;

  await prisma.expenseClaim.create({
    data: {
      title,
      amount,
      currency,
      category,
      description: description || null,
      submittedById: session.userId,
      opportunityId: opportunityId || null,
    },
  });
  revalidatePath('/expenses');
}

async function updateExpense(formData: FormData) {
  'use server';
  const session = await getSession();
  if (!session) redirect('/');
  if (session.role !== 'SUPER_ADMIN' && session.role !== 'FINANCE') redirect('/expenses');

  const id = String(formData.get('id') || '');
  const status = String(formData.get('status') || 'PENDING') as 'APPROVED' | 'REJECTED' | 'PAID';
  if (!id) return;

  await prisma.expenseClaim.update({
    where: { id },
    data: { status, approvedById: status === 'REJECTED' ? session.userId : session.userId },
  });
  revalidatePath('/expenses');
}

const statusText: Record<string, string> = {
  PENDING: '待审批',
  APPROVED: '已通过',
  REJECTED: '已驳回',
  PAID: '已付款',
};

function money(amount: number, currency: string) {
  return `${currency} ${amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function statusClass(status: string) {
  if (status === 'PAID') return 'bg-blue-50 text-blue-700 border-blue-200';
  if (status === 'APPROVED') return 'bg-green-50 text-green-700 border-green-200';
  if (status === 'REJECTED') return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-amber-50 text-amber-700 border-amber-200';
}

export default async function ExpensesPage() {
  const session = await getSession();
  if (!session) redirect('/');

  const [claims, opportunities] = await Promise.all([
    prisma.expenseClaim.findMany({
      include: { submittedBy: true, approvedBy: true, opportunity: { include: { company: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.opportunity.findMany({
      include: { company: true },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    }),
  ]);

  const pendingAmount = claims.filter(c => c.status === 'PENDING').reduce((sum, c) => sum + c.amount, 0);
  const approvedAmount = claims.filter(c => c.status === 'APPROVED').reduce((sum, c) => sum + c.amount, 0);
  const paidAmount = claims.filter(c => c.status === 'PAID').reduce((sum, c) => sum + c.amount, 0);
  const canApprove = session.role === 'SUPER_ADMIN' || session.role === 'FINANCE';

  return (
    <main className="min-h-screen bg-slate-50 p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-4 bg-white p-6 rounded-xl border border-slate-200 shadow-sm md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-500">费用审批</p>
            <h1 className="text-2xl font-bold text-slate-900">报账管理</h1>
          </div>
          <div className="flex gap-2">
            <Link href="/finance" className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">财务中心</Link>
            <Link href="/dashboard" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">返回看板</Link>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          <Stat label="待审批金额" value={`CNY ${pendingAmount.toLocaleString('zh-CN')}`} tone="amber" />
          <Stat label="待付款金额" value={`CNY ${approvedAmount.toLocaleString('zh-CN')}`} tone="green" />
          <Stat label="已付款金额" value={`CNY ${paidAmount.toLocaleString('zh-CN')}`} tone="blue" />
        </section>

        <section className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <form action={createExpense} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900">提交报账</h2>
            <label className="block text-sm font-medium text-slate-700">
              标题
              <input required name="title" placeholder="样品寄送运费" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <div className="grid grid-cols-[1fr_110px] gap-3">
              <label className="block text-sm font-medium text-slate-700">
                金额
                <input required name="amount" type="number" min="0" step="0.01" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                币种
                <select name="currency" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
                  <option>CNY</option>
                  <option>USD</option>
                  <option>EUR</option>
                </select>
              </label>
            </div>
            <label className="block text-sm font-medium text-slate-700">
              分类
              <select name="category" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
                <option>业务费用</option>
                <option>物流费用</option>
                <option>样品费用</option>
                <option>平台费用</option>
                <option>行政费用</option>
              </select>
            </label>
            <label className="block text-sm font-medium text-slate-700">
              关联商机
              <select name="opportunityId" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
                <option value="">不关联商机</option>
                {opportunities.map(o => <option key={o.id} value={o.id}>{o.title} / {o.company.name}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium text-slate-700">
              说明
              <textarea name="description" rows={4} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <button className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700">
              提交报账
            </button>
          </form>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="p-4">报账事项</th>
                  <th className="p-4">提交人</th>
                  <th className="p-4">金额</th>
                  <th className="p-4">关联业务</th>
                  <th className="p-4">状态</th>
                  <th className="p-4 text-right">财务操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {claims.length === 0 && <tr><td colSpan={6} className="p-10 text-center text-slate-400">暂无报账记录</td></tr>}
                {claims.map(c => (
                  <tr key={c.id} className="align-top hover:bg-slate-50">
                    <td className="p-4"><p className="font-bold text-slate-800">{c.title}</p><p className="text-xs text-slate-500">{c.category} · {c.description || '无说明'}</p></td>
                    <td className="p-4 text-slate-700">{c.submittedBy.name || c.submittedBy.email}</td>
                    <td className="p-4 font-bold text-slate-900">{money(c.amount, c.currency)}</td>
                    <td className="p-4 text-slate-600">{c.opportunity ? <Link href={`/opportunity/${c.opportunity.id}`} className="text-blue-600 hover:underline">{c.opportunity.company.name}</Link> : '-'}</td>
                    <td className="p-4"><span className={`rounded-full border px-2 py-1 text-xs font-bold ${statusClass(c.status)}`}>{statusText[c.status] || c.status}</span></td>
                    <td className="p-4 text-right">
                      {canApprove ? (
                        <div className="flex flex-wrap justify-end gap-2">
                          {c.status === 'PENDING' && <ExpenseButton action={updateExpense} id={c.id} status="APPROVED" label="通过" />}
                          {c.status === 'PENDING' && <ExpenseButton action={updateExpense} id={c.id} status="REJECTED" label="驳回" />}
                          {c.status === 'APPROVED' && <ExpenseButton action={updateExpense} id={c.id} status="PAID" label="标记付款" />}
                        </div>
                      ) : <span className="text-xs text-slate-400">等待财务</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: 'amber' | 'green' | 'blue' }) {
  const colors = {
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    green: 'border-green-200 bg-green-50 text-green-700',
    blue: 'border-blue-200 bg-blue-50 text-blue-700',
  }[tone];
  return <div className={`rounded-xl border p-5 shadow-sm ${colors}`}><p className="text-sm font-semibold">{label}</p><p className="mt-2 text-2xl font-black">{value}</p></div>;
}

function ExpenseButton({ action, id, status, label }: { action: (formData: FormData) => Promise<void>; id: string; status: string; label: string }) {
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100">{label}</button>
    </form>
  );
}

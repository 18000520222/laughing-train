import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

function parseDate(value: FormDataEntryValue | null, endOfDay = false) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  return new Date(`${raw}T${endOfDay ? '23:59:59' : '00:00:00'}`);
}

async function createAttendance(formData: FormData) {
  'use server';
  const session = await getSession();
  if (!session) redirect('/');

  const type = String(formData.get('type') || 'LEAVE');
  const subType = String(formData.get('subType') || '').trim();
  const reason = String(formData.get('reason') || '').trim();
  const companyId = String(formData.get('companyId') || '').trim();
  const startDate = parseDate(formData.get('startDate'));
  const endDate = parseDate(formData.get('endDate'), true);

  if (!reason || !startDate || !endDate) return;

  await prisma.attendanceRequest.create({
    data: {
      type,
      subType: subType || null,
      reason,
      startDate,
      endDate,
      submittedById: session.userId,
      companyId: companyId || null,
    },
  });
  revalidatePath('/attendance');
}

async function updateAttendance(formData: FormData) {
  'use server';
  const session = await getSession();
  if (!session) redirect('/');
  if (session.role !== 'SUPER_ADMIN' && session.role !== 'FINANCE') redirect('/attendance');

  const id = String(formData.get('id') || '');
  const status = String(formData.get('status') || 'PENDING') as 'APPROVED' | 'REJECTED' | 'PENDING';
  if (!id) return;

  await prisma.attendanceRequest.update({
    where: { id },
    data: { status, approvedById: status === 'PENDING' ? null : session.userId },
  });
  revalidatePath('/attendance');
}

const statusText: Record<string, string> = {
  PENDING: '待审批',
  APPROVED: '已通过',
  REJECTED: '已驳回',
  PAID: '已处理',
};

const typeText: Record<string, string> = {
  LEAVE: '请假',
  OVERTIME: '加班',
  FIELD: '外勤',
  REMOTE: '远程办公',
};

function statusClass(status: string) {
  if (status === 'APPROVED') return 'bg-green-50 text-green-700 border-green-200';
  if (status === 'REJECTED') return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-amber-50 text-amber-700 border-amber-200';
}

export default async function AttendancePage() {
  const session = await getSession();
  if (!session) redirect('/');

  const [requests, companies] = await Promise.all([
    prisma.attendanceRequest.findMany({
      include: { submittedBy: true, approvedBy: true, company: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.company.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);

  const pending = requests.filter(r => r.status === 'PENDING').length;
  const approved = requests.filter(r => r.status === 'APPROVED').length;
  const rejected = requests.filter(r => r.status === 'REJECTED').length;
  const canApprove = session.role === 'SUPER_ADMIN' || session.role === 'FINANCE';

  return (
    <main className="min-h-screen bg-slate-50 p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-4 bg-white p-6 rounded-xl border border-slate-200 shadow-sm md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-500">行政审批</p>
            <h1 className="text-2xl font-bold text-slate-900">考勤申请</h1>
          </div>
          <Link href="/dashboard" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
            返回看板
          </Link>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          <Stat label="待审批" value={pending} tone="amber" />
          <Stat label="已通过" value={approved} tone="green" />
          <Stat label="已驳回" value={rejected} tone="red" />
        </section>

        <section className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <form action={createAttendance} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900">新建申请</h2>
            <label className="block text-sm font-medium text-slate-700">
              类型
              <select name="type" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
                <option value="LEAVE">请假</option>
                <option value="OVERTIME">加班</option>
                <option value="FIELD">外勤</option>
                <option value="REMOTE">远程办公</option>
              </select>
            </label>
            <label className="block text-sm font-medium text-slate-700">
              子类型
              <input name="subType" placeholder="年假/病假/客户拜访" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-medium text-slate-700">
                开始
                <input required name="startDate" type="date" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                结束
                <input required name="endDate" type="date" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
              </label>
            </div>
            <label className="block text-sm font-medium text-slate-700">
              关联客户
              <select name="companyId" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
                <option value="">不关联客户</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium text-slate-700">
              原因
              <textarea required name="reason" rows={4} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <button className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700">
              提交申请
            </button>
          </form>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="p-4">申请人</th>
                  <th className="p-4">类型</th>
                  <th className="p-4">时间</th>
                  <th className="p-4">原因</th>
                  <th className="p-4">状态</th>
                  <th className="p-4 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {requests.length === 0 && <tr><td colSpan={6} className="p-10 text-center text-slate-400">暂无考勤申请</td></tr>}
                {requests.map(r => (
                  <tr key={r.id} className="align-top hover:bg-slate-50">
                    <td className="p-4 font-semibold text-slate-800">{r.submittedBy.name || r.submittedBy.email}</td>
                    <td className="p-4 text-slate-700">{typeText[r.type] || r.type}<br /><span className="text-xs text-slate-400">{r.subType || r.company?.name || '-'}</span></td>
                    <td className="p-4 text-slate-600">{r.startDate.toLocaleDateString('zh-CN')} - {r.endDate.toLocaleDateString('zh-CN')}</td>
                    <td className="p-4 max-w-xs text-slate-600">{r.reason}</td>
                    <td className="p-4"><span className={`rounded-full border px-2 py-1 text-xs font-bold ${statusClass(r.status)}`}>{statusText[r.status] || r.status}</span></td>
                    <td className="p-4 text-right">
                      {canApprove && r.status === 'PENDING' ? (
                        <div className="flex justify-end gap-2">
                          <StatusButton action={updateAttendance} id={r.id} status="APPROVED" label="通过" />
                          <StatusButton action={updateAttendance} id={r.id} status="REJECTED" label="驳回" />
                        </div>
                      ) : <span className="text-xs text-slate-400">{r.approvedBy?.name || '-'}</span>}
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

function Stat({ label, value, tone }: { label: string; value: number; tone: 'amber' | 'green' | 'red' }) {
  const colors = {
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    green: 'border-green-200 bg-green-50 text-green-700',
    red: 'border-red-200 bg-red-50 text-red-700',
  }[tone];
  return <div className={`rounded-xl border p-5 shadow-sm ${colors}`}><p className="text-sm font-semibold">{label}</p><p className="mt-2 text-3xl font-black">{value}</p></div>;
}

function StatusButton({ action, id, status, label }: { action: (formData: FormData) => Promise<void>; id: string; status: string; label: string }) {
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100">{label}</button>
    </form>
  );
}

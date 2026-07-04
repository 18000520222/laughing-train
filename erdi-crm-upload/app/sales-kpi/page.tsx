import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

async function currentUser() {
  const role = (cookies().get('auth_role')?.value || '').toUpperCase();
  const email = cookies().get('auth_email')?.value || '';
  if (role !== 'SUPER_ADMIN' && role !== 'ADMIN' && role !== 'SALES') redirect('/dashboard');
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) redirect('/dashboard');
  return { user, role };
}

async function saveKpiTarget(formData: FormData) {
  'use server';
  const { role } = await currentUser();
  if (role !== 'SUPER_ADMIN' && role !== 'ADMIN') return;

  const ownerId = String(formData.get('ownerId') || '');
  const periodRaw = String(formData.get('period') || '');
  const periodStart = parseMonth(periodRaw);
  if (!ownerId || !periodStart) return;

  const owner = await prisma.user.findFirst({
    where: { id: ownerId, role: { in: ['SUPER_ADMIN', 'ADMIN', 'SALES'] as any }, isActive: true },
    select: { id: true },
  });
  if (!owner) return;

  await prisma.salesKpiTarget.upsert({
    where: { ownerId_periodStart: { ownerId, periodStart } },
    update: {
      revenueTargetUSD: numberInput(formData.get('revenueTargetUSD')),
      wonDealsTarget: intInput(formData.get('wonDealsTarget')),
      newCustomersTarget: intInput(formData.get('newCustomersTarget')),
      completedTasksTarget: intInput(formData.get('completedTasksTarget')),
      onTimeRateTarget: percentInput(formData.get('onTimeRateTarget')),
      notes: String(formData.get('notes') || '').trim() || null,
    },
    create: {
      ownerId,
      periodStart,
      revenueTargetUSD: numberInput(formData.get('revenueTargetUSD')),
      wonDealsTarget: intInput(formData.get('wonDealsTarget')),
      newCustomersTarget: intInput(formData.get('newCustomersTarget')),
      completedTasksTarget: intInput(formData.get('completedTasksTarget')),
      onTimeRateTarget: percentInput(formData.get('onTimeRateTarget')),
      notes: String(formData.get('notes') || '').trim() || null,
    },
  });
  redirect(`/sales-kpi?period=${formatMonth(periodStart)}`);
}

export default async function SalesKpiPage(props: any) {
  const { user, role } = await currentUser();
  const canManage = role === 'SUPER_ADMIN' || role === 'ADMIN';
  const requestedPeriod = parseMonth(String(props.searchParams?.period || '')) || monthStart(new Date());
  const nextPeriod = addMonths(requestedPeriod, 1);
  const previousMonth = formatMonth(addMonths(requestedPeriod, -1));
  const nextMonth = formatMonth(nextPeriod);
  const periodLabel = formatMonthLabel(requestedPeriod);

  const users = await prisma.user.findMany({
    where: {
      role: { in: ['SUPER_ADMIN', 'ADMIN', 'SALES'] as any },
      isActive: true,
      ...(canManage ? {} : { id: user.id }),
    },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
  });
  const userIds = users.map((item) => item.id);

  const targets = await prisma.salesKpiTarget.findMany({
    where: { periodStart: requestedPeriod, ownerId: { in: userIds } },
  });
  const targetByOwner = new Map(targets.map((target) => [target.ownerId, target]));
  const rows = await Promise.all(users.map(async (owner) => {
    const [wonOpps, newCustomers, completedTasks, openOpps, overdueTasks] = await Promise.all([
      prisma.opportunity.findMany({
        where: { ownerId: owner.id, stage: 'CLOSED_WON', stageChangedAt: { gte: requestedPeriod, lt: nextPeriod } },
        select: { amountUSD: true },
      }),
      prisma.company.count({ where: { ownerId: owner.id, createdAt: { gte: requestedPeriod, lt: nextPeriod } } }),
      prisma.salesTask.findMany({
        where: { ownerId: owner.id, status: 'DONE', completedAt: { gte: requestedPeriod, lt: nextPeriod } },
        select: { dueAt: true, completedAt: true },
      }),
      prisma.opportunity.findMany({
        where: { ownerId: owner.id, stage: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] as any } },
        select: { amountUSD: true },
      }),
      prisma.salesTask.count({ where: { ownerId: owner.id, status: 'TODO', dueAt: { lt: new Date() } } }),
    ]);
    const target = targetByOwner.get(owner.id);
    const revenue = wonOpps.reduce((sum, opp) => sum + (opp.amountUSD || 0), 0);
    const openPipeline = openOpps.reduce((sum, opp) => sum + (opp.amountUSD || 0), 0);
    const tasksWithDue = completedTasks.filter((task) => task.dueAt && task.completedAt);
    const onTimeTasks = tasksWithDue.filter((task) => task.completedAt && task.dueAt && task.completedAt.getTime() <= task.dueAt.getTime()).length;
    const onTimeRate = tasksWithDue.length > 0 ? onTimeTasks / tasksWithDue.length : null;

    return {
      owner,
      target,
      revenue,
      wonDeals: wonOpps.length,
      newCustomers,
      completedTasks: completedTasks.length,
      onTimeRate,
      openPipeline,
      overdueTasks,
      score: average([
        progress(revenue, target?.revenueTargetUSD || 0),
        progress(wonOpps.length, target?.wonDealsTarget || 0),
        progress(newCustomers, target?.newCustomersTarget || 0),
        progress(completedTasks.length, target?.completedTasksTarget || 0),
        target?.onTimeRateTarget ? (onTimeRate === null ? 0 : Math.min(1, onTimeRate / target.onTimeRateTarget)) : null,
      ]),
    };
  }));

  const team = rows.reduce((acc, row) => {
    acc.revenue += row.revenue;
    acc.revenueTarget += row.target?.revenueTargetUSD || 0;
    acc.wonDeals += row.wonDeals;
    acc.wonTarget += row.target?.wonDealsTarget || 0;
    acc.customers += row.newCustomers;
    acc.customerTarget += row.target?.newCustomersTarget || 0;
    acc.tasks += row.completedTasks;
    acc.taskTarget += row.target?.completedTasksTarget || 0;
    acc.pipeline += row.openPipeline;
    acc.overdue += row.overdueTasks;
    return acc;
  }, { revenue: 0, revenueTarget: 0, wonDeals: 0, wonTarget: 0, customers: 0, customerTarget: 0, tasks: 0, taskTarget: 0, pipeline: 0, overdue: 0 });

  return (
    <div className="min-h-screen bg-gray-50 p-6 md:p-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-gray-900">销售 KPI 目标</h1>
          <p className="mt-1 text-sm text-gray-500">按月追踪收入、赢单、新客户、任务完成和任务准时率。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/sales-kpi?period=${previousMonth}`} className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-black text-gray-700 hover:bg-gray-50">上月</Link>
          <Link href={`/sales-kpi?period=${formatMonth(monthStart(new Date()))}`} className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-black text-indigo-700 hover:bg-indigo-100">本月</Link>
          <Link href={`/sales-kpi?period=${nextMonth}`} className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-black text-gray-700 hover:bg-gray-50">下月</Link>
          <Link href="/sales-command" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-black text-rose-700 hover:bg-rose-100">销售指挥台</Link>
          <Link href="/tasks" className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-black text-blue-700 hover:bg-blue-100">销售任务</Link>
        </div>
      </header>

      <section className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <KpiMetric label={`${periodLabel} 收入`} value={`$${Math.round(team.revenue).toLocaleString()}`} target={`目标 $${Math.round(team.revenueTarget).toLocaleString()}`} rate={progress(team.revenue, team.revenueTarget)} />
        <KpiMetric label="赢单" value={team.wonDeals} target={`目标 ${team.wonTarget}`} rate={progress(team.wonDeals, team.wonTarget)} />
        <KpiMetric label="新增客户" value={team.customers} target={`目标 ${team.customerTarget}`} rate={progress(team.customers, team.customerTarget)} />
        <KpiMetric label="完成任务" value={team.tasks} target={`目标 ${team.taskTarget}`} rate={progress(team.tasks, team.taskTarget)} />
        <KpiMetric label="当前逾期任务" value={team.overdue} target={`管道 $${Math.round(team.pipeline).toLocaleString()}`} rate={team.overdue === 0 ? 1 : 0} inverse />
      </section>

      {canManage && (
        <section className="mb-6 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-black text-gray-900">设置月度目标</h2>
          <form action={saveKpiTarget} className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-7">
            <label className="text-xs font-black text-gray-500">
              月份
              <input name="period" type="month" defaultValue={formatMonth(requestedPeriod)} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:border-indigo-400" />
            </label>
            <label className="text-xs font-black text-gray-500">
              负责人
              <select name="ownerId" className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:border-indigo-400">
                {users.map((item) => (
                  <option key={item.id} value={item.id}>{item.name || item.email}</option>
                ))}
              </select>
            </label>
            <TargetInput name="revenueTargetUSD" label="收入目标 USD" />
            <TargetInput name="wonDealsTarget" label="赢单目标" />
            <TargetInput name="newCustomersTarget" label="新客户目标" />
            <TargetInput name="completedTasksTarget" label="任务目标" />
            <label className="text-xs font-black text-gray-500">
              准时率目标 %
              <input name="onTimeRateTarget" type="number" min="0" max="100" defaultValue="80" className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:border-indigo-400" />
            </label>
            <label className="text-xs font-black text-gray-500 md:col-span-2 xl:col-span-6">
              备注
              <input name="notes" placeholder="例如: 本月重点推进德国/中东渠道,收入目标按已报价大客户拆分。" className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:border-indigo-400" />
            </label>
            <div className="flex items-end">
              <button className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-black text-white hover:bg-indigo-700">保存目标</button>
            </div>
          </form>
        </section>
      )}

      <section className="rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-6 py-4">
          <h2 className="font-black text-gray-900">人员 KPI 达成</h2>
          <p className="mt-1 text-xs text-gray-400">收入按本月赢单商机 `stageChangedAt` 统计;任务准时率按已完成且有截止时间的任务统计。</p>
        </div>
        <div className="divide-y divide-gray-50">
          {rows.map((row) => (
            <KpiRow key={row.owner.id} row={row} />
          ))}
          {rows.length === 0 && <div className="p-12 text-center text-sm text-gray-400">暂无可统计人员。</div>}
        </div>
      </section>
    </div>
  );
}

function KpiRow({ row }: { row: any }) {
  return (
    <div className="p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-lg font-black text-gray-900">{row.owner.name || row.owner.email}</div>
          <div className="mt-1 text-xs font-bold text-gray-400">{row.owner.role} · 综合达成 {formatPercent(row.score)}</div>
        </div>
        <div className={`rounded-full px-3 py-1 text-xs font-black ${row.score >= 1 ? 'bg-emerald-50 text-emerald-700' : row.score >= 0.7 ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'}`}>
          {row.score >= 1 ? '达标' : row.score >= 0.7 ? '追赶中' : '需关注'}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <ProgressCell label="收入" value={`$${Math.round(row.revenue).toLocaleString()}`} target={`$${Math.round(row.target?.revenueTargetUSD || 0).toLocaleString()}`} rate={progress(row.revenue, row.target?.revenueTargetUSD || 0)} />
        <ProgressCell label="赢单" value={row.wonDeals} target={row.target?.wonDealsTarget || 0} rate={progress(row.wonDeals, row.target?.wonDealsTarget || 0)} />
        <ProgressCell label="新客户" value={row.newCustomers} target={row.target?.newCustomersTarget || 0} rate={progress(row.newCustomers, row.target?.newCustomersTarget || 0)} />
        <ProgressCell label="完成任务" value={row.completedTasks} target={row.target?.completedTasksTarget || 0} rate={progress(row.completedTasks, row.target?.completedTasksTarget || 0)} />
        <ProgressCell label="准时率" value={row.onTimeRate === null ? '-' : formatPercent(row.onTimeRate)} target={formatPercent(row.target?.onTimeRateTarget ?? 0.8)} rate={row.target?.onTimeRateTarget ? (row.onTimeRate === null ? 0 : Math.min(1, row.onTimeRate / row.target.onTimeRateTarget)) : null} />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs font-bold text-gray-400">
        <span>当前管道:${Math.round(row.openPipeline).toLocaleString()}</span>
        <span>逾期任务:{row.overdueTasks}</span>
        {row.target?.notes && <span>备注:{row.target.notes}</span>}
      </div>
    </div>
  );
}

function KpiMetric({ label, value, target, rate, inverse = false }: { label: string; value: string | number; target: string; rate: number | null; inverse?: boolean }) {
  const good = inverse ? rate === 1 : (rate || 0) >= 1;
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="text-xs font-bold text-gray-500">{label}</div>
      <div className={`mt-1 text-2xl font-black ${good ? 'text-emerald-700' : 'text-gray-900'}`}>{value}</div>
      <div className="mt-1 text-xs font-bold text-gray-400">{target}</div>
      <ProgressBar rate={rate} />
    </div>
  );
}

function ProgressCell({ label, value, target, rate }: { label: string; value: string | number; target: string | number; rate: number | null }) {
  return (
    <div className="rounded-xl bg-gray-50 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-black text-gray-500">{label}</span>
        <span className="text-xs font-black text-gray-400">{formatPercent(rate)}</span>
      </div>
      <div className="mt-1 text-lg font-black text-gray-900">{value}</div>
      <div className="text-xs font-bold text-gray-400">目标 {target}</div>
      <ProgressBar rate={rate} />
    </div>
  );
}

function ProgressBar({ rate }: { rate: number | null }) {
  const pct = rate === null ? 0 : Math.max(0, Math.min(100, Math.round(rate * 100)));
  const color = pct >= 100 ? 'bg-emerald-500' : pct >= 70 ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-200">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function TargetInput({ name, label }: { name: string; label: string }) {
  return (
    <label className="text-xs font-black text-gray-500">
      {label}
      <input name={name} type="number" min="0" step="1" defaultValue="0" className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:border-indigo-400" />
    </label>
  );
}

function monthStart(date: Date) {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0));
}

function addMonths(date: Date, months: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1, 0, 0, 0, 0));
}

function parseMonth(value: string) {
  if (!/^\d{4}-\d{2}$/.test(value)) return null;
  const [year, month] = value.split('-').map(Number);
  if (!year || !month || month < 1 || month > 12) return null;
  return new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
}

function formatMonth(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(date: Date) {
  return `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月`;
}

function numberInput(value: FormDataEntryValue | null) {
  const next = Number(value || 0);
  return Number.isFinite(next) && next > 0 ? next : 0;
}

function intInput(value: FormDataEntryValue | null) {
  return Math.max(0, Math.round(numberInput(value)));
}

function percentInput(value: FormDataEntryValue | null) {
  const next = Number(value || 80);
  if (!Number.isFinite(next)) return 0.8;
  return Math.max(0, Math.min(1, next / 100));
}

function progress(actual: number, target: number) {
  if (!target || target <= 0) return null;
  return Math.min(1.5, actual / target);
}

function average(values: Array<number | null>) {
  const usable = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (usable.length === 0) return 0;
  return usable.reduce((sum, value) => sum + Math.min(1, value), 0) / usable.length;
}

function formatPercent(value: number | null) {
  if (value === null) return '-';
  return `${Math.round(value * 100)}%`;
}

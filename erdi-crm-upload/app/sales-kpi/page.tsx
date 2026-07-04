import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  addMonths,
  formatMonth,
  formatMonthLabel,
  formatPercent,
  generateKpiRecoveryTasks,
  getSalesKpiRows,
  monthStart,
  parseMonth,
  progress,
} from '@/lib/sales-kpi-watch';

export const dynamic = 'force-dynamic';

const KPI_RECOVERY_LABEL: Record<string, string> = {
  revenue: '收入',
  wonDeals: '赢单',
  newCustomers: '新增客户',
  completedTasks: '完成任务',
  onTimeRate: '准时率',
};

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

async function createKpiRecoveryTasks(formData: FormData) {
  'use server';
  const { user, role } = await currentUser();
  const periodStart = parseMonth(String(formData.get('period') || '')) || monthStart(new Date());
  const requestedOwnerId = String(formData.get('ownerId') || '');
  const ownerId = role === 'SALES' ? user.id : requestedOwnerId || undefined;

  if (ownerId) {
    const owner = await prisma.user.findFirst({
      where: { id: ownerId, isActive: true, role: { in: ['SUPER_ADMIN', 'ADMIN', 'SALES'] as any } },
      select: { id: true },
    });
    if (!owner) return;
  }

  await generateKpiRecoveryTasks({ periodStart, ownerId, createdById: user.id, limit: 50 });
  redirect(`/sales-kpi?period=${formatMonth(periodStart)}&kpiAction=generated`);
}

export default async function SalesKpiPage(props: any) {
  const { user, role } = await currentUser();
  const canManage = role === 'SUPER_ADMIN' || role === 'ADMIN';
  const requestedPeriod = parseMonth(String(props.searchParams?.period || '')) || monthStart(new Date());
  const nextPeriod = addMonths(requestedPeriod, 1);
  const previousMonth = formatMonth(addMonths(requestedPeriod, -1));
  const nextMonth = formatMonth(nextPeriod);
  const periodLabel = formatMonthLabel(requestedPeriod);

  const { rows, team, expectedPace } = await getSalesKpiRows({
    periodStart: requestedPeriod,
    ownerIds: canManage ? undefined : [user.id],
  });
  const users = rows.map((row) => row.owner);
  const recoveryRecap = await getKpiRecoveryRecap({
    periodStart: requestedPeriod,
    owners: users,
  });
  const totalGaps = rows.reduce((sum, row) => sum + row.gaps.length, 0);
  const criticalGaps = rows.reduce((sum, row) => sum + row.gaps.filter((gap) => gap.severity === 'critical').length, 0);
  const actionGenerated = props.searchParams?.kpiAction === 'generated';

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

      {actionGenerated && (
        <div className="mb-6 rounded-2xl border border-emerald-100 bg-emerald-50 px-5 py-4 text-sm font-bold text-emerald-800">
          已扫描 KPI 落后项并生成可执行补救任务;已存在的同月同项任务不会重复创建。
        </div>
      )}

      <section className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <KpiMetric label={`${periodLabel} 收入`} value={`$${Math.round(team.revenue).toLocaleString()}`} target={`目标 $${Math.round(team.revenueTarget).toLocaleString()}`} rate={progress(team.revenue, team.revenueTarget)} />
        <KpiMetric label="赢单" value={team.wonDeals} target={`目标 ${team.wonTarget}`} rate={progress(team.wonDeals, team.wonTarget)} />
        <KpiMetric label="新增客户" value={team.customers} target={`目标 ${team.customerTarget}`} rate={progress(team.customers, team.customerTarget)} />
        <KpiMetric label="完成任务" value={team.tasks} target={`目标 ${team.taskTarget}`} rate={progress(team.tasks, team.taskTarget)} />
        <KpiMetric label="当前逾期任务" value={team.overdue} target={`管道 $${Math.round(team.pipeline).toLocaleString()}`} rate={team.overdue === 0 ? 1 : 0} inverse />
      </section>

      <section className="mb-6 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-black text-gray-900">目标落后预警</h2>
            <p className="mt-1 text-xs font-bold text-gray-400">按本月时间进度 {formatPercent(expectedPace)} 校验收入、赢单、新客户、任务和准时率;低于节奏会拆成销售任务。</p>
          </div>
          <form action={createKpiRecoveryTasks}>
            <input type="hidden" name="period" value={formatMonth(requestedPeriod)} />
            <button className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-black text-white hover:bg-rose-700">
              {canManage ? '一键拆解全员补救任务' : '生成我的补救任务'}
            </button>
          </form>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <AlertMetric label="预警项" value={totalGaps} tone={totalGaps > 0 ? 'amber' : 'emerald'} />
          <AlertMetric label="严重落后" value={criticalGaps} tone={criticalGaps > 0 ? 'rose' : 'emerald'} />
          <AlertMetric label="需关注人员" value={rows.filter((row) => row.gaps.length > 0).length} tone={totalGaps > 0 ? 'amber' : 'emerald'} />
        </div>
        <div className="mt-4 grid gap-3 xl:grid-cols-2">
          {rows.filter((row) => row.gaps.length > 0).slice(0, 6).map((row) => (
            <div key={row.owner.id} className="rounded-xl border border-amber-100 bg-amber-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-black text-gray-900">{row.owner.name || row.owner.email}</div>
                <form action={createKpiRecoveryTasks}>
                  <input type="hidden" name="period" value={formatMonth(requestedPeriod)} />
                  <input type="hidden" name="ownerId" value={row.owner.id} />
                  <button className="rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-xs font-black text-amber-700 hover:bg-amber-100">拆解此人任务</button>
                </form>
              </div>
              <div className="mt-3 space-y-2">
                {row.gaps.slice(0, 4).map((gap) => (
                  <div key={gap.key} className="rounded-lg bg-white px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-black ${gap.severity === 'critical' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>{gap.severity === 'critical' ? '严重' : '预警'}</span>
                      <span className="text-xs font-black text-gray-900">{gap.label}</span>
                      <span className="text-xs font-bold text-gray-500">{gap.actual} / {gap.target}</span>
                    </div>
                    <div className="mt-1 text-xs font-bold text-gray-500">{gap.message}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {totalGaps === 0 && (
            <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4 text-sm font-bold text-emerald-800">
              当前没有低于时间进度的 KPI 项。继续保持任务准时和商机推进节奏。
            </div>
          )}
        </div>
      </section>

      <section className="mb-6 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-black text-gray-900">KPI 补救效果复盘</h2>
            <p className="mt-1 text-xs font-bold text-gray-400">只统计 {periodLabel} 由 KPI 自动拆解生成的补救任务,用于复盘拆解后是否真的补回执行。</p>
          </div>
          <Link href="/tasks?view=week" className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-black text-blue-700 hover:bg-blue-100">进入任务中心</Link>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <RecoveryMetric label="补救任务" value={recoveryRecap.total} detail={`待处理 ${recoveryRecap.open}`} tone={recoveryRecap.total > 0 ? 'blue' : 'gray'} />
          <RecoveryMetric label="已完成" value={recoveryRecap.done} detail={`平均关闭 ${recoveryRecap.avgCloseHours === null ? '-' : `${recoveryRecap.avgCloseHours}小时`}`} tone={recoveryRecap.done > 0 ? 'emerald' : 'gray'} />
          <RecoveryMetric label="完成率" value={formatPercent(recoveryRecap.completionRate)} detail={`24小时内到期 ${recoveryRecap.dueSoon}`} tone={(recoveryRecap.completionRate || 0) >= 0.8 ? 'emerald' : recoveryRecap.total > 0 ? 'amber' : 'gray'} />
          <RecoveryMetric label="逾期补救" value={recoveryRecap.overdue} detail={`逾期率 ${formatPercent(recoveryRecap.overdueRate)}`} tone={recoveryRecap.overdue > 0 ? 'rose' : 'emerald'} />
        </div>
        <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm font-bold text-indigo-900">
          {recoveryRecap.recommendation}
        </div>
        <div className="mt-4 grid gap-4 xl:grid-cols-3">
          <div className="rounded-xl border border-gray-100 p-4">
            <h3 className="text-xs font-black text-gray-500">按指标复盘</h3>
            <div className="mt-3 space-y-3">
              {recoveryRecap.byIndicator.map((item) => (
                <RecoveryBreakdownRow key={item.key} label={item.label} total={item.total} done={item.done} overdue={item.overdue} />
              ))}
              {recoveryRecap.byIndicator.length === 0 && <div className="rounded-lg bg-gray-50 p-3 text-xs font-bold text-gray-400">暂无已拆解的 KPI 补救任务。</div>}
            </div>
          </div>
          <div className="rounded-xl border border-gray-100 p-4">
            <h3 className="text-xs font-black text-gray-500">人员补救执行</h3>
            <div className="mt-3 space-y-3">
              {recoveryRecap.byOwner.slice(0, 6).map((item) => (
                <RecoveryBreakdownRow key={item.ownerId} label={item.ownerName} total={item.total} done={item.done} overdue={item.overdue} />
              ))}
              {recoveryRecap.byOwner.length === 0 && <div className="rounded-lg bg-gray-50 p-3 text-xs font-bold text-gray-400">本月暂无人员补救执行记录。</div>}
            </div>
          </div>
          <div className="rounded-xl border border-gray-100 p-4">
            <h3 className="text-xs font-black text-gray-500">仍需处理</h3>
            <div className="mt-3 space-y-2">
              {recoveryRecap.openTasks.map((task) => (
                <div key={task.id} className={`rounded-lg border px-3 py-2 ${task.isOverdue ? 'border-rose-100 bg-rose-50' : 'border-gray-100 bg-gray-50'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 truncate text-xs font-black text-gray-900">{task.title}</div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-black ${task.isOverdue ? 'bg-rose-100 text-rose-700' : 'bg-blue-100 text-blue-700'}`}>
                      {task.isOverdue ? '逾期' : task.priorityLabel}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-bold text-gray-500">
                    <span>{task.ownerName}</span>
                    <Link href={`/customers/${task.companyId}`} className="text-blue-700 hover:underline">{task.companyName}</Link>
                    <span>{task.dueLabel}</span>
                  </div>
                </div>
              ))}
              {recoveryRecap.openTasks.length === 0 && <div className="rounded-lg bg-emerald-50 p-3 text-xs font-bold text-emerald-700">没有未完成的 KPI 补救任务。</div>}
            </div>
          </div>
        </div>
        <div className="mt-4 rounded-xl border border-gray-100 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-xs font-black text-gray-500">补救后业务归因</h3>
              <p className="mt-1 text-[11px] font-bold text-gray-400">只把同客户、同负责人、补救任务完成后、本月内发生的赢单和后续完成动作计入归因;同一赢单只归给最近一次已完成补救。</p>
            </div>
            <span className="rounded-full bg-gray-50 px-3 py-1 text-[11px] font-black text-gray-500">保守归因</span>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <RecoveryMetric label="归因收入" value={`$${Math.round(recoveryRecap.attribution.revenue).toLocaleString()}`} detail={`${recoveryRecap.attribution.wonDeals} 个赢单`} tone={recoveryRecap.attribution.revenue > 0 ? 'emerald' : 'gray'} />
            <RecoveryMetric label="有效补救率" value={formatPercent(recoveryRecap.attribution.effectiveRate)} detail={`${recoveryRecap.attribution.effectiveTasks}/${recoveryRecap.done} 个完成补救产生结果`} tone={(recoveryRecap.attribution.effectiveRate || 0) >= 0.5 ? 'emerald' : recoveryRecap.done > 0 ? 'amber' : 'gray'} />
            <RecoveryMetric label="后续完成动作" value={recoveryRecap.attribution.downstreamTasks} detail="不含原 KPI 补救任务" tone={recoveryRecap.attribution.downstreamTasks > 0 ? 'blue' : 'gray'} />
            <RecoveryMetric label="有效客户" value={recoveryRecap.attribution.companies} detail={recoveryRecap.attribution.recommendationTone} tone={recoveryRecap.attribution.companies > 0 ? 'emerald' : 'gray'} />
          </div>
          <div className="mt-4 rounded-lg bg-gray-50 px-4 py-3 text-xs font-bold text-gray-600">
            {recoveryRecap.attribution.recommendation}
          </div>
          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <div>
              <h4 className="text-xs font-black text-gray-500">按指标归因</h4>
              <div className="mt-3 space-y-3">
                {recoveryRecap.attribution.byIndicator.map((item) => (
                  <AttributionBreakdownRow key={item.key} label={item.label} total={item.recoveryDone} revenue={item.revenue} wonDeals={item.wonDeals} downstreamTasks={item.downstreamTasks} />
                ))}
                {recoveryRecap.attribution.byIndicator.length === 0 && <div className="rounded-lg bg-white p-3 text-xs font-bold text-gray-400">暂无已完成补救任务可归因。</div>}
              </div>
            </div>
            <div>
              <h4 className="text-xs font-black text-gray-500">人员结果归因</h4>
              <div className="mt-3 space-y-3">
                {recoveryRecap.attribution.byOwner.slice(0, 6).map((item) => (
                  <AttributionBreakdownRow key={item.key} label={item.label} total={item.recoveryDone} revenue={item.revenue} wonDeals={item.wonDeals} downstreamTasks={item.downstreamTasks} />
                ))}
                {recoveryRecap.attribution.byOwner.length === 0 && <div className="rounded-lg bg-white p-3 text-xs font-bold text-gray-400">暂无人员归因结果。</div>}
              </div>
            </div>
            <div>
              <h4 className="text-xs font-black text-gray-500">关键客户结果</h4>
              <div className="mt-3 space-y-2">
                {recoveryRecap.attribution.topCompanies.map((item) => (
                  <div key={`${item.taskId}-${item.companyId}`} className="rounded-lg border border-gray-100 bg-white px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <Link href={`/customers/${item.companyId}`} className="min-w-0 truncate text-xs font-black text-blue-700 hover:underline">{item.companyName}</Link>
                      <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-black text-emerald-700">{item.metricLabel}</span>
                    </div>
                    <div className="mt-1 text-[11px] font-bold text-gray-500">{item.ownerName} · 收入 ${Math.round(item.revenue).toLocaleString()} · 赢单 {item.wonDeals} · 后续动作 {item.downstreamTasks}</div>
                    <div className="mt-1 truncate text-[11px] font-bold text-gray-400">{item.taskTitle}</div>
                  </div>
                ))}
                {recoveryRecap.attribution.topCompanies.length === 0 && <div className="rounded-lg bg-white p-3 text-xs font-bold text-gray-400">暂无可归因的客户结果。</div>}
              </div>
            </div>
          </div>
        </div>
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

async function getKpiRecoveryRecap({ periodStart, owners }: {
  periodStart: Date;
  owners: Array<{ id: string; email: string; name: string | null; role: string }>;
}) {
  const ownerIds = owners.map((owner) => owner.id);
  const now = new Date();
  const periodKey = formatMonth(periodStart);
  const tasks = ownerIds.length > 0
    ? await prisma.salesTask.findMany({
      where: {
        ownerId: { in: ownerIds },
        source: 'KPI_AUTO_SPLIT',
        sourceRef: { startsWith: `kpi:${periodKey}:` },
      },
      include: {
        owner: { select: { id: true, email: true, name: true } },
        company: { select: { id: true, name: true } },
      },
      orderBy: [{ status: 'asc' }, { dueAt: 'asc' }, { createdAt: 'desc' }],
      take: 400,
    })
    : [];

  const doneTasks = tasks.filter((task) => task.status === 'DONE');
  const openTasks = tasks.filter((task) => task.status === 'TODO');
  const overdueTasks = openTasks.filter((task) => task.dueAt && task.dueAt.getTime() < now.getTime());
  const dueSoonTasks = openTasks.filter((task) => {
    if (!task.dueAt || task.dueAt.getTime() < now.getTime()) return false;
    return task.dueAt.getTime() <= now.getTime() + 24 * 60 * 60 * 1000;
  });
  const closeHours = doneTasks
    .filter((task) => task.completedAt)
    .map((task) => Math.max(0, (task.completedAt!.getTime() - task.createdAt.getTime()) / 36e5));
  const avgCloseHours = closeHours.length > 0 ? Math.round(closeHours.reduce((sum, item) => sum + item, 0) / closeHours.length) : null;

  const byIndicator = Object.entries(KPI_RECOVERY_LABEL).map(([key, label]) => {
    const bucket = tasks.filter((task) => parseKpiRecoveryKey(task.sourceRef) === key);
    const done = bucket.filter((task) => task.status === 'DONE').length;
    const overdue = bucket.filter((task) => task.status === 'TODO' && task.dueAt && task.dueAt.getTime() < now.getTime()).length;
    return { key, label, total: bucket.length, done, overdue, completionRate: bucket.length > 0 ? done / bucket.length : null };
  }).filter((item) => item.total > 0);

  const ownerById = new Map(owners.map((owner) => [owner.id, owner]));
  const byOwner = ownerIds.map((ownerId) => {
    const owner = ownerById.get(ownerId);
    const bucket = tasks.filter((task) => task.ownerId === ownerId);
    const done = bucket.filter((task) => task.status === 'DONE').length;
    const overdue = bucket.filter((task) => task.status === 'TODO' && task.dueAt && task.dueAt.getTime() < now.getTime()).length;
    return {
      ownerId,
      ownerName: owner?.name || owner?.email || '未命名',
      total: bucket.length,
      done,
      overdue,
      completionRate: bucket.length > 0 ? done / bucket.length : null,
    };
  }).filter((item) => item.total > 0).sort((a, b) => b.overdue - a.overdue || b.total - a.total || a.ownerName.localeCompare(b.ownerName));

  const openTaskRows = openTasks
    .map((task) => ({
      id: task.id,
      title: task.title,
      priorityLabel: priorityLabel(task.priority),
      ownerName: task.owner.name || task.owner.email,
      companyId: task.company.id,
      companyName: task.company.name,
      dueLabel: formatDue(task.dueAt, now),
      isOverdue: Boolean(task.dueAt && task.dueAt.getTime() < now.getTime()),
      dueAt: task.dueAt,
    }))
    .sort((a, b) => Number(b.isOverdue) - Number(a.isOverdue) || (a.dueAt?.getTime() || 0) - (b.dueAt?.getTime() || 0))
    .slice(0, 6);
  const attribution = await getKpiRecoveryAttribution({
    tasks,
    periodStart,
    periodEnd: addMonths(periodStart, 1),
  });

  const total = tasks.length;
  const done = doneTasks.length;
  const overdue = overdueTasks.length;
  const completionRate = total > 0 ? done / total : null;
  const overdueRate = total > 0 ? overdue / total : null;

  return {
    total,
    done,
    open: openTasks.length,
    overdue,
    dueSoon: dueSoonTasks.length,
    completionRate,
    overdueRate,
    avgCloseHours,
    byIndicator,
    byOwner,
    openTasks: openTaskRows,
    attribution,
    recommendation: kpiRecoveryRecommendation({ total, done, overdue, dueSoon: dueSoonTasks.length, completionRate }),
  };
}

async function getKpiRecoveryAttribution({ tasks, periodStart, periodEnd }: { tasks: any[]; periodStart: Date; periodEnd: Date }) {
  const doneRecoveryTasks = tasks.filter((task) => task.status === 'DONE' && task.completedAt);
  const ownerIds = Array.from(new Set(doneRecoveryTasks.map((task) => task.ownerId)));
  const companyIds = Array.from(new Set(doneRecoveryTasks.map((task) => task.companyId)));
  const empty = buildEmptyAttribution(doneRecoveryTasks);
  if (doneRecoveryTasks.length === 0 || ownerIds.length === 0 || companyIds.length === 0) return empty;

  const [wonOpps, downstreamTasks] = await Promise.all([
    prisma.opportunity.findMany({
      where: {
        ownerId: { in: ownerIds },
        companyId: { in: companyIds },
        stage: 'CLOSED_WON',
        stageChangedAt: { gte: periodStart, lt: periodEnd },
      },
      select: { id: true, title: true, amountUSD: true, companyId: true, ownerId: true, stageChangedAt: true },
    }),
    prisma.salesTask.findMany({
      where: {
        ownerId: { in: ownerIds },
        companyId: { in: companyIds },
        status: 'DONE',
        completedAt: { gte: periodStart, lt: periodEnd },
        source: { not: 'KPI_AUTO_SPLIT' },
      },
      select: { id: true, title: true, companyId: true, ownerId: true, completedAt: true },
    }),
  ]);

  const records = new Map<string, any>();
  for (const task of doneRecoveryTasks) {
    records.set(task.id, {
      taskId: task.id,
      taskTitle: task.title,
      metricKey: parseKpiRecoveryKey(task.sourceRef),
      metricLabel: KPI_RECOVERY_LABEL[parseKpiRecoveryKey(task.sourceRef)] || '其他',
      ownerId: task.ownerId,
      ownerName: task.owner.name || task.owner.email,
      companyId: task.companyId,
      companyName: task.company.name,
      recoveryDone: 1,
      revenue: 0,
      wonDeals: 0,
      downstreamTasks: 0,
      hasOutcome: false,
    });
  }

  for (const opp of wonOpps) {
    const task = findInfluencingRecoveryTask(doneRecoveryTasks, {
      ownerId: opp.ownerId,
      companyId: opp.companyId,
      outcomeAt: opp.stageChangedAt,
    });
    if (!task) continue;
    const record = records.get(task.id);
    record.revenue += opp.amountUSD || 0;
    record.wonDeals++;
    record.hasOutcome = true;
  }

  for (const taskOutcome of downstreamTasks) {
    if (!taskOutcome.completedAt) continue;
    const task = findInfluencingRecoveryTask(doneRecoveryTasks, {
      ownerId: taskOutcome.ownerId,
      companyId: taskOutcome.companyId,
      outcomeAt: taskOutcome.completedAt,
    });
    if (!task) continue;
    const record = records.get(task.id);
    record.downstreamTasks++;
    record.hasOutcome = true;
  }

  const rows = Array.from(records.values());
  const revenue = rows.reduce((sum, row) => sum + row.revenue, 0);
  const wonDeals = rows.reduce((sum, row) => sum + row.wonDeals, 0);
  const downstreamTaskCount = rows.reduce((sum, row) => sum + row.downstreamTasks, 0);
  const effectiveTasks = rows.filter((row) => row.hasOutcome).length;
  const companies = new Set(rows.filter((row) => row.hasOutcome).map((row) => row.companyId)).size;
  const byIndicator = Object.entries(KPI_RECOVERY_LABEL).map(([key, label]) => summarizeAttributionRows(key, label, rows.filter((row) => row.metricKey === key))).filter((item) => item.recoveryDone > 0);
  const byOwner = Array.from(new Set(rows.map((row) => row.ownerId))).map((ownerId) => {
    const ownerRows = rows.filter((row) => row.ownerId === ownerId);
    return summarizeAttributionRows(ownerId, ownerRows[0]?.ownerName || '未命名', ownerRows, { ownerId });
  }).filter((item) => item.recoveryDone > 0).sort((a, b) => b.revenue - a.revenue || b.wonDeals - a.wonDeals || b.downstreamTasks - a.downstreamTasks);
  const topCompanies = rows
    .filter((row) => row.hasOutcome)
    .sort((a, b) => b.revenue - a.revenue || b.wonDeals - a.wonDeals || b.downstreamTasks - a.downstreamTasks)
    .slice(0, 6);
  const effectiveRate = doneRecoveryTasks.length > 0 ? effectiveTasks / doneRecoveryTasks.length : null;

  return {
    revenue,
    wonDeals,
    downstreamTasks: downstreamTaskCount,
    effectiveTasks,
    companies,
    effectiveRate,
    byIndicator,
    byOwner,
    topCompanies,
    recommendationTone: companies > 0 ? '已有结果证据' : '等待业务结果',
    recommendation: kpiAttributionRecommendation({ revenue, wonDeals, downstreamTasks: downstreamTaskCount, effectiveTasks, doneRecovery: doneRecoveryTasks.length }),
  };
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

function RecoveryMetric({ label, value, detail, tone }: { label: string; value: string | number; detail: string; tone: 'blue' | 'emerald' | 'amber' | 'rose' | 'gray' }) {
  const color = tone === 'emerald'
    ? 'border-emerald-100 bg-emerald-50 text-emerald-800'
    : tone === 'amber'
      ? 'border-amber-100 bg-amber-50 text-amber-800'
      : tone === 'rose'
        ? 'border-rose-100 bg-rose-50 text-rose-800'
        : tone === 'blue'
          ? 'border-blue-100 bg-blue-50 text-blue-800'
          : 'border-gray-100 bg-gray-50 text-gray-700';
  return (
    <div className={`rounded-xl border p-4 ${color}`}>
      <div className="text-xs font-black opacity-75">{label}</div>
      <div className="mt-1 text-2xl font-black">{value}</div>
      <div className="mt-1 text-xs font-bold opacity-70">{detail}</div>
    </div>
  );
}

function RecoveryBreakdownRow({ label, total, done, overdue }: { label: string; total: number; done: number; overdue: number }) {
  const rate = total > 0 ? done / total : null;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs font-black text-gray-900">{label}</span>
        <span className="shrink-0 text-xs font-black text-gray-500">{done}/{total}</span>
      </div>
      <ProgressBar rate={rate} />
      <div className="mt-1 text-[11px] font-bold text-gray-400">完成率 {formatPercent(rate)} · 逾期 {overdue}</div>
    </div>
  );
}

function AttributionBreakdownRow({ label, total, revenue, wonDeals, downstreamTasks }: { label: string; total: number; revenue: number; wonDeals: number; downstreamTasks: number }) {
  const score = total > 0 ? Math.min(1, (wonDeals + downstreamTasks) / total) : null;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs font-black text-gray-900">{label}</span>
        <span className="shrink-0 text-xs font-black text-gray-500">{total} 个补救</span>
      </div>
      <ProgressBar rate={score} />
      <div className="mt-1 text-[11px] font-bold text-gray-400">收入 ${Math.round(revenue).toLocaleString()} · 赢单 {wonDeals} · 后续动作 {downstreamTasks}</div>
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

function AlertMetric({ label, value, tone }: { label: string; value: number; tone: 'emerald' | 'amber' | 'rose' }) {
  const color = tone === 'emerald' ? 'text-emerald-700 bg-emerald-50 border-emerald-100' : tone === 'rose' ? 'text-rose-700 bg-rose-50 border-rose-100' : 'text-amber-700 bg-amber-50 border-amber-100';
  return (
    <div className={`rounded-xl border p-4 ${color}`}>
      <div className="text-xs font-black opacity-75">{label}</div>
      <div className="mt-1 text-2xl font-black">{value}</div>
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

function parseKpiRecoveryKey(sourceRef: string | null) {
  const key = String(sourceRef || '').split(':').pop() || '';
  return KPI_RECOVERY_LABEL[key] ? key : 'unknown';
}

function priorityLabel(priority: string) {
  return priority === 'URGENT' ? '紧急' : priority === 'HIGH' ? '高' : priority === 'LOW' ? '低' : '普通';
}

function formatDue(value: Date | null, now: Date) {
  if (!value) return '无截止';
  const diffDays = Math.ceil((value.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays < 0) return `逾期 ${Math.abs(diffDays)} 天`;
  if (diffDays === 0) return '今天到期';
  if (diffDays === 1) return '明天到期';
  return `${diffDays} 天后到期`;
}

function kpiRecoveryRecommendation(input: { total: number; done: number; overdue: number; dueSoon: number; completionRate: number | null }) {
  if (input.total === 0) return '本月暂无 KPI 自动补救任务。若目标落后,先点击一键拆解,再用这里复盘执行闭环。';
  if (input.overdue > 0) return `有 ${input.overdue} 个 KPI 补救任务已经逾期,优先进入任务中心处理这些客户动作,避免拆了任务但没有补回结果。`;
  if (input.dueSoon > 0) return `有 ${input.dueSoon} 个 KPI 补救任务 24 小时内到期,今天需要集中清掉,防止明天变成逾期。`;
  if ((input.completionRate || 0) >= 0.8) return 'KPI 补救任务执行率良好,下一步应复盘哪些指标真的被补回,把有效打法固化到团队节奏。';
  return 'KPI 补救任务完成率偏低,建议按人员和指标逐项追问阻塞原因,必要时重新分派给更合适的负责人。';
}

function findInfluencingRecoveryTask(tasks: any[], outcome: { ownerId: string | null; companyId: string; outcomeAt: Date }) {
  const candidates = tasks
    .filter((task) => task.ownerId === outcome.ownerId && task.companyId === outcome.companyId && task.completedAt && task.completedAt.getTime() <= outcome.outcomeAt.getTime())
    .sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime());
  return candidates[0] || null;
}

function summarizeAttributionRows(key: string, label: string, rows: any[], extra: Record<string, any> = {}) {
  return {
    key,
    label,
    recoveryDone: rows.reduce((sum, row) => sum + row.recoveryDone, 0),
    revenue: rows.reduce((sum, row) => sum + row.revenue, 0),
    wonDeals: rows.reduce((sum, row) => sum + row.wonDeals, 0),
    downstreamTasks: rows.reduce((sum, row) => sum + row.downstreamTasks, 0),
    effectiveTasks: rows.filter((row) => row.hasOutcome).length,
    ...extra,
  };
}

function buildEmptyAttribution(doneRecoveryTasks: any[]) {
  const byIndicator = Object.entries(KPI_RECOVERY_LABEL).map(([key, label]) => {
    const rows = doneRecoveryTasks.filter((task) => parseKpiRecoveryKey(task.sourceRef) === key);
    return summarizeAttributionRows(key, label, rows.map((task) => ({
      recoveryDone: 1,
      revenue: 0,
      wonDeals: 0,
      downstreamTasks: 0,
      hasOutcome: false,
    })));
  }).filter((item) => item.recoveryDone > 0);

  return {
    revenue: 0,
    wonDeals: 0,
    downstreamTasks: 0,
    effectiveTasks: 0,
    companies: 0,
    effectiveRate: doneRecoveryTasks.length > 0 ? 0 : null,
    byIndicator,
    byOwner: [],
    topCompanies: [],
    recommendationTone: '等待业务结果',
    recommendation: kpiAttributionRecommendation({ revenue: 0, wonDeals: 0, downstreamTasks: 0, effectiveTasks: 0, doneRecovery: doneRecoveryTasks.length }),
  };
}

function kpiAttributionRecommendation(input: { revenue: number; wonDeals: number; downstreamTasks: number; effectiveTasks: number; doneRecovery: number }) {
  if (input.doneRecovery === 0) return '还没有已完成的 KPI 补救任务,目前无法做结果归因。先把补救任务执行完,再看是否带来客户和收入变化。';
  if (input.revenue > 0 || input.wonDeals > 0) return `已有 ${input.wonDeals} 个赢单和 $${Math.round(input.revenue).toLocaleString()} 收入可保守归因到已完成补救,建议把这些客户动作沉淀成可复制打法。`;
  if (input.downstreamTasks > 0) return `已完成补救后带动 ${input.downstreamTasks} 个后续销售动作,但暂未看到赢单收入,下一步要盯商机阶段推进和报价结果。`;
  return '已完成补救暂未产生可归因业务结果,需要检查补救任务质量、客户选择和后续跟进是否真正推进成交。';
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

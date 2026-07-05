import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';


export default async function Dashboard() {
  const cookieStore = cookies();
  const role = cookieStore.get('auth_role')?.value;
  const currentUser = cookieStore.get('auth_email')?.value || '未知账号';
  const roleMap: Record<string, string> = {
    'SUPER_ADMIN': '超级管理员',
    'ADMIN': '管理员',
    'SALES': '业务主管',
    'FINANCE': '财务',
    'PURCHASING': '采购'
  };
  const currentTitle = roleMap[role || 'SALES'] || '业务人员';

  if (!role) redirect('/');

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const nextMonthStart = new Date(monthStart);
  nextMonthStart.setMonth(nextMonthStart.getMonth() + 1);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [
    opps,
    totalCustomers,
    newCustomersThisMonth,
    inboxPending,
    activeShipments,
    overdueTasks,
    dueTodayTasks,
    unscheduledTasks,
    completedTasksThisMonth,
    openTaskRows,
    kpiTargets,
    activeAutomationFlows,
    automationFailed7d,
    draftAutomationFlows,
    channelAccounts,
    pendingEmailActions,
    overdueShipments,
  ] = await Promise.all([
    prisma.opportunity.findMany({
      orderBy: { createdAt: 'desc' },
      include: { company: { select: { name: true } }, owner: { select: { name: true, email: true } } },
    }).catch(() => [] as any[]),
    prisma.company.count().catch(() => 0),
    prisma.company.count({ where: { createdAt: { gte: monthStart } } }).catch(() => 0),
    prisma.inboxMessage.count({ where: { direction: 'IN', status: { in: ['NEW', 'AI_DRAFTED'] } } }).catch(() => 0),
    prisma.shipment.count({ where: { status: { not: 'DELIVERED' } } }).catch(() => 0),
    prisma.salesTask.count({ where: { status: 'TODO', dueAt: { lt: new Date() } } }).catch(() => 0),
    prisma.salesTask.count({ where: { status: 'TODO', dueAt: { gte: new Date(), lte: todayEnd } } }).catch(() => 0),
    prisma.salesTask.count({ where: { status: 'TODO', dueAt: null } }).catch(() => 0),
    prisma.salesTask.count({ where: { status: 'DONE', completedAt: { gte: monthStart, lt: nextMonthStart } } }).catch(() => 0),
    prisma.salesTask.findMany({
      where: { status: 'TODO' },
      orderBy: [{ dueAt: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
      take: 6,
      include: {
        company: { select: { name: true, customerCode: true } },
        owner: { select: { name: true, email: true } },
      },
    }).catch(() => [] as any[]),
    prisma.salesKpiTarget.findMany({
      where: { periodStart: { gte: monthStart, lt: nextMonthStart } },
      include: { owner: { select: { name: true, email: true } } },
    }).catch(() => [] as any[]),
    prisma.automationFlow.count({ where: { status: 'ACTIVE' } }).catch(() => 0),
    prisma.automationRun.count({ where: { status: 'FAILED', createdAt: { gte: weekAgo } } }).catch(() => 0),
    prisma.automationFlow.count({ where: { status: 'DRAFT' } }).catch(() => 0),
    Promise.all([
      prisma.emailAccount.count({ where: { isActive: true, password: { not: '' } } }).catch(() => 0),
      prisma.socialAccount.count().catch(() => 0),
    ]),
    prisma.emailMessage.count({ where: { actionRequired: true } }).catch(() => 0),
    prisma.shipment.count({ where: { status: { not: 'DELIVERED' }, estimatedArrival: { lt: new Date() } } }).catch(() => 0),
  ]);

  // 漏斗金额:统计进行中(未关闭)商机的总额
  const openOpps = opps.filter((o: any) => o.stage !== 'CLOSED_WON' && o.stage !== 'CLOSED_LOST');
  const wonOpps = opps.filter((o: any) => o.stage === 'CLOSED_WON');
  const pipelineAmount = openOpps.reduce((sum: number, o: any) => sum + (o.amountUSD || 0), 0);
  const wonAmount = wonOpps.reduce((sum: number, o: any) => sum + (o.amountUSD || 0), 0);
  const monthWonOpps = wonOpps.filter((o: any) => new Date(o.updatedAt).getTime() >= monthStart.getTime() && new Date(o.updatedAt).getTime() < nextMonthStart.getTime());
  const monthWonAmount = monthWonOpps.reduce((sum: number, o: any) => sum + (o.amountUSD || 0), 0);
  const staleOpps = openOpps.filter((o: any) => new Date(o.stageChangedAt || o.updatedAt).getTime() < Date.now() - 14 * 24 * 60 * 60 * 1000);
  const kpiSummary = buildDashboardKpiSummary({
    targets: kpiTargets,
    monthWonAmount,
    monthWonDeals: monthWonOpps.length,
    newCustomersThisMonth,
    completedTasksThisMonth,
  });
  const configuredChannelCount = channelAccounts[0] + channelAccounts[1];
  const executive = buildExecutiveDashboard({
    inboxPending,
    overdueTasks,
    dueTodayTasks,
    unscheduledTasks,
    staleOpps: staleOpps.length,
    activeShipments,
    overdueShipments,
    activeAutomationFlows,
    automationFailed7d,
    draftAutomationFlows,
    configuredChannelCount,
    pendingEmailActions,
    kpiProgress: kpiSummary.progress,
  });
  const riskRows = buildDashboardRiskRows({
    inboxPending,
    overdueTasks,
    dueTodayTasks,
    unscheduledTasks,
    staleOpps: staleOpps.length,
    activeShipments,
    overdueShipments,
    activeAutomationFlows,
    automationFailed7d,
    draftAutomationFlows,
    configuredChannelCount,
    pendingEmailActions,
    kpiSummary,
  });

  async function logout() {
    'use server';
    cookies().delete('auth_role');
    cookies().delete('auth_email');
    cookies().delete('auth_title');
    redirect('/');
  }

  const renderCard = (opp: any) => (
    <div key={opp.id} className="bg-white p-5 rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow group relative mb-4">
      <div className="flex justify-between items-start mb-2">
        <h3 className="font-bold text-gray-800 text-lg line-clamp-1" title={opp.title}>{opp.title}</h3>
        <span className="text-green-600 font-semibold">${opp.amountUSD || 0}</span>
      </div>
      <p className="text-sm text-gray-500 mb-4 line-clamp-2">客户: {opp.company?.name || '未分配'}</p>
      <div className="flex justify-between items-center pt-3 border-t border-gray-100">
        <Link href={`/opportunity/${opp.id}`} className="text-sm text-blue-600 hover:text-blue-800 font-medium px-3 py-1.5 bg-blue-50 hover:bg-blue-100 rounded-md">
          处理邮件 & 详情
        </Link>
        <Link href={`/pi/${opp.id}`} className="text-sm text-gray-600 hover:text-gray-900 border border-gray-200 px-3 py-1.5 rounded-md hover:bg-gray-50">
          📄 生成 PI
        </Link>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <header className="mb-6 flex justify-between items-start bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 tracking-tight">ERDI 业务与商机看板</h1>
          <p className="text-sm text-gray-500 mt-1 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500"></span>
            当前登录: <span className="font-semibold text-gray-700">{currentUser}</span>
            <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-xs font-medium ml-1">{currentTitle}</span>
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end max-w-4xl">
          <NavBtn href="/whatsapp" color="green">💬 WhatsApp</NavBtn>
          <NavBtn href="/social" color="purple">🌐 社媒</NavBtn>
          <NavBtn href="/logistics" color="indigo">📦 物流</NavBtn>
          <NavBtn href="/customers" color="emerald">👥 客户</NavBtn>
          <NavBtn href="/users" color="indigo">🧑‍💼 员工</NavBtn>
          <NavBtn href="/products" color="amber">🛒 产品</NavBtn>
          <NavBtn href="/settings" color="gray">⚙️ 设置</NavBtn>
          <NavBtn href="/analytics" color="blue">📈 数据</NavBtn>
          <NavBtn href="/sales-command" color="rose">🎯 指挥台</NavBtn>
          <NavBtn href="/sales-kpi" color="emerald">🏁 KPI</NavBtn>
          <NavBtn href="/tasks" color="blue">✅ 任务</NavBtn>
          <NavBtn href="/attendance" color="pink">📅 考勤</NavBtn>
          <NavBtn href="/expenses" color="orange">💰 报账</NavBtn>
          <NavBtn href="/shipments" color="teal">🚚 发货</NavBtn>
          <NavBtn href="/suppliers" color="purple">🏭 采购</NavBtn>
          <form action={logout}>
            <button type="submit" className="text-sm bg-gray-100 hover:bg-red-50 text-gray-600 hover:text-red-600 border border-gray-200 px-3 py-2 rounded-lg font-medium">退出</button>
          </form>
        </div>
      </header>

      <section className="mb-6 rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-bold text-gray-900">老板日清经营驾驶舱</h2>
            <p className="mt-1 text-xs text-gray-500">
              按 HubSpot / Salesforce / Pipedrive / Zoho 的经营仪表盘思路,把收入、管道、任务、渠道、收件箱和自动化风险放到第一屏。
            </p>
          </div>
          <span className={`rounded-lg px-3 py-2 text-xs font-black ${executive.healthScore >= 80 ? 'bg-emerald-50 text-emerald-700' : executive.healthScore >= 55 ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'}`}>
            今日经营健康度 {executive.healthScore}
          </span>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <ExecutiveMetric label="本月成交" value={`$${Math.round(monthWonAmount).toLocaleString()}`} detail={`${monthWonOpps.length} 个赢单`} tone={monthWonAmount > 0 ? 'emerald' : 'slate'} href="/sales-kpi" />
          <ExecutiveMetric label="进行中管道" value={`$${Math.round(pipelineAmount).toLocaleString()}`} detail={`${openOpps.length} 个商机`} tone={openOpps.length > 0 ? 'blue' : 'slate'} href="/sales-command" />
          <ExecutiveMetric label="KPI 进度" value={kpiSummary.progressLabel} detail={kpiSummary.targetLabel} tone={kpiSummary.progress >= 0.8 ? 'emerald' : kpiSummary.progress >= 0.5 ? 'amber' : 'rose'} href="/sales-kpi" />
          <ExecutiveMetric label="收件箱待回" value={inboxPending} detail={`${pendingEmailActions} 封邮件需动作`} tone={inboxPending > 0 ? 'rose' : 'emerald'} href="/omnibox" />
          <ExecutiveMetric label="任务逾期" value={overdueTasks} detail={`今日到期 ${dueTodayTasks}`} tone={overdueTasks > 0 ? 'rose' : dueTodayTasks > 0 ? 'amber' : 'emerald'} href="/tasks" />
          <ExecutiveMetric label="渠道/自动化" value={`${configuredChannelCount}/${activeAutomationFlows}`} detail={`${automationFailed7d} 失败 · ${draftAutomationFlows} 草稿`} tone={automationFailed7d > 0 || configuredChannelCount < 3 ? 'amber' : 'emerald'} href="/settings/channels" />
        </div>
        <div className="mt-4 rounded-xl bg-gray-50 px-4 py-3 text-xs font-bold text-gray-600">{executive.recommendation}</div>
        <div className="mt-4 grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="overflow-hidden rounded-xl border border-gray-100">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs font-black text-gray-500">
                <tr>
                  <th className="p-3">今日优先处理</th>
                  <th className="p-3">数量</th>
                  <th className="p-3">建议动作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {riskRows.map((row) => (
                  <tr key={row.key} className="hover:bg-gray-50">
                    <td className="p-3">
                      <div className="font-black text-gray-900">{row.title}</div>
                      <div className="mt-0.5 text-[11px] font-bold text-gray-400">{row.scope}</div>
                    </td>
                    <td className="p-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-black ${row.toneClass}`}>{row.value}</span>
                    </td>
                    <td className="p-3">
                      <div className="text-xs font-bold text-gray-600">{row.action}</div>
                      <Link href={row.href} className="mt-1 inline-block text-[11px] font-black text-blue-600 hover:underline">{row.linkLabel}</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rounded-xl border border-gray-100 p-4">
            <h3 className="text-xs font-black text-gray-500">今天要盯的人和事</h3>
            <div className="mt-3 space-y-3">
              {openTaskRows.map((task: any) => (
                <Link key={task.id} href="/tasks" className="block rounded-lg bg-gray-50 p-3 hover:bg-gray-100">
                  <div className="flex items-center justify-between gap-3">
                    <div className="truncate text-xs font-black text-gray-900">{task.title}</div>
                    <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-black ${task.priority === 'URGENT' ? 'bg-rose-50 text-rose-700' : task.priority === 'HIGH' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'}`}>{task.priority}</span>
                  </div>
                  <div className="mt-1 text-[11px] font-bold text-gray-400">{task.company?.customerCode ? `${task.company.customerCode} · ` : ''}{task.company?.name || '未关联客户'} · {task.owner?.name || task.owner?.email || '未分配'} · {formatDashboardDue(task.dueAt)}</div>
                </Link>
              ))}
              {openTaskRows.length === 0 && <div className="rounded-lg bg-emerald-50 p-3 text-xs font-bold text-emerald-700">当前没有待办任务积压。</div>}
            </div>
          </div>
        </div>
      </section>

      {/* 数据概览卡 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <StatCard label="客户总数" value={`${totalCustomers}`} color="text-blue-600" link="/customers" />
        <StatCard label="本月新增客户" value={`${newCustomersThisMonth}`} color="text-emerald-600" link="/customers" />
        <StatCard label="进行中商机" value={`${openOpps.length}`} color="text-indigo-600" link="/documents" />
        <StatCard label="进行中金额" value={`$${pipelineAmount.toLocaleString()}`} color="text-amber-600" />
        <StatCard label="已成交金额" value={`$${wonAmount.toLocaleString()}`} color="text-green-600" link="/documents" />
        <StatCard label="待处理收件箱" value={`${inboxPending}`} color="text-rose-600" link="/omnibox" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Column title="🆕 新询盘 / 待处理" stages={['UNPROCESSED', 'REPLIED', 'QUOTING']} opps={opps} render={renderCard} />
        <Column title="🤝 谈判 / 确认中" stages={['NEGOTIATING', 'SPEC_CONFIRMING']} opps={opps} render={renderCard} />
        <Column title="✅ 已成单" stages={['CLOSED_WON']} opps={opps} render={renderCard} />
      </div>
    </div>
  );
}

function NavBtn({ href, color, children }: { href: string; color: string; children: React.ReactNode }) {
  const map: Record<string, string> = {
    green: 'bg-green-50 text-green-700 hover:bg-green-100 border-green-100',
    purple: 'bg-purple-50 text-purple-700 hover:bg-purple-100 border-purple-100',
    indigo: 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border-indigo-100',
    emerald: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border-emerald-100',
    amber: 'bg-amber-50 text-amber-700 hover:bg-amber-100 border-amber-100',
    gray: 'bg-gray-50 text-gray-700 hover:bg-gray-100 border-gray-200',
    blue: 'bg-blue-50 text-blue-700 hover:bg-blue-100 border-blue-100',
    pink: 'bg-pink-50 text-pink-700 hover:bg-pink-100 border-pink-100',
    orange: 'bg-orange-50 text-orange-700 hover:bg-orange-100 border-orange-100',
    teal: 'bg-teal-50 text-teal-700 hover:bg-teal-100 border-teal-100',
    rose: 'bg-rose-50 text-rose-700 hover:bg-rose-100 border-rose-100',
  };
  return (
    <Link href={href} className={`text-sm border px-3 py-2 rounded-lg font-medium transition-colors ${map[color]}`}>
      {children}
    </Link>
  );
}

function buildDashboardKpiSummary(input: {
  targets: any[];
  monthWonAmount: number;
  monthWonDeals: number;
  newCustomersThisMonth: number;
  completedTasksThisMonth: number;
}) {
  const target = input.targets.reduce(
    (sum, row) => ({
      revenue: sum.revenue + (row.revenueTargetUSD || 0),
      won: sum.won + (row.wonDealsTarget || 0),
      customers: sum.customers + (row.newCustomersTarget || 0),
      tasks: sum.tasks + (row.completedTasksTarget || 0),
    }),
    { revenue: 0, won: 0, customers: 0, tasks: 0 }
  );
  const parts = [
    progressRatio(input.monthWonAmount, target.revenue),
    progressRatio(input.monthWonDeals, target.won),
    progressRatio(input.newCustomersThisMonth, target.customers),
    progressRatio(input.completedTasksThisMonth, target.tasks),
  ].filter((value) => value !== null) as number[];
  const progress = parts.length ? parts.reduce((sum, value) => sum + value, 0) / parts.length : 0;
  const targetPieces = [
    target.revenue > 0 ? `收入目标 $${Math.round(target.revenue).toLocaleString()}` : '',
    target.won > 0 ? `赢单目标 ${target.won}` : '',
    target.customers > 0 ? `新客目标 ${target.customers}` : '',
    target.tasks > 0 ? `任务目标 ${target.tasks}` : '',
  ].filter(Boolean);
  return {
    progress,
    progressLabel: input.targets.length ? `${Math.round(progress * 100)}%` : '未设',
    targetLabel: targetPieces[0] || '本月未设置团队目标',
    target,
  };
}

function buildExecutiveDashboard(input: {
  inboxPending: number;
  overdueTasks: number;
  dueTodayTasks: number;
  unscheduledTasks: number;
  staleOpps: number;
  activeShipments: number;
  overdueShipments: number;
  activeAutomationFlows: number;
  automationFailed7d: number;
  draftAutomationFlows: number;
  configuredChannelCount: number;
  pendingEmailActions: number;
  kpiProgress: number;
}) {
  const riskPenalty =
    Math.min(30, input.inboxPending) +
    input.overdueTasks * 8 +
    input.staleOpps * 5 +
    input.overdueShipments * 6 +
    input.automationFailed7d * 4 +
    Math.max(0, 3 - input.configuredChannelCount) * 8 +
    (input.kpiProgress > 0 && input.kpiProgress < 0.5 ? 12 : 0);
  const healthScore = Math.max(0, Math.min(100, Math.round(100 - riskPenalty)));
  return {
    healthScore,
    recommendation: dashboardRecommendation(input),
  };
}

function buildDashboardRiskRows(input: {
  inboxPending: number;
  overdueTasks: number;
  dueTodayTasks: number;
  unscheduledTasks: number;
  staleOpps: number;
  activeShipments: number;
  overdueShipments: number;
  activeAutomationFlows: number;
  automationFailed7d: number;
  draftAutomationFlows: number;
  configuredChannelCount: number;
  pendingEmailActions: number;
  kpiSummary: ReturnType<typeof buildDashboardKpiSummary>;
}) {
  const rows = [
    {
      key: 'inbox',
      title: '统一收件箱 SLA',
      scope: 'WhatsApp / 邮件 / 阿里 / Amazon / Shopee',
      value: input.inboxPending,
      action: input.inboxPending > 0 ? '先回复超时和高意向消息,避免询盘流失。' : '收件箱当前无待回复积压。',
      href: '/omnibox',
      linkLabel: '打开收件箱',
      weight: input.inboxPending * 10,
    },
    {
      key: 'tasks',
      title: '销售任务执行',
      scope: `${input.dueTodayTasks} 个今日到期 · ${input.unscheduledTasks} 个未排期`,
      value: input.overdueTasks,
      action: input.overdueTasks > 0 ? '先清逾期任务,再处理今日到期和未排期任务。' : '没有逾期任务,按今日队列推进即可。',
      href: '/tasks',
      linkLabel: '进入任务中心',
      weight: input.overdueTasks * 12 + input.dueTodayTasks * 4 + input.unscheduledTasks,
    },
    {
      key: 'pipeline',
      title: '停滞商机',
      scope: '阶段超过 14 天未变化的进行中商机',
      value: input.staleOpps,
      action: input.staleOpps > 0 ? '逐个补下一步动作,报价/谈判卡住的要当天追问。' : '管道暂无明显停滞。',
      href: '/sales-command',
      linkLabel: '看销售指挥台',
      weight: input.staleOpps * 8,
    },
    {
      key: 'kpi',
      title: '本月 KPI',
      scope: input.kpiSummary.targetLabel,
      value: input.kpiSummary.progressLabel,
      action: input.kpiSummary.progress > 0 && input.kpiSummary.progress < 0.5 ? 'KPI 低于进度,进入 KPI 页拆解补救任务。' : 'KPI 进度可控,继续关注收入和赢单目标。',
      href: '/sales-kpi',
      linkLabel: '看 KPI',
      weight: input.kpiSummary.progress > 0 && input.kpiSummary.progress < 0.5 ? 30 : 5,
    },
    {
      key: 'channels',
      title: '渠道接入',
      scope: 'Gmail / WhatsApp / 阿里 / Amazon / Shopee / 社媒',
      value: input.configuredChannelCount,
      action: input.configuredChannelCount < 3 ? '核心渠道配置偏少,优先补授权并用测试消息验证入站。' : '渠道已有基础配置,继续看健康总控里的缺授权项。',
      href: '/settings/channels',
      linkLabel: '看渠道健康',
      weight: Math.max(0, 3 - input.configuredChannelCount) * 10,
    },
    {
      key: 'automation',
      title: '自动化治理',
      scope: `${input.activeAutomationFlows} 个启用流程 · ${input.draftAutomationFlows} 个草稿`,
      value: input.automationFailed7d,
      action: input.automationFailed7d > 0 ? '检查最近失败流程,避免线索分配和自动回复断链。' : '自动化最近无失败,继续治理草稿积压。',
      href: '/automation',
      linkLabel: '看自动化',
      weight: input.automationFailed7d * 9 + Math.min(10, input.draftAutomationFlows),
    },
    {
      key: 'logistics',
      title: '物流履约',
      scope: `${input.activeShipments} 个未签收发货`,
      value: input.overdueShipments,
      action: input.overdueShipments > 0 ? '先处理预计到达已过但未签收的运单。' : '未发现逾期物流,继续同步 AfterShip 事件。',
      href: '/shipments',
      linkLabel: '看发货',
      weight: input.overdueShipments * 7,
    },
    {
      key: 'email',
      title: '邮件销售动作',
      scope: '分类为需要销售动作的邮件',
      value: input.pendingEmailActions,
      action: input.pendingEmailActions > 0 ? '进入销售指挥台复核邮件分类,把询盘沉淀为客户和任务。' : '暂无邮件动作积压。',
      href: '/sales-command',
      linkLabel: '看邮件审计',
      weight: input.pendingEmailActions,
    },
  ];
  return rows
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 8)
    .map((row) => ({
      ...row,
      toneClass: Number(row.value) > 0 || (row.key === 'kpi' && input.kpiSummary.progress < 0.5) ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700',
    }));
}

function dashboardRecommendation(input: {
  inboxPending: number;
  overdueTasks: number;
  dueTodayTasks: number;
  staleOpps: number;
  overdueShipments: number;
  automationFailed7d: number;
  configuredChannelCount: number;
  pendingEmailActions: number;
  kpiProgress: number;
}) {
  if (input.inboxPending > 0) return `当前最急是 ${input.inboxPending} 条收件箱待回复。先清客户消息,再推进任务和商机。`;
  if (input.overdueTasks > 0) return `有 ${input.overdueTasks} 个销售任务逾期。今天先让负责人补动作和下一步。`;
  if (input.staleOpps > 0) return `有 ${input.staleOpps} 个商机阶段超过 14 天未变化。重点追报价、谈判和技术确认卡点。`;
  if (input.kpiProgress > 0 && input.kpiProgress < 0.5) return '本月 KPI 进度偏低。进入 KPI 页拆解补救任务,当天分配到人。';
  if (input.configuredChannelCount < 3) return '核心渠道配置偏少。优先补 Gmail、WhatsApp、阿里国际站等高价值入口。';
  if (input.automationFailed7d > 0) return `近 7 天有 ${input.automationFailed7d} 条自动化失败。先修失败流程,避免线索断链。`;
  if (input.overdueShipments > 0) return `有 ${input.overdueShipments} 个物流可能逾期。先查运输状态并同步客户。`;
  if (input.pendingEmailActions > 0) return `还有 ${input.pendingEmailActions} 封邮件需要销售动作。复核分类并转客户/任务。`;
  return '今日经营面整体可控。保持收件箱、任务、KPI 和渠道健康每日巡检。';
}

function progressRatio(actual: number, target: number) {
  if (!target || target <= 0) return null;
  return Math.min(1, actual / target);
}

function formatDashboardDue(value: Date | string | null | undefined) {
  if (!value) return '未排期';
  const date = new Date(value);
  const today = new Date();
  const diffDays = Math.floor((date.setHours(0, 0, 0, 0) - today.setHours(0, 0, 0, 0)) / 86400000);
  if (diffDays < 0) return '已逾期';
  if (diffDays === 0) return '今天到期';
  if (diffDays === 1) return '明天到期';
  return `${diffDays}天后`;
}

function ExecutiveMetric({ label, value, detail, tone, href }: { label: string; value: number | string; detail: string; tone: 'blue' | 'emerald' | 'amber' | 'rose' | 'slate'; href: string }) {
  const color = {
    blue: 'border-blue-100 bg-blue-50 text-blue-800',
    emerald: 'border-emerald-100 bg-emerald-50 text-emerald-800',
    amber: 'border-amber-100 bg-amber-50 text-amber-800',
    rose: 'border-rose-100 bg-rose-50 text-rose-800',
    slate: 'border-slate-100 bg-slate-50 text-slate-800',
  };
  return (
    <Link href={href} className={`rounded-xl border p-3 transition hover:shadow-sm ${color[tone]}`}>
      <div className="text-xs font-bold opacity-70">{label}</div>
      <div className="mt-1 text-xl font-black">{value}</div>
      <div className="mt-1 text-[11px] font-bold opacity-70">{detail}</div>
    </Link>
  );
}

function StatCard({ label, value, color, link }: { label: string; value: string; color: string; link?: string }) {
  const inner = (
    <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
    </div>
  );
  return link ? <Link href={link}>{inner}</Link> : inner;
}

function Column({ title, stages, opps, render }: { title: string; stages: string[]; opps: any[]; render: (o: any) => any }) {
  const list = opps.filter(o => stages.includes(o.stage));
  return (
    <div className="bg-gray-100/50 rounded-xl p-4 border border-gray-200">
      <div className="flex justify-between items-center mb-4">
        <h2 className="font-semibold text-gray-700">{title}</h2>
        <span className="bg-gray-200 text-gray-600 text-xs px-2 py-1 rounded-full">{list.length}</span>
      </div>
      <div>
        {list.map(render)}
        {list.length === 0 && <div className="text-center py-10 text-gray-400 text-sm border-2 border-dashed border-gray-200 rounded-lg">暂无数据</div>}
      </div>
    </div>
  );
}

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  Activity,
  BarChart3,
  Bot,
  CheckCircle2,
  Clock,
  Copy,
  Filter,
  Mail,
  MessageSquare,
  PauseCircle,
  PlayCircle,
  Plus,
  Search,
  Tags,
  Trash2,
  Workflow,
  Zap,
} from 'lucide-react';
import { prisma } from '@/lib/prisma';
import {
  AUTOMATION_BLUEPRINT_GROUPS,
  AUTOMATION_CORE_TEMPLATE_KEYS,
  AUTOMATION_TEMPLATES,
  CHANNEL_LABEL,
  RUN_STATUS_LABEL,
  STATUS_LABEL,
  buildCanvas,
  compactJson,
  getTemplate,
} from '@/lib/automation';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 30;

const CATEGORY_STYLE: Record<string, string> = {
  客户接待: 'bg-sky-50 text-sky-700 border-sky-200',
  智能回复: 'bg-violet-50 text-violet-700 border-violet-200',
  销售协同: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'AI 翻译': 'bg-cyan-50 text-cyan-700 border-cyan-200',
  客户画像: 'bg-amber-50 text-amber-700 border-amber-200',
  外贸开发: 'bg-rose-50 text-rose-700 border-rose-200',
  线索评分: 'bg-indigo-50 text-indigo-700 border-indigo-200',
};

const NODE_STYLE: Record<string, string> = {
  trigger: 'border-sky-200 bg-sky-50 text-sky-900',
  condition: 'border-amber-200 bg-amber-50 text-amber-900',
  action: 'border-indigo-200 bg-indigo-50 text-indigo-900',
};

function canAccess(role: string) {
  return ['SUPER_ADMIN', 'ADMIN', 'SALES'].includes(role);
}

function getRole() {
  return (cookies().get('auth_role')?.value || '').toUpperCase();
}

function nextFlowCode() {
  const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `AUTO-${Date.now().toString(36).toUpperCase()}-${suffix}`;
}

async function createFromTemplate(formData: FormData) {
  'use server';
  const role = getRole();
  if (!canAccess(role)) return;

  const key = String(formData.get('templateKey') || '');
  const template = getTemplate(key);
  if (!template) return;

  const name = String(formData.get('name') || '').trim() || template.name;
  const status = String(formData.get('status') || 'DRAFT') === 'ACTIVE' ? 'ACTIVE' : 'DRAFT';

  const flow = await prisma.automationFlow.create({
    data: {
      flowCode: nextFlowCode(),
      name,
      description: template.description,
      category: template.category,
      templateKey: template.key,
      channel: template.channel as any,
      status: status as any,
      triggerType: template.triggerType,
      triggerConfig: template.triggerConfig as any,
      conditionType: template.conditionType || null,
      conditionConfig: (template.conditionConfig || undefined) as any,
      actionType: template.actionType,
      actionConfig: template.actionConfig as any,
      canvas: buildCanvas(template) as any,
    },
  });

  redirect(`/automation?flow=${flow.id}`);
}

async function createBlueprintPack(formData: FormData) {
  'use server';
  const role = getRole();
  if (!canAccess(role)) return;

  const requestedKeys = String(formData.get('templateKeys') || '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
  const keys = requestedKeys.length ? requestedKeys : AUTOMATION_CORE_TEMPLATE_KEYS;
  const status = String(formData.get('status') || 'ACTIVE') === 'DRAFT' ? 'DRAFT' : 'ACTIVE';
  const existing = await prisma.automationFlow.findMany({
    where: { templateKey: { in: keys } },
    select: { templateKey: true },
  });
  const existingKeys = new Set(existing.map((flow) => flow.templateKey).filter(Boolean));
  const templates = keys
    .filter((key) => !existingKeys.has(key))
    .map((key) => getTemplate(key))
    .filter(Boolean);

  let created = 0;
  for (const template of templates) {
    if (!template) continue;
    await prisma.automationFlow.create({
      data: {
        flowCode: nextFlowCode(),
        name: template.name,
        description: template.description,
        category: template.category,
        templateKey: template.key,
        channel: template.channel as any,
        status: status as any,
        triggerType: template.triggerType,
        triggerConfig: template.triggerConfig as any,
        conditionType: template.conditionType || null,
        conditionConfig: (template.conditionConfig || undefined) as any,
        actionType: template.actionType,
        actionConfig: template.actionConfig as any,
        canvas: buildCanvas(template) as any,
      },
    });
    created++;
  }

  const url = new URL('/automation', 'http://local');
  url.searchParams.set('pack', status === 'ACTIVE' ? 'activated' : 'drafted');
  url.searchParams.set('created', String(created));
  url.searchParams.set('skipped', String(Math.max(0, keys.length - created)));
  redirect(`${url.pathname}${url.search}`);
}

async function toggleFlow(formData: FormData) {
  'use server';
  const role = getRole();
  if (!canAccess(role)) return;

  const id = String(formData.get('id') || '');
  const status = String(formData.get('status') || 'PAUSED');
  if (!id) return;
  await prisma.automationFlow.update({
    where: { id },
    data: { status: status === 'ACTIVE' ? 'ACTIVE' : 'PAUSED' },
  });
  redirect(`/automation?flow=${id}`);
}

async function updateFlow(formData: FormData) {
  'use server';
  const role = getRole();
  if (!canAccess(role)) return;

  const id = String(formData.get('id') || '');
  if (!id) return;
  const name = String(formData.get('name') || '').trim();
  const description = String(formData.get('description') || '').trim();
  const actionMessage = String(formData.get('actionMessage') || '').trim();
  const category = String(formData.get('category') || 'default').trim();
  const conditionNote = String(formData.get('conditionNote') || '').trim();

  const flow = await prisma.automationFlow.findUnique({ where: { id } });
  if (!flow) return;

  const actionConfig =
    flow.actionType === 'SEND_MESSAGE'
      ? { ...(flow.actionConfig as any), message: actionMessage || (flow.actionConfig as any)?.message || '' }
      : { ...(flow.actionConfig as any), note: actionMessage || (flow.actionConfig as any)?.note || '' };

  const conditionConfig = conditionNote
    ? { ...(flow.conditionConfig as any), operatorNote: conditionNote }
    : (flow.conditionConfig as any);

  await prisma.automationFlow.update({
    where: { id },
    data: {
      name: name || flow.name,
      description: description || null,
      category: category || flow.category,
      conditionConfig,
      actionConfig,
    },
  });
  redirect(`/automation?flow=${id}`);
}

async function duplicateFlow(formData: FormData) {
  'use server';
  const role = getRole();
  if (!canAccess(role)) return;

  const id = String(formData.get('id') || '');
  const flow = await prisma.automationFlow.findUnique({ where: { id } });
  if (!flow) return;

  const copy = await prisma.automationFlow.create({
    data: {
      flowCode: nextFlowCode(),
      name: `${flow.name} - 副本`,
      description: flow.description,
      category: flow.category,
      templateKey: flow.templateKey,
      channel: flow.channel,
      status: 'DRAFT',
      triggerType: flow.triggerType,
      triggerConfig: flow.triggerConfig || undefined,
      conditionType: flow.conditionType,
      conditionConfig: flow.conditionConfig || undefined,
      actionType: flow.actionType,
      actionConfig: flow.actionConfig || undefined,
      canvas: flow.canvas || undefined,
    },
  });
  redirect(`/automation?flow=${copy.id}`);
}

async function deleteFlow(formData: FormData) {
  'use server';
  const role = getRole();
  if (!['SUPER_ADMIN', 'ADMIN'].includes(role)) return;

  const id = String(formData.get('id') || '');
  if (!id) return;
  await prisma.automationFlow.delete({ where: { id } });
  redirect('/automation');
}

async function testFlow(formData: FormData) {
  'use server';
  const role = getRole();
  if (!canAccess(role)) return;

  const id = String(formData.get('id') || '');
  const cookieUserId = cookies().get('auth_userId')?.value || undefined;
  const flow = await prisma.automationFlow.findUnique({ where: { id } });
  if (!flow) return;
  const user = cookieUserId ? await prisma.user.findUnique({ where: { id: cookieUserId }, select: { id: true } }) : null;

  const output = {
    trigger: flow.triggerType,
    condition: flow.conditionType || 'NO_CONDITION',
    action: flow.actionType,
    preview: (flow.actionConfig as any)?.message || (flow.actionConfig as any)?.tone || '已生成测试运行记录',
  };

  await prisma.$transaction([
    prisma.automationRun.create({
      data: {
        flowId: id,
        channel: flow.channel,
        contactKey: 'test-contact',
        status: flow.actionType === 'SEND_MESSAGE' ? 'ACTION_SENT' : 'MATCHED',
        matched: true,
        summary: `测试命中: ${flow.name}`,
        input: { source: 'manual_test', sampleText: 'Hello, I need laser rangefinder details.' },
        output,
        userId: user?.id,
      },
    }),
    prisma.automationFlow.update({
      where: { id },
      data: {
        triggerCount: { increment: 1 },
        uniqueContactCount: { increment: 1 },
        participationRate: 100,
        lastRunAt: new Date(),
      },
    }),
  ]);
  redirect(`/automation?flow=${id}`);
}

export default async function AutomationPage(props: any) {
  const role = getRole();
  if (!canAccess(role)) redirect('/dashboard?error=unauthorized');

  const sp = props.searchParams || {};
  const q = String(sp.q || '').trim();
  const status = String(sp.status || '').trim();
  const channel = String(sp.channel || '').trim();
  const selectedId = String(sp.flow || '').trim();
  const packResult = {
    pack: firstParam(sp.pack),
    created: firstParam(sp.created),
    skipped: firstParam(sp.skipped),
  };

  const where: any = {};
  if (q) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { flowCode: { contains: q, mode: 'insensitive' } },
      { category: { contains: q, mode: 'insensitive' } },
      { description: { contains: q, mode: 'insensitive' } },
    ];
  }
  if (status) where.status = status;
  if (channel) where.channel = channel;

  const [total, flows, recentRuns] = await Promise.all([
    prisma.automationFlow.count({ where }),
    prisma.automationFlow.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: PAGE_SIZE,
      include: { runs: { orderBy: { createdAt: 'desc' }, take: 3 } },
    }),
    prisma.automationRun.findMany({
      orderBy: { createdAt: 'desc' },
      take: 8,
      include: { flow: { select: { id: true, name: true, flowCode: true } }, user: { select: { name: true, email: true } } },
    }),
  ]);

  const governanceFlows = await prisma.automationFlow.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 200,
    include: { runs: { orderBy: { createdAt: 'desc' }, take: 20 } },
  });

  const selected = selectedId
    ? await prisma.automationFlow.findUnique({
        where: { id: selectedId },
        include: { runs: { orderBy: { createdAt: 'desc' }, take: 10, include: { user: { select: { name: true, email: true } } } } },
      })
    : flows[0] || null;

  const activeCount = flows.filter((flow) => flow.status === 'ACTIVE').length;
  const totalTriggers = flows.reduce((sum, flow) => sum + flow.triggerCount, 0);
  const totalContacts = flows.reduce((sum, flow) => sum + flow.uniqueContactCount, 0);
  const governance = buildAutomationGovernance(governanceFlows);
  const blueprint = buildAutomationBlueprint(governanceFlows);

  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-8">
      <header className="mb-6 flex flex-col xl:flex-row xl:items-center justify-between gap-4 bg-white border border-gray-100 rounded-xl p-6 shadow-sm">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold text-indigo-600 mb-2">
            <Workflow className="h-4 w-4" />
            ERDI 智能自动化
          </div>
          <h1 className="text-2xl font-bold text-gray-900">自动化流程中台</h1>
          <p className="text-sm text-gray-500 mt-1">
            全渠道触发器、条件分支、AI 回复、客户标签、外贸开发信和销售提醒统一编排。
          </p>
        </div>
        <div className="grid grid-cols-3 gap-3 min-w-full xl:min-w-[520px]">
          <Metric icon={<PlayCircle className="h-4 w-4" />} label="启用流程" value={activeCount} />
          <Metric icon={<Activity className="h-4 w-4" />} label="触发次数" value={totalTriggers} />
          <Metric icon={<BarChart3 className="h-4 w-4" />} label="触达客户" value={totalContacts} />
        </div>
      </header>

      <section className="mb-6 rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-bold text-gray-900">自动化蓝图补齐台</h2>
            <p className="mt-1 text-xs text-gray-500">按 SaleSmartly 流程模板、HubSpot Workflows、Zapier Zaps、Zoho Workflow/Blueprint 的思路,扫描线索分配、AI 回复、画像、开发信和接待流程是否齐全。</p>
          </div>
          <span className={`rounded-lg px-3 py-2 text-xs font-black ${blueprint.coverageRate >= 0.8 ? 'bg-emerald-50 text-emerald-700' : blueprint.coverageRate >= 0.5 ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'}`}>
            蓝图覆盖 {formatAutomationPercent(blueprint.coverageRate)}
          </span>
        </div>
        {packResult.pack && <BlueprintPackResultBanner result={packResult} />}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {blueprint.groups.map((group) => (
            <BlueprintGroupCard key={group.key} group={group} />
          ))}
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto_auto]">
          <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-700">
            {blueprint.recommendation}
          </div>
          <form action={createBlueprintPack}>
            <input type="hidden" name="templateKeys" value={AUTOMATION_CORE_TEMPLATE_KEYS.join(',')} />
            <input type="hidden" name="status" value="ACTIVE" />
            <button disabled={blueprint.missingKeys.length === 0} className="h-full min-h-11 w-full rounded-lg bg-indigo-600 px-4 py-2 text-xs font-black text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300">
              补齐并开启核心流程
            </button>
          </form>
          <form action={createBlueprintPack}>
            <input type="hidden" name="templateKeys" value={AUTOMATION_CORE_TEMPLATE_KEYS.join(',')} />
            <input type="hidden" name="status" value="DRAFT" />
            <button disabled={blueprint.missingKeys.length === 0} className="h-full min-h-11 w-full rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-xs font-black text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-400">
              只补草稿
            </button>
          </form>
        </div>
      </section>

      <section className="mb-6 rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-bold text-gray-900">自动化治理驾驶舱</h2>
            <p className="mt-1 text-xs text-gray-500">按 HubSpot/Pipedrive/Zoho 的工作流治理思路,持续检查启用覆盖、命中率、失败、跳过和草稿积压。</p>
          </div>
          <div className={`rounded-lg px-3 py-2 text-xs font-black ${governance.healthScore >= 80 ? 'bg-emerald-50 text-emerald-700' : governance.healthScore >= 55 ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'}`}>
            健康度 {governance.healthScore}
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <GovernanceMetric label="流程总数" value={governance.totalFlows} detail={`${governance.activeFlows} 个已开启`} tone="blue" />
          <GovernanceMetric label="启用覆盖" value={formatAutomationPercent(governance.activeRate)} detail={`${governance.draftFlows} 草稿 · ${governance.pausedFlows} 暂停`} tone={(governance.activeRate || 0) >= 0.6 ? 'emerald' : 'amber'} />
          <GovernanceMetric label="样本运行" value={governance.sampleRuns} detail="最近 20 条/流程" tone="slate" />
          <GovernanceMetric label="命中率" value={formatAutomationPercent(governance.matchRate)} detail={`${governance.matchedRuns} 次命中`} tone={(governance.matchRate || 0) >= 0.5 ? 'emerald' : 'amber'} />
          <GovernanceMetric label="失败运行" value={governance.failedRuns} detail="需要修配置/授权" tone={governance.failedRuns > 0 ? 'rose' : 'emerald'} />
          <GovernanceMetric label="跳过运行" value={governance.skippedRuns} detail="条件未命中或流程错配" tone={governance.skippedRuns > 0 ? 'amber' : 'emerald'} />
        </div>
        <div className="mt-4 grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-xl border border-gray-100 p-4">
            <h3 className="text-xs font-black text-gray-500">治理待办</h3>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {governance.actionItems.map((item) => (
                <div key={item.title} className={`rounded-lg border px-3 py-2 ${item.tone === 'rose' ? 'border-rose-100 bg-rose-50 text-rose-800' : item.tone === 'amber' ? 'border-amber-100 bg-amber-50 text-amber-800' : 'border-emerald-100 bg-emerald-50 text-emerald-800'}`}>
                  <div className="text-xs font-black">{item.title}</div>
                  <div className="mt-1 text-[11px] font-bold opacity-75">{item.detail}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-gray-100 p-4">
            <h3 className="text-xs font-black text-gray-500">分类覆盖</h3>
            <div className="mt-3 space-y-3">
              {governance.categoryRows.map((row) => (
                <AutomationBar key={row.category} label={row.category} value={row.activeFlows} max={governance.maxCategoryActive} detail={`${row.totalFlows} 流程 · ${row.triggerCount} 触发 · ${row.uniqueContactCount} 客户`} />
              ))}
              {governance.categoryRows.length === 0 && <div className="rounded-lg bg-gray-50 p-3 text-xs font-bold text-gray-400">暂无流程分类。</div>}
            </div>
          </div>
        </div>
        <div className="mt-4 overflow-hidden rounded-xl border border-gray-100">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs font-black text-gray-500">
              <tr>
                <th className="p-3">需关注流程</th>
                <th className="p-3">状态</th>
                <th className="p-3">最近运行</th>
                <th className="p-3">命中率</th>
                <th className="p-3">风险</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {governance.riskRows.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50">
                  <td className="p-3">
                    <Link href={`/automation?flow=${row.id}`} className="font-black text-gray-900 hover:text-indigo-700">{row.name}</Link>
                    <div className="mt-0.5 text-[11px] font-mono text-gray-400">{row.flowCode}</div>
                  </td>
                  <td className="p-3"><StatusPill status={row.status} /></td>
                  <td className="p-3 font-bold text-gray-700">{row.recentRuns}</td>
                  <td className="p-3 font-bold text-gray-700">{formatAutomationPercent(row.matchRate)}</td>
                  <td className="p-3 text-xs font-bold text-gray-600">{row.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {governance.riskRows.length === 0 && <div className="p-8 text-center text-sm font-bold text-gray-400">当前没有明显自动化治理风险。</div>}
        </div>
      </section>

      <div className="grid grid-cols-1 2xl:grid-cols-[minmax(560px,0.95fr)_minmax(640px,1.05fr)] gap-6">
        <section className="space-y-6">
          <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-100">
              <form action="/automation" className="grid grid-cols-1 lg:grid-cols-[1fr_150px_150px_auto] gap-2">
                <div className="relative">
                  <Search className="h-4 w-4 text-gray-400 absolute left-3 top-3" />
                  <input
                    name="q"
                    defaultValue={q}
                    placeholder="搜索名称 / ID / 分类"
                    className="w-full h-10 pl-9 pr-3 rounded-lg border border-gray-200 text-sm outline-none focus:border-indigo-500"
                  />
                </div>
                <select name="status" defaultValue={status} className="h-10 rounded-lg border border-gray-200 text-sm px-3 bg-white">
                  <option value="">全部状态</option>
                  <option value="ACTIVE">已开启</option>
                  <option value="PAUSED">已暂停</option>
                  <option value="DRAFT">草稿</option>
                </select>
                <select name="channel" defaultValue={channel} className="h-10 rounded-lg border border-gray-200 text-sm px-3 bg-white">
                  <option value="">全部渠道</option>
                  {Object.entries(CHANNEL_LABEL).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
                <button className="h-10 px-4 bg-gray-900 text-white rounded-lg text-sm font-bold flex items-center justify-center gap-2">
                  <Filter className="h-4 w-4" />
                  筛选
                </button>
              </form>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="text-left px-4 py-3 font-bold">状态</th>
                    <th className="text-left px-4 py-3 font-bold">ID</th>
                    <th className="text-left px-4 py-3 font-bold">名称</th>
                    <th className="text-left px-4 py-3 font-bold">渠道</th>
                    <th className="text-right px-4 py-3 font-bold">近况</th>
                    <th className="text-left px-4 py-3 font-bold">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {flows.map((flow) => (
                    <tr key={flow.id} className={`border-t border-gray-100 hover:bg-slate-50 ${selected?.id === flow.id ? 'bg-indigo-50/50' : ''}`}>
                      <td className="px-4 py-3">
                        <StatusPill status={flow.status} />
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">{flow.flowCode}</td>
                      <td className="px-4 py-3">
                        <Link href={`/automation?flow=${flow.id}`} className="font-bold text-gray-900 hover:text-indigo-700">
                          {flow.name}
                        </Link>
                        <div className="mt-1 flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded border text-[11px] font-bold ${CATEGORY_STYLE[flow.category] || 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                            {flow.category}
                          </span>
                          {flow.templateKey && <span className="text-[11px] text-gray-400">模板</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{CHANNEL_LABEL[flow.channel] || flow.channel}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="font-bold text-gray-800">{flow.triggerCount}</div>
                        <div className="text-xs text-gray-400">{flow.uniqueContactCount} 人</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          <form action={toggleFlow}>
                            <input type="hidden" name="id" value={flow.id} />
                            <input type="hidden" name="status" value={flow.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'} />
                            <button className="px-2 py-1 rounded border border-gray-200 text-xs text-gray-600 hover:bg-gray-50">
                              {flow.status === 'ACTIVE' ? '暂停' : '开启'}
                            </button>
                          </form>
                          <form action={testFlow}>
                            <input type="hidden" name="id" value={flow.id} />
                            <button className="px-2 py-1 rounded border border-indigo-200 text-xs text-indigo-700 hover:bg-indigo-50">测试</button>
                          </form>
                          <form action={duplicateFlow}>
                            <input type="hidden" name="id" value={flow.id} />
                            <button title="复制" className="p-1.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-50">
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {flows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-16 text-center text-gray-400">
                        暂无流程。先从右侧模板创建一个 ERDI 自动化流程。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3 border-t border-gray-100 text-xs text-gray-500">共 {total} 个流程</div>
          </div>

          <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-bold text-gray-900 flex items-center gap-2">
                  <Plus className="h-4 w-4 text-indigo-600" />
                  创建流程模板
                </h2>
                <p className="text-xs text-gray-500 mt-1">覆盖 Salesmartly 的聊天自动化,同时加入网易外贸通式 AI 开发和线索评分。</p>
              </div>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              {AUTOMATION_TEMPLATES.map((template) => (
                <form key={template.key} action={createFromTemplate} className="border border-gray-200 rounded-lg p-4 hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors">
                  <input type="hidden" name="templateKey" value={template.key} />
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <TemplateIcon category={template.category} />
                        <h3 className="font-bold text-gray-900">{template.name}</h3>
                      </div>
                      <p className="text-xs text-gray-500 mt-2 leading-relaxed">{template.description}</p>
                    </div>
                    <span className="text-[11px] px-2 py-1 rounded bg-gray-100 text-gray-600 shrink-0">{CHANNEL_LABEL[template.channel]}</span>
                  </div>
                  <input
                    name="name"
                    placeholder="可自定义流程名"
                    className="mt-3 w-full h-9 rounded-md border border-gray-200 px-3 text-xs outline-none focus:border-indigo-500"
                  />
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <label className="flex items-center gap-2 text-xs text-gray-500">
                      <input type="checkbox" name="status" value="ACTIVE" />
                      创建后立即开启
                    </label>
                    <button className="px-3 py-1.5 bg-indigo-600 text-white rounded-md text-xs font-bold">使用模板</button>
                  </div>
                </form>
              ))}
            </div>
          </div>
        </section>

        <section className="space-y-6">
          {selected ? (
            <>
              <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
                <div className="p-5 border-b border-gray-100 flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <StatusPill status={selected.status} />
                      <span className="px-2 py-1 rounded bg-gray-100 text-xs text-gray-600 font-mono">{selected.flowCode}</span>
                      <span className="px-2 py-1 rounded bg-indigo-50 text-xs text-indigo-700">{CHANNEL_LABEL[selected.channel]}</span>
                    </div>
                    <h2 className="text-xl font-bold text-gray-900">{selected.name}</h2>
                    <p className="text-sm text-gray-500 mt-1">{selected.description || '未填写说明'}</p>
                  </div>
                  <div className="flex gap-2">
                    <form action={testFlow}>
                      <input type="hidden" name="id" value={selected.id} />
                      <button className="h-9 px-3 rounded-lg bg-indigo-600 text-white text-sm font-bold flex items-center gap-2">
                        <Zap className="h-4 w-4" />
                        测试一下
                      </button>
                    </form>
                    {['SUPER_ADMIN', 'ADMIN'].includes(role) && (
                      <form action={deleteFlow}>
                        <input type="hidden" name="id" value={selected.id} />
                        <button className="h-9 px-3 rounded-lg border border-red-200 text-red-600 text-sm font-bold flex items-center gap-2">
                          <Trash2 className="h-4 w-4" />
                          删除
                        </button>
                      </form>
                    )}
                  </div>
                </div>

                <div className="bg-slate-100 p-5 overflow-x-auto">
                  <FlowCanvas flow={selected} />
                </div>

                <form action={updateFlow} className="p-5 border-t border-gray-100">
                  <input type="hidden" name="id" value={selected.id} />
                  <div className="grid md:grid-cols-2 gap-4">
                    <Field label="流程名称">
                      <input name="name" defaultValue={selected.name} className="field" />
                    </Field>
                    <Field label="分类">
                      <input name="category" defaultValue={selected.category} className="field" />
                    </Field>
                    <Field label="流程说明">
                      <input name="description" defaultValue={selected.description || ''} className="field" />
                    </Field>
                    <Field label="条件备注 / 路由说明">
                      <input
                        name="conditionNote"
                        defaultValue={(selected.conditionConfig as any)?.operatorNote || ''}
                        placeholder="如: 德语客户转给 Yilin, 高价值客户 30 分钟内跟进"
                        className="field"
                      />
                    </Field>
                    <div className="md:col-span-2">
                      <Field label={selected.actionType === 'SEND_MESSAGE' ? '自动发送内容' : '动作配置备注'}>
                        <textarea
                          name="actionMessage"
                          defaultValue={(selected.actionConfig as any)?.message || (selected.actionConfig as any)?.note || ''}
                          rows={4}
                          className="field min-h-[110px]"
                        />
                      </Field>
                    </div>
                  </div>
                  <div className="mt-4 flex justify-end">
                    <button className="px-5 py-2 bg-gray-900 text-white rounded-lg text-sm font-bold">保存配置</button>
                  </div>
                </form>
              </div>

              <div className="grid lg:grid-cols-2 gap-6">
                <ConfigPanel title="触发器" icon={<PlayCircle className="h-4 w-4" />} label={selected.triggerType} json={selected.triggerConfig} />
                <ConfigPanel title="条件" icon={<Filter className="h-4 w-4" />} label={selected.conditionType || '无条件'} json={selected.conditionConfig} />
                <ConfigPanel title="动作" icon={<Bot className="h-4 w-4" />} label={selected.actionType} json={selected.actionConfig} />
                <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5">
                  <h3 className="font-bold text-gray-900 flex items-center gap-2 mb-4">
                    <Activity className="h-4 w-4 text-indigo-600" />
                    最近运行
                  </h3>
                  <RunList runs={selected.runs} />
                </div>
              </div>
            </>
          ) : (
            <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-16 text-center text-gray-500">选择或创建一个自动化流程。</div>
          )}

          <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5">
            <h3 className="font-bold text-gray-900 flex items-center gap-2 mb-4">
              <Clock className="h-4 w-4 text-indigo-600" />
              全局运行记录
            </h3>
            <RunList runs={recentRuns} showFlow />
          </div>
        </section>
      </div>
    </div>
  );
}

function buildAutomationGovernance(flows: any[]) {
  const totalFlows = flows.length;
  const activeFlows = flows.filter((flow) => flow.status === 'ACTIVE').length;
  const pausedFlows = flows.filter((flow) => flow.status === 'PAUSED').length;
  const draftFlows = flows.filter((flow) => flow.status === 'DRAFT').length;
  const allRuns = flows.flatMap((flow) => flow.runs || []);
  const sampleRuns = allRuns.length;
  const matchedRuns = allRuns.filter((run) => run.matched).length;
  const failedRuns = allRuns.filter((run) => run.status === 'FAILED').length;
  const skippedRuns = allRuns.filter((run) => run.status === 'SKIPPED').length;
  const activeNeverRun = flows.filter((flow) => flow.status === 'ACTIVE' && !flow.lastRunAt && flow.triggerCount === 0).length;
  const lowMatchFlows = flows.filter((flow) => {
    const runs = flow.runs || [];
    if (runs.length < 5) return false;
    return runs.filter((run: any) => run.matched).length / runs.length < 0.35;
  }).length;
  const activeRate = totalFlows ? activeFlows / totalFlows : null;
  const matchRate = sampleRuns ? matchedRuns / sampleRuns : null;
  const healthPenalty =
    (totalFlows === 0 ? 35 : 0) +
    (activeRate === null ? 0 : Math.max(0, 0.55 - activeRate) * 35) +
    failedRuns * 8 +
    activeNeverRun * 7 +
    lowMatchFlows * 6 +
    Math.min(18, skippedRuns * 1.5);
  const healthScore = Math.max(0, Math.min(100, Math.round(100 - healthPenalty)));

  const actionItems = [];
  if (totalFlows === 0) {
    actionItems.push({ title: '先创建核心流程', detail: '建议从新线索分配、关键词回复、高价值提醒三个模板开始。', tone: 'amber' });
  }
  if (totalFlows > 0 && activeFlows === 0) {
    actionItems.push({ title: '没有启用流程', detail: '至少开启一个低风险草稿流程,否则自动化中台只是看板。', tone: 'rose' });
  }
  if (activeNeverRun > 0) {
    actionItems.push({ title: '已开启但未触发', detail: `${activeNeverRun} 个流程开启后还没有运行,检查触发器/渠道/入口。`, tone: 'amber' });
  }
  if (failedRuns > 0) {
    actionItems.push({ title: '存在失败运行', detail: `最近样本中有 ${failedRuns} 次失败,优先检查授权、动作配置和收件箱数据。`, tone: 'rose' });
  }
  if (lowMatchFlows > 0) {
    actionItems.push({ title: '条件过严', detail: `${lowMatchFlows} 个流程近期命中率低于 35%,需要放宽关键词/意图/时间条件。`, tone: 'amber' });
  }
  if (draftFlows > activeFlows && draftFlows > 0) {
    actionItems.push({ title: '草稿积压', detail: `${draftFlows} 个草稿未上线,可复制后小流量测试。`, tone: 'amber' });
  }
  if (actionItems.length === 0) {
    actionItems.push({ title: '治理状态稳定', detail: '当前启用、命中和失败状态正常,下一步关注转化结果归因。', tone: 'emerald' });
  }

  const categoryMap = new Map<string, { category: string; totalFlows: number; activeFlows: number; triggerCount: number; uniqueContactCount: number }>();
  for (const flow of flows) {
    const key = flow.category || '未分类';
    const row = categoryMap.get(key) || { category: key, totalFlows: 0, activeFlows: 0, triggerCount: 0, uniqueContactCount: 0 };
    row.totalFlows += 1;
    row.activeFlows += flow.status === 'ACTIVE' ? 1 : 0;
    row.triggerCount += flow.triggerCount || 0;
    row.uniqueContactCount += flow.uniqueContactCount || 0;
    categoryMap.set(key, row);
  }
  const categoryRows = Array.from(categoryMap.values()).sort((a, b) => b.activeFlows - a.activeFlows || b.triggerCount - a.triggerCount || b.totalFlows - a.totalFlows);

  const riskRows = flows
    .map((flow) => {
      const runs = flow.runs || [];
      const flowFailedRuns = runs.filter((run: any) => run.status === 'FAILED').length;
      const flowSkippedRuns = runs.filter((run: any) => run.status === 'SKIPPED').length;
      const flowMatchedRuns = runs.filter((run: any) => run.matched).length;
      const flowMatchRate = runs.length ? flowMatchedRuns / runs.length : null;
      let reason = '';
      let weight = 0;
      if (flow.status === 'ACTIVE' && !flow.lastRunAt && flow.triggerCount === 0) {
        reason = '已开启但从未触发';
        weight = 80;
      } else if (flowFailedRuns > 0) {
        reason = `最近 ${flowFailedRuns} 次失败`;
        weight = 90 + flowFailedRuns;
      } else if (runs.length >= 5 && flowMatchRate !== null && flowMatchRate < 0.35) {
        reason = '近期命中率偏低';
        weight = 70;
      } else if (runs.length >= 5 && flowSkippedRuns / runs.length >= 0.7) {
        reason = '跳过过多,条件可能错配';
        weight = 65;
      } else if (flow.status === 'DRAFT') {
        reason = '草稿未上线';
        weight = 45;
      } else if (flow.status === 'PAUSED') {
        reason = '流程已暂停';
        weight = 35;
      }
      return {
        id: flow.id,
        flowCode: flow.flowCode,
        name: flow.name,
        status: flow.status,
        recentRuns: runs.length,
        matchRate: flowMatchRate,
        reason,
        weight,
      };
    })
    .filter((row) => row.reason)
    .sort((a, b) => b.weight - a.weight || b.recentRuns - a.recentRuns)
    .slice(0, 8);

  return {
    totalFlows,
    activeFlows,
    pausedFlows,
    draftFlows,
    activeRate,
    sampleRuns,
    matchedRuns,
    failedRuns,
    skippedRuns,
    matchRate,
    healthScore,
    actionItems,
    categoryRows,
    maxCategoryActive: Math.max(1, ...categoryRows.map((row) => row.activeFlows)),
    riskRows,
  };
}

function buildAutomationBlueprint(flows: any[]) {
  const existingTemplateKeys = new Set(flows.map((flow) => flow.templateKey).filter(Boolean));
  const activeTemplateKeys = new Set(flows.filter((flow) => flow.status === 'ACTIVE').map((flow) => flow.templateKey).filter(Boolean));
  const missingKeys = AUTOMATION_CORE_TEMPLATE_KEYS.filter((key) => !existingTemplateKeys.has(key));
  const activeMissingKeys = AUTOMATION_CORE_TEMPLATE_KEYS.filter((key) => !activeTemplateKeys.has(key));
  const groups = AUTOMATION_BLUEPRINT_GROUPS.map((group) => {
    const templates = group.templateKeys.map((key) => getTemplate(key)).filter(Boolean);
    const existingCount = group.templateKeys.filter((key) => existingTemplateKeys.has(key)).length;
    const activeCount = group.templateKeys.filter((key) => activeTemplateKeys.has(key)).length;
    const missing = group.templateKeys
      .filter((key) => !existingTemplateKeys.has(key))
      .map((key) => getTemplate(key)?.name || key);
    return {
      ...group,
      templates,
      existingCount,
      activeCount,
      missing,
      coverageRate: group.templateKeys.length ? existingCount / group.templateKeys.length : 1,
      activeRate: group.templateKeys.length ? activeCount / group.templateKeys.length : 1,
    };
  });
  const coverageRate = AUTOMATION_CORE_TEMPLATE_KEYS.length
    ? (AUTOMATION_CORE_TEMPLATE_KEYS.length - missingKeys.length) / AUTOMATION_CORE_TEMPLATE_KEYS.length
    : 1;
  const activeRate = AUTOMATION_CORE_TEMPLATE_KEYS.length
    ? (AUTOMATION_CORE_TEMPLATE_KEYS.length - activeMissingKeys.length) / AUTOMATION_CORE_TEMPLATE_KEYS.length
    : 1;

  return {
    groups,
    missingKeys,
    activeMissingKeys,
    coverageRate,
    activeRate,
    recommendation: automationBlueprintRecommendation({ missingKeys, activeMissingKeys, coverageRate, activeRate }),
  };
}

function automationBlueprintRecommendation(input: { missingKeys: string[]; activeMissingKeys: string[]; coverageRate: number; activeRate: number }) {
  if (input.missingKeys.length === AUTOMATION_CORE_TEMPLATE_KEYS.length) {
    return '核心自动化蓝图还没有铺开。建议一键补齐并开启,先覆盖线索分配、线索评分、AI 草稿、语言识别、非工作时间兜底和开发信草稿。';
  }
  if (input.missingKeys.length > 0) {
    return `核心蓝图还缺 ${input.missingKeys.length} 个流程。先补齐缺口,避免部分渠道和销售动作仍靠人工记忆。`;
  }
  if (input.activeMissingKeys.length > 0) {
    return `核心蓝图已创建,但还有 ${input.activeMissingKeys.length} 个未开启。建议先测试再开启,保证入站线索能自动进入任务/草稿/提醒。`;
  }
  if (input.activeRate >= 0.9) return '核心自动化蓝图已基本启用。下一步看命中率、失败率和销售转化归因,继续微调条件。';
  return '自动化蓝图已有基础覆盖,继续补齐未启用流程和低命中流程。';
}

function BlueprintPackResultBanner({
  result,
}: {
  result: { pack?: string; created?: string; skipped?: string };
}) {
  const label: Record<string, string> = {
    activated: '核心自动化流程已补齐并开启',
    drafted: '核心自动化草稿已补齐',
  };
  return (
    <div className="mb-4 rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-3 text-xs font-bold text-indigo-800">
      {label[result.pack || ''] || '自动化蓝图动作已执行'}
      <span className="ml-2">新增 {result.created || '0'}</span>
      <span className="ml-2 text-indigo-600">已存在/跳过 {result.skipped || '0'}</span>
    </div>
  );
}

function BlueprintGroupCard({ group }: { group: any }) {
  const complete = group.coverageRate >= 1;
  const activeComplete = group.activeRate >= 1;
  const tone = activeComplete ? 'emerald' : complete ? 'amber' : 'rose';
  const color: Record<string, string> = {
    emerald: 'border-emerald-100 bg-emerald-50 text-emerald-900',
    amber: 'border-amber-100 bg-amber-50 text-amber-900',
    rose: 'border-rose-100 bg-rose-50 text-rose-900',
  };
  return (
    <div className={`rounded-xl border p-4 ${color[tone]}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-black opacity-75">{group.title}</div>
          <div className="mt-2 text-2xl font-black">{group.existingCount}/{group.templateKeys.length}</div>
        </div>
        <span className="rounded-full bg-white/70 px-2 py-1 text-[11px] font-black">
          开启 {group.activeCount}
        </span>
      </div>
      <div className="mt-2 min-h-[40px] text-xs font-bold opacity-75">{group.description}</div>
      <div className="mt-3 space-y-1">
        {group.templates.map((template: any) => (
          <div key={template.key} className="flex items-center justify-between gap-2 rounded-lg bg-white/70 px-2 py-1.5 text-[11px] font-bold">
            <span className="truncate">{template.name}</span>
            <span className="shrink-0 opacity-70">{template.channel}</span>
          </div>
        ))}
      </div>
      {group.missing.length > 0 && (
        <div className="mt-3 text-[11px] font-black opacity-75">缺: {group.missing.join('、')}</div>
      )}
    </div>
  );
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatAutomationPercent(value: number | null) {
  if (value === null) return '-';
  return `${Math.round(value * 100)}%`;
}

function GovernanceMetric({ label, value, detail, tone }: { label: string; value: number | string; detail: string; tone: string }) {
  const color: Record<string, string> = {
    blue: 'border-blue-100 bg-blue-50 text-blue-800',
    emerald: 'border-emerald-100 bg-emerald-50 text-emerald-800',
    amber: 'border-amber-100 bg-amber-50 text-amber-800',
    rose: 'border-rose-100 bg-rose-50 text-rose-800',
    slate: 'border-slate-100 bg-slate-50 text-slate-800',
  };
  return (
    <div className={`rounded-xl border p-3 ${color[tone] || color.slate}`}>
      <div className="text-xs font-bold opacity-70">{label}</div>
      <div className="mt-1 text-xl font-black">{value}</div>
      <div className="mt-1 text-[11px] font-bold opacity-70">{detail}</div>
    </div>
  );
}

function AutomationBar({ label, value, max, detail }: { label: string; value: number; max: number; detail: string }) {
  const width = Math.max(3, Math.round((value / Math.max(1, max)) * 100));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3">
        <div className="truncate text-xs font-black text-gray-700">{label}</div>
        <div className="text-xs font-bold text-gray-400">{value}</div>
      </div>
      <div className="h-2 rounded-full bg-gray-100">
        <div className="h-2 rounded-full bg-indigo-500" style={{ width: `${width}%` }} />
      </div>
      <div className="mt-1 text-[11px] font-bold text-gray-400">{detail}</div>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-slate-50 p-3">
      <div className="text-gray-400 flex items-center gap-1.5 text-xs">{icon}{label}</div>
      <div className="text-xl font-bold text-gray-900 mt-1">{value}</div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const active = status === 'ACTIVE';
  const paused = status === 'PAUSED';
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-bold ${
        active ? 'bg-emerald-50 text-emerald-700' : paused ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-600'
      }`}
    >
      {active ? <CheckCircle2 className="h-3.5 w-3.5" /> : paused ? <PauseCircle className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
      {STATUS_LABEL[status] || status}
    </span>
  );
}

function TemplateIcon({ category }: { category: string }) {
  const cls = 'h-4 w-4 text-indigo-600 shrink-0';
  if (category === '外贸开发') return <Mail className={cls} />;
  if (category === '客户画像') return <Tags className={cls} />;
  if (category === '线索评分') return <BarChart3 className={cls} />;
  if (category === '客户接待') return <MessageSquare className={cls} />;
  return <Bot className={cls} />;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-gray-500 mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function ConfigPanel({ title, icon, label, json }: { title: string; icon: React.ReactNode; label: string; json: unknown }) {
  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5">
      <h3 className="font-bold text-gray-900 flex items-center gap-2">
        <span className="text-indigo-600">{icon}</span>
        {title}
      </h3>
      <div className="mt-3 text-sm font-bold text-gray-700">{label}</div>
      <pre className="mt-3 bg-slate-50 border border-gray-100 rounded-lg p-3 text-xs text-gray-600 overflow-x-auto whitespace-pre-wrap">
        {compactJson(json)}
      </pre>
    </div>
  );
}

function FlowCanvas({ flow }: { flow: any }) {
  const hasCondition = Boolean(flow.conditionType);
  return (
    <div className="min-w-[780px] h-[330px] relative rounded-xl bg-white border border-slate-200">
      <div className={`absolute left-8 top-16 w-56 rounded-lg border p-4 shadow-sm ${NODE_STYLE.trigger}`}>
        <div className="text-xs font-bold opacity-70 mb-2">触发器</div>
        <div className="font-bold">{flow.triggerType}</div>
        <div className="mt-2 text-xs opacity-70">客户事件发生后启动流程</div>
      </div>
      {hasCondition && (
        <div className={`absolute left-[310px] top-16 w-56 rounded-lg border p-4 shadow-sm ${NODE_STYLE.condition}`}>
          <div className="text-xs font-bold opacity-70 mb-2">条件</div>
          <div className="font-bold">{flow.conditionType}</div>
          <div className="mt-2 text-xs opacity-70">匹配后进入绿色分支,否则进入兜底路径</div>
        </div>
      )}
      <div className={`absolute ${hasCondition ? 'left-[590px]' : 'left-[310px]'} top-16 w-56 rounded-lg border p-4 shadow-sm ${NODE_STYLE.action}`}>
        <div className="text-xs font-bold opacity-70 mb-2">动作</div>
        <div className="font-bold">{flow.actionType}</div>
        <div className="mt-2 text-xs opacity-70">发送消息、生成草稿、打标签、分配负责人或提醒跟进</div>
      </div>
      <Connector left={264} top={104} width={hasCondition ? 46 : 46} label="下一步" />
      {hasCondition ? (
        <>
          <Connector left={546} top={104} width={44} label="匹配" tone="green" />
          <div className="absolute left-[438px] top-[190px] h-16 border-l-2 border-rose-300" />
          <div className="absolute left-[438px] top-[254px] w-[270px] border-t-2 border-rose-300" />
          <div className="absolute left-[455px] top-[220px] text-xs text-rose-600 font-bold">不匹配: 跳过或进入人工队列</div>
        </>
      ) : null}
      <div className="absolute right-4 bottom-4 flex gap-2">
        <span className="px-2 py-1 rounded bg-slate-100 text-xs text-slate-500">适配</span>
        <span className="px-2 py-1 rounded bg-slate-100 text-xs text-slate-500">缩放</span>
        <span className="px-2 py-1 rounded bg-slate-100 text-xs text-slate-500">定位</span>
      </div>
    </div>
  );
}

function Connector({ left, top, width, label, tone = 'gray' }: { left: number; top: number; width: number; label: string; tone?: 'gray' | 'green' }) {
  const color = tone === 'green' ? 'border-emerald-400 text-emerald-600' : 'border-gray-400 text-gray-500';
  return (
    <div className={`absolute ${color}`} style={{ left, top, width }}>
      <div className="border-t-2" />
      <div className="absolute -top-7 left-1/2 -translate-x-1/2 text-xs font-bold whitespace-nowrap">{label}</div>
      <div className="absolute -right-1 -top-1.5 h-3 w-3 rounded-full bg-current" />
    </div>
  );
}

function RunList({ runs, showFlow = false }: { runs: any[]; showFlow?: boolean }) {
  if (!runs.length) return <div className="text-sm text-gray-400 py-6 text-center">暂无运行记录。点击“测试一下”会生成第一条记录。</div>;
  return (
    <div className="space-y-3">
      {runs.map((run) => (
        <div key={run.id} className="border border-gray-100 rounded-lg p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              {showFlow && run.flow && <div className="text-xs font-mono text-gray-400 mb-1">{run.flow.flowCode}</div>}
              <div className="text-sm font-bold text-gray-800">{showFlow && run.flow ? run.flow.name : run.summary || '运行记录'}</div>
              <div className="text-xs text-gray-500 mt-1">{run.summary || '流程已执行'}</div>
            </div>
            <span className={`px-2 py-1 rounded text-xs font-bold ${run.status === 'FAILED' ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700'}`}>
              {RUN_STATUS_LABEL[run.status] || run.status}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-gray-400">
            <span>{CHANNEL_LABEL[run.channel] || run.channel}</span>
            <span>{new Date(run.createdAt).toLocaleString('zh-CN')}</span>
            {run.user && <span>{run.user.name || run.user.email}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

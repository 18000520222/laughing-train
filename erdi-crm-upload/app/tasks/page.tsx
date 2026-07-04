import { prisma } from '@/lib/prisma';
import { chat, isLLMAvailable } from '@/lib/llm';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { sendSalesTaskReminders } from '@/lib/sales-task-reminders';
import { escalateOverdueSalesTasks, getSalesTaskEscalationPolicies } from '@/lib/sales-task-escalations';
import { createTaskCalendarToken, taskCalendarUrl } from '@/lib/sales-task-calendar';

export const dynamic = 'force-dynamic';

const PRIORITY_LABEL: Record<string, string> = {
  URGENT: '紧急',
  HIGH: '高',
  NORMAL: '普通',
  LOW: '低',
};

const TYPE_LABEL: Record<string, string> = {
  FOLLOW_UP: '跟进',
  EMAIL: '邮件',
  PHONE: '电话',
  MEETING: '会议',
  QUOTE: '报价',
  TECH_CHECK: '技术确认',
  RISK_RESCUE: '风险挽回',
  GENERAL: '通用',
};

const PRIORITY_WEIGHT: Record<string, number> = {
  URGENT: 4,
  HIGH: 3,
  NORMAL: 2,
  LOW: 1,
};

async function currentUser() {
  const role = (cookies().get('auth_role')?.value || '').toUpperCase();
  const email = cookies().get('auth_email')?.value || '';
  if (role !== 'SUPER_ADMIN' && role !== 'ADMIN' && role !== 'SALES') redirect('/dashboard');
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) redirect('/dashboard');
  return { user, role };
}

async function completeTask(formData: FormData) {
  'use server';
  const { user, role } = await currentUser();
  const id = String(formData.get('id') || '');
  if (!id) return;
  const task = await prisma.salesTask.findUnique({ where: { id } });
  if (!task) return;
  if (role === 'SALES' && task.ownerId !== user.id) return;

  await prisma.salesTask.update({
    where: { id },
    data: { status: 'DONE', completedAt: new Date() },
  });
  await prisma.followUp.create({
    data: {
      companyId: task.companyId,
      userId: user.id,
      type: 'TASK',
      content: `完成销售任务: ${task.title}`,
    },
  });
  redirect('/tasks');
}

async function generateDraft(formData: FormData) {
  'use server';
  const { user, role } = await currentUser();
  const id = String(formData.get('id') || '');
  if (!id) return;

  const task = await prisma.salesTask.findUnique({
    where: { id },
    include: {
      owner: true,
      company: {
        include: {
          contacts: { orderBy: { createdAt: 'asc' }, take: 3 },
          inboxMessages: { orderBy: { createdAt: 'desc' }, take: 5 },
          opportunities: { orderBy: { updatedAt: 'desc' }, take: 3, include: { product: true } },
        },
      },
      opportunity: { include: { product: true } },
    },
  });
  if (!task) return;
  if (role === 'SALES' && task.ownerId !== user.id) return;

  const fallback = buildFallbackDraft(task);
  let draft = fallback;
  if (isLLMAvailable()) {
    try {
      const result = await chat([
        {
          role: 'system',
          content: 'You are an experienced B2B export sales manager for optoelectronic and laser rangefinder products. Output only valid JSON.',
        },
        {
          role: 'user',
          content: `Create a concise English follow-up email draft for this CRM sales task. Do not invent prices, delivery dates, certifications, or specs. Keep it professional and useful.

Task:
${JSON.stringify({
  title: task.title,
  description: task.description,
  type: task.type,
  priority: task.priority,
  dueAt: task.dueAt,
}, null, 2)}

Company:
${JSON.stringify({
  name: task.company.name,
  country: task.company.country,
  source: task.company.source,
  mainProducts: task.company.mainProducts,
  painPoints: task.company.painPoints,
  competitors: task.company.competitors,
  nextAction: task.company.nextAction,
  contacts: task.company.contacts.map((c) => ({ name: `${c.firstName} ${c.lastName || ''}`.trim(), email: c.email, title: c.title })),
  opportunities: task.company.opportunities.map((o) => ({ title: o.title, stage: o.stage, amountUSD: o.amountUSD, product: o.product?.name })),
  recentMessages: task.company.inboxMessages.map((m) => ({ direction: m.direction, text: String(m.translatedText || m.originalText || '').slice(0, 500) })),
}, null, 2)}

Return JSON:
{
  "subject": "email subject",
  "body": "plain text English email body"
}`,
        },
      ], { json: true, temperature: 0.25, timeoutMs: 15000 });
      const parsed = JSON.parse(result);
      if (typeof parsed.subject === 'string' && typeof parsed.body === 'string') {
        draft = { subject: parsed.subject.slice(0, 180), body: parsed.body };
      }
    } catch (err) {
      console.error('Task draft generation failed:', err);
    }
  }

  await prisma.salesTask.update({
    where: { id },
    data: {
      draftSubject: draft.subject,
      draftBody: draft.body,
      draftGeneratedAt: new Date(),
    },
  });
  redirect('/tasks');
}

async function createManualTask(formData: FormData) {
  'use server';
  const { user, role } = await currentUser();
  const companyId = String(formData.get('companyId') || '');
  const title = String(formData.get('title') || '').trim();
  if (!companyId || !title) return;

  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) return;

  const ownerIdFromForm = String(formData.get('ownerId') || '');
  const ownerId = role === 'SALES' ? user.id : ownerIdFromForm || company.ownerId || user.id;
  const owner = await prisma.user.findUnique({ where: { id: ownerId } });
  if (!owner) return;

  const dueRaw = String(formData.get('dueAt') || '');
  const dueAt = dueRaw ? new Date(dueRaw) : null;
  const due = dueAt && !Number.isNaN(dueAt.getTime()) ? dueAt : null;
  const opportunityIdFromForm = String(formData.get('opportunityId') || '') || null;
  const opportunity = opportunityIdFromForm
    ? await prisma.opportunity.findFirst({ where: { id: opportunityIdFromForm, companyId }, select: { id: true } })
    : null;
  const priorityInput = String(formData.get('priority') || 'NORMAL');
  const typeInput = String(formData.get('type') || 'FOLLOW_UP');
  const priority = (Object.keys(PRIORITY_LABEL).includes(priorityInput) ? priorityInput : 'NORMAL') as any;
  const type = (Object.keys(TYPE_LABEL).includes(typeInput) ? typeInput : 'FOLLOW_UP') as any;
  const description = String(formData.get('description') || '').trim() || null;

  await prisma.salesTask.create({
    data: {
      title,
      description,
      type,
      priority,
      dueAt: due,
      ownerId: owner.id,
      createdById: user.id,
      companyId,
      opportunityId: opportunity?.id || null,
      source: 'MANUAL',
    },
  });
  await prisma.notification.create({
    data: {
      userId: owner.id,
      type: 'SYSTEM',
      title: '新的销售任务',
      body: `${company.name}: ${title}`,
      link: `/tasks`,
    },
  });
  redirect('/tasks');
}

async function sendDueTaskReminders() {
  'use server';
  const { user, role } = await currentUser();
  await sendSalesTaskReminders({ ownerId: role === 'SALES' ? user.id : undefined, limit: 100 });
  redirect('/tasks');
}

async function escalateDueTasks() {
  'use server';
  const { role } = await currentUser();
  if (role !== 'SUPER_ADMIN' && role !== 'ADMIN') return;
  await escalateOverdueSalesTasks({ limit: 100 });
  redirect('/tasks?view=escalated');
}

async function saveEscalationPolicies(formData: FormData) {
  'use server';
  const { role } = await currentUser();
  if (role !== 'SUPER_ADMIN' && role !== 'ADMIN') return;

  for (const priority of ['URGENT', 'HIGH', 'NORMAL', 'LOW']) {
    await prisma.salesTaskEscalationPolicy.upsert({
      where: { priority: priority as any },
      update: {
        thresholdHours: intInput(formData.get(`${priority}_thresholdHours`), priority === 'URGENT' ? 2 : priority === 'HIGH' ? 8 : priority === 'NORMAL' ? 24 : 48),
        isActive: formData.get(`${priority}_isActive`) === 'on',
        notifyOwner: formData.get(`${priority}_notifyOwner`) === 'on',
        notifyAdmins: formData.get(`${priority}_notifyAdmins`) === 'on',
        notes: String(formData.get(`${priority}_notes`) || '').trim() || null,
      },
      create: {
        priority: priority as any,
        thresholdHours: intInput(formData.get(`${priority}_thresholdHours`), priority === 'URGENT' ? 2 : priority === 'HIGH' ? 8 : priority === 'NORMAL' ? 24 : 48),
        isActive: formData.get(`${priority}_isActive`) === 'on',
        notifyOwner: formData.get(`${priority}_notifyOwner`) === 'on',
        notifyAdmins: formData.get(`${priority}_notifyAdmins`) === 'on',
        notes: String(formData.get(`${priority}_notes`) || '').trim() || null,
      },
    });
  }
  redirect('/tasks?view=escalated');
}

async function bulkUpdateTasks(formData: FormData) {
  'use server';
  const { user, role } = await currentUser();
  const canSeeAll = role === 'SUPER_ADMIN' || role === 'ADMIN';
  const ids = formData.getAll('taskId').map((id) => String(id)).filter(Boolean);
  const action = String(formData.get('bulkAction') || '');
  if (ids.length === 0 || !action) return;

  const tasks = await prisma.salesTask.findMany({
    where: {
      id: { in: ids },
      status: 'TODO',
      ...(canSeeAll ? {} : { ownerId: user.id }),
    },
    include: { company: true },
    take: 100,
  });
  if (tasks.length === 0) return;

  const taskIds = tasks.map((task) => task.id);
  const now = new Date();
  if (action === 'COMPLETE') {
    await prisma.salesTask.updateMany({
      where: { id: { in: taskIds } },
      data: { status: 'DONE', completedAt: now },
    });
    await prisma.followUp.createMany({
      data: tasks.map((task) => ({
        companyId: task.companyId,
        userId: user.id,
        type: 'TASK',
        content: `批量完成销售任务: ${task.title}`,
      })),
    });
  }

  if (action === 'SNOOZE_1' || action === 'SNOOZE_3') {
    const days = action === 'SNOOZE_1' ? 1 : 3;
    await Promise.all(tasks.map((task) => {
      const base = task.dueAt && task.dueAt > now ? new Date(task.dueAt) : new Date(now);
      base.setDate(base.getDate() + days);
      return prisma.salesTask.update({
        where: { id: task.id },
        data: { dueAt: base, reminderSentAt: null, escalatedAt: null },
      });
    }));
  }

  if (action === 'SET_DUE') {
    const dueRaw = String(formData.get('bulkDueAt') || '');
    const dueAt = dueRaw ? new Date(dueRaw) : null;
    if (dueAt && !Number.isNaN(dueAt.getTime())) {
      await prisma.salesTask.updateMany({
        where: { id: { in: taskIds } },
        data: { dueAt, reminderSentAt: null, escalatedAt: null },
      });
    }
  }

  if (action === 'ASSIGN_OWNER' && canSeeAll) {
    const ownerId = String(formData.get('bulkOwnerId') || '');
    const owner = ownerId ? await prisma.user.findUnique({ where: { id: ownerId } }) : null;
    if (owner) {
      await prisma.salesTask.updateMany({
        where: { id: { in: taskIds } },
        data: { ownerId: owner.id, reminderSentAt: null, escalatedAt: null },
      });
      await prisma.notification.createMany({
        data: tasks.map((task) => ({
          userId: owner.id,
          type: 'SYSTEM' as any,
          title: '销售任务已转派给你',
          body: `${task.company.name}: ${task.title}`,
          link: '/tasks',
        })),
      });
    }
  }

  redirect('/tasks');
}

export default async function TasksPage(props: any) {
  const { user, role } = await currentUser();
  const canSeeAll = role === 'SUPER_ADMIN' || role === 'ADMIN';
  const sp = props.searchParams || {};
  const view = String(sp.view || 'todo');
  const scope = canSeeAll ? String(sp.scope || 'all') : 'mine';
  const priority = String(sp.priority || '');

  const now = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const reportStart = startOfDay(new Date());
  reportStart.setDate(reportStart.getDate() - 13);
  const weekEnd = new Date();
  weekEnd.setDate(weekEnd.getDate() + 7);

  const baseWhere: any = {};
  if (!canSeeAll || scope === 'mine') baseWhere.ownerId = user.id;
  if (priority) baseWhere.priority = priority;

  const where: any = { ...baseWhere };
  if (view === 'done') {
    where.status = 'DONE';
  } else {
    where.status = 'TODO';
    if (view === 'overdue') where.dueAt = { lt: now };
    if (view === 'today') where.dueAt = { gte: now, lt: tomorrow };
    if (view === 'week') where.dueAt = { gte: now, lt: weekEnd };
    if (view === 'unscheduled') where.dueAt = null;
    if (view === 'escalated') where.escalatedAt = { not: null };
    if (view === 'drafted') where.draftGeneratedAt = { not: null };
  }

  const [tasks, openCount, overdueCount, todayCount, doneWeekCount, weekCount, noDueCount, escalatedCount, users, companies, opportunities, weekTasks, ownerTaskRows, ownerDoneRows, completedReportTasks, nextTaskCandidates, escalationPolicies] = await Promise.all([
    prisma.salesTask.findMany({
      where,
      orderBy: [{ dueAt: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
      take: 80,
      include: { owner: true, company: true, opportunity: true },
    }),
    prisma.salesTask.count({ where: { ...baseWhere, status: 'TODO' } }),
    prisma.salesTask.count({ where: { ...baseWhere, status: 'TODO', dueAt: { lt: now } } }),
    prisma.salesTask.count({ where: { ...baseWhere, status: 'TODO', dueAt: { gte: now, lt: tomorrow } } }),
    prisma.salesTask.count({ where: { ...baseWhere, status: 'DONE', completedAt: { gte: weekAgo } } }),
    prisma.salesTask.count({ where: { ...baseWhere, status: 'TODO', dueAt: { gte: now, lt: weekEnd } } }),
    prisma.salesTask.count({ where: { ...baseWhere, status: 'TODO', dueAt: null } }),
    prisma.salesTask.count({ where: { ...baseWhere, status: 'TODO', escalatedAt: { not: null } } }),
    prisma.user.findMany({ where: { role: { in: ['SUPER_ADMIN', 'ADMIN', 'SALES'] as any }, isActive: true }, orderBy: [{ role: 'asc' }, { createdAt: 'asc' }] }),
    prisma.company.findMany({ orderBy: { updatedAt: 'desc' }, take: 120, select: { id: true, name: true, ownerId: true } }),
    prisma.opportunity.findMany({
      where: { stage: { notIn: ['CLOSED_WON', 'CLOSED_LOST'] as any } },
      orderBy: { updatedAt: 'desc' },
      take: 120,
      select: { id: true, title: true, companyId: true },
    }),
    prisma.salesTask.findMany({
      where: { ...baseWhere, status: 'TODO', dueAt: { gte: now, lt: weekEnd } },
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
      include: { owner: true, company: true },
      take: 80,
    }),
    prisma.salesTask.groupBy({ by: ['ownerId'], where: { status: 'TODO' }, _count: { _all: true } }),
    prisma.salesTask.groupBy({ by: ['ownerId'], where: { status: 'DONE', completedAt: { gte: weekAgo } }, _count: { _all: true } }),
    prisma.salesTask.findMany({
      where: { ...baseWhere, status: 'DONE', completedAt: { gte: reportStart } },
      orderBy: { completedAt: 'asc' },
      include: { owner: true, company: true },
      take: 400,
    }),
    prisma.salesTask.findMany({
      where: { ...baseWhere, status: 'TODO' },
      orderBy: [{ dueAt: 'asc' }, { priority: 'desc' }, { createdAt: 'asc' }],
      include: { owner: true, company: true, opportunity: true },
      take: 60,
    }),
    canSeeAll ? getSalesTaskEscalationPolicies() : Promise.resolve([]),
  ]);

  const doneByOwner = new Map(ownerDoneRows.map((row) => [row.ownerId, row._count._all]));
  const ownerStats = ownerTaskRows
    .map((row) => {
      const owner = users.find((item) => item.id === row.ownerId);
      return {
        ownerId: row.ownerId,
        name: owner?.name || owner?.email || '未知负责人',
        open: row._count._all,
        done: doneByOwner.get(row.ownerId) || 0,
      };
    })
    .sort((a, b) => b.open - a.open)
    .slice(0, 8);
  const weekBuckets = buildWeekBuckets(weekTasks);
  const companyNameById = new Map(companies.map((company) => [company.id, company.name]));
  const maxOwnerOpen = Math.max(1, ...ownerStats.map((item) => item.open));
  const bulkFormId = 'sales-task-bulk-form';
  const taskReport = buildTaskReport(completedReportTasks, users, { openCount, overdueCount, reportStart });
  const nextTask = pickNextTask(nextTaskCandidates);
  const calendarToken = createTaskCalendarToken({ userId: user.id, email: user.email, role });
  const calendarDownloadParams = new URLSearchParams();
  calendarDownloadParams.set('scope', scope);
  if (priority) calendarDownloadParams.set('priority', priority);
  const calendarDownloadUrl = `/api/tasks/calendar?${calendarDownloadParams.toString()}`;
  const myCalendarUrl = taskCalendarUrl(calendarToken, { scope: 'mine', priority });
  const allCalendarUrl = canSeeAll ? taskCalendarUrl(calendarToken, { scope: 'all', priority }) : '';
  const myWebcalUrl = myCalendarUrl.replace(/^https:/, 'webcal:');
  const allWebcalUrl = allCalendarUrl.replace(/^https:/, 'webcal:');

  const qs = (extra: Record<string, string>) => {
    const params = new URLSearchParams();
    params.set('view', view);
    params.set('scope', scope);
    if (priority) params.set('priority', priority);
    Object.entries(extra).forEach(([key, value]) => {
      if (value) params.set(key, value);
      else params.delete(key);
    });
    return params.toString();
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6 md:p-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">销售任务中心</h1>
          <p className="mt-1 text-sm text-gray-500">从智能雷达、客户跟进和商机推进生成任务,按截止时间闭环执行</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <form action={sendDueTaskReminders}>
            <button className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-bold text-amber-700 hover:bg-amber-100">发送到期提醒</button>
          </form>
          {canSeeAll && (
            <form action={escalateDueTasks}>
              <button className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-bold text-rose-700 hover:bg-rose-100">升级SLA异常</button>
            </form>
          )}
          <Link href="/sales-command" className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-bold text-indigo-700 hover:bg-indigo-100">销售指挥台</Link>
          <Link href="/customers" className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50">客户列表</Link>
        </div>
      </header>

      <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="待办任务" value={openCount} tone="blue" />
        <Metric label="已逾期" value={overdueCount} tone="rose" />
        <Metric label="24小时内到期" value={todayCount} tone="amber" />
        <Metric label="本周完成" value={doneWeekCount} tone="emerald" />
      </section>

      <section className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <QueueCard href={`/tasks?${qs({ view: 'overdue' })}`} label="逾期队列" count={overdueCount} note="先处理客户已在等的任务" tone="rose" />
        <QueueCard href={`/tasks?${qs({ view: 'today' })}`} label="今日队列" count={todayCount} note="今天必须完成或顺延" tone="amber" />
        <QueueCard href={`/tasks?${qs({ view: 'week' })}`} label="7天排程" count={weekCount} note="本周要推进的跟进动作" tone="blue" />
        <QueueCard href={`/tasks?${qs({ view: 'unscheduled' })}`} label="未排期队列" count={noDueCount} note="需要补截止时间" tone="slate" />
        <QueueCard href={`/tasks?${qs({ view: 'escalated' })}`} label="SLA升级" count={escalatedCount} note="管理层已收到异常" tone="rose" />
      </section>

      {canSeeAll && (
        <section className="mb-6 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-black text-gray-900">SLA 升级策略</h2>
              <p className="mt-1 text-xs text-gray-400">按任务优先级设置逾期多久仍未完成就升级;手工按钮和每日 09:30 cron 共用这些策略。</p>
            </div>
            <form action={escalateDueTasks}>
              <button className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-bold text-rose-700 hover:bg-rose-100">按策略立即升级</button>
            </form>
          </div>
          <form action={saveEscalationPolicies} className="grid gap-3 xl:grid-cols-4">
            {['URGENT', 'HIGH', 'NORMAL', 'LOW'].map((priority) => {
              const policy = escalationPolicies.find((item: any) => item.priority === priority);
              return (
                <div key={priority} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <TaskPriority priority={priority} />
                    <label className="flex items-center gap-2 text-xs font-black text-gray-500">
                      <input name={`${priority}_isActive`} type="checkbox" defaultChecked={policy?.isActive ?? true} className="h-4 w-4 accent-indigo-600" />
                      启用
                    </label>
                  </div>
                  <label className="block text-xs font-black text-gray-500">
                    逾期后升级小时
                    <input name={`${priority}_thresholdHours`} type="number" min="1" max="720" defaultValue={policy?.thresholdHours || (priority === 'URGENT' ? 2 : priority === 'HIGH' ? 8 : priority === 'NORMAL' ? 24 : 48)} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:border-indigo-400" />
                  </label>
                  <div className="mt-3 grid gap-2 text-xs font-black text-gray-500">
                    <label className="flex items-center gap-2">
                      <input name={`${priority}_notifyOwner`} type="checkbox" defaultChecked={policy?.notifyOwner ?? true} className="h-4 w-4 accent-indigo-600" />
                      通知负责人
                    </label>
                    <label className="flex items-center gap-2">
                      <input name={`${priority}_notifyAdmins`} type="checkbox" defaultChecked={policy?.notifyAdmins ?? true} className="h-4 w-4 accent-indigo-600" />
                      通知管理层
                    </label>
                  </div>
                  <label className="mt-3 block text-xs font-black text-gray-500">
                    策略备注
                    <textarea name={`${priority}_notes`} defaultValue={policy?.notes || ''} rows={3} className="mt-1 w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 outline-none focus:border-indigo-400" />
                  </label>
                </div>
              );
            })}
            <div className="xl:col-span-4">
              <button className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-black text-white hover:bg-indigo-700">保存 SLA 策略</button>
            </div>
          </form>
        </section>
      )}

      <section className="mb-6 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-black text-gray-900">销售日历 / ICS</h2>
            <p className="mt-1 text-xs text-gray-400">将待办任务同步到 Apple、Google、Outlook 日历,默认提前 30 分钟提醒。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/tasks/focus?queue=${view === 'todo' || view === 'drafted' || view === 'done' ? 'all' : view}&scope=${scope}${priority ? `&priority=${priority}` : ''}`} className="rounded-lg border border-cyan-200 bg-cyan-50 px-4 py-2 text-sm font-bold text-cyan-700 hover:bg-cyan-100">沉浸式执行</Link>
            <a href={calendarDownloadUrl} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-100">下载当前视图</a>
            <a href={myWebcalUrl} className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700 hover:bg-emerald-100">订阅我的日历</a>
            {canSeeAll && <a href={allWebcalUrl} className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-black text-indigo-700 hover:bg-indigo-100">订阅全员日历</a>}
          </div>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <label className="block text-xs font-black text-gray-500">
            我的订阅链接
            <input readOnly value={myCalendarUrl} className="mt-1 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-bold text-gray-600 outline-none" />
          </label>
          {canSeeAll && (
            <label className="block text-xs font-black text-gray-500">
              全员订阅链接
              <input readOnly value={allCalendarUrl} className="mt-1 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-bold text-gray-600 outline-none" />
            </label>
          )}
        </div>
      </section>

      <section className="mb-6 grid gap-4 xl:grid-cols-[minmax(320px,0.85fr)_minmax(0,1.15fr)]">
        <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-black text-gray-900">下一条该做</h2>
              <p className="mt-1 text-xs text-gray-400">按逾期、截止时间和优先级自动挑选。</p>
            </div>
            {nextTask && <TaskPriority priority={nextTask.priority} />}
          </div>
          {nextTask ? (
            <div>
              <div className="text-lg font-black text-gray-900">{nextTask.title}</div>
              <div className="mt-2 text-sm leading-relaxed text-gray-600">{nextTask.description || '暂无说明'}</div>
              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs font-bold text-gray-400">
                <span>客户:<Link href={`/customers/${nextTask.companyId}`} className="ml-1 text-indigo-600 hover:underline">{nextTask.company.name}</Link></span>
                <span>负责人:{nextTask.owner.name || nextTask.owner.email}</span>
                <span>截止:{nextTask.dueAt ? new Date(nextTask.dueAt).toLocaleString('zh-CN') : '未排期'}</span>
                {nextTask.opportunity && <span>商机:{nextTask.opportunity.title}</span>}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <form action={completeTask}>
                  <input type="hidden" name="id" value={nextTask.id} />
                  <button className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700 hover:bg-emerald-100">完成任务</button>
                </form>
                <form action={generateDraft}>
                  <input type="hidden" name="id" value={nextTask.id} />
                  <button className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700 hover:bg-blue-100">生成邮件草稿</button>
                </form>
                <Link href={`/customers/${nextTask.companyId}`} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 hover:bg-gray-50">打开客户</Link>
              </div>
            </div>
          ) : (
            <div className="rounded-xl bg-gray-50 p-8 text-center text-sm text-gray-400">当前没有待办任务。</div>
          )}
        </section>

        <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-black text-gray-900">任务 SLA / 完成率</h2>
              <p className="mt-1 text-xs text-gray-400">近 14 天完成趋势、准时率和当前逾期压力。</p>
            </div>
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-500">近14天</span>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <ReportMetric label="完成任务" value={taskReport.completedCount} />
            <ReportMetric label="准时完成率" value={formatPercent(taskReport.onTimeRate)} />
            <ReportMetric label="当前逾期率" value={formatPercent(taskReport.overdueRate)} />
            <ReportMetric label="平均完成耗时" value={formatHours(taskReport.avgCompletionHours)} />
          </div>
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between text-xs font-black text-gray-500">
              <span>14天完成趋势</span>
              <span>{taskReport.completedCount} 条</span>
            </div>
            <div className="flex h-24 items-end gap-1 rounded-xl bg-gray-50 p-3">
              {taskReport.dailyTrend.map((day) => (
                <div key={day.key} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                  <div className="w-full rounded-t bg-indigo-500" style={{ height: `${Math.max(4, Math.round((day.count / taskReport.maxDailyCompleted) * 64))}px` }} />
                  <div className="truncate text-[10px] font-bold text-gray-400">{day.label}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-5">
            <div className="mb-2 text-xs font-black text-gray-500">负责人 SLA</div>
            <div className="space-y-2">
              {taskReport.ownerRows.map((row) => (
                <div key={row.ownerId} className="grid grid-cols-[minmax(0,1fr)_64px_72px_72px] items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs">
                  <div className="truncate font-black text-gray-700">{row.name}</div>
                  <div className="text-right font-bold text-gray-500">{row.completed}条</div>
                  <div className="text-right font-bold text-emerald-600">{formatPercent(row.onTimeRate)}</div>
                  <div className="text-right font-bold text-gray-500">{formatHours(row.avgHours)}</div>
                </div>
              ))}
              {taskReport.ownerRows.length === 0 && <div className="rounded-lg bg-gray-50 p-4 text-center text-xs text-gray-400">近 14 天暂无完成任务。</div>}
            </div>
          </div>
        </section>
      </section>

      <section className="mb-6 grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,0.75fr)]">
        <details className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm" open>
          <summary className="cursor-pointer text-sm font-black text-gray-900">手工新增任务</summary>
          <form action={createManualTask} className="mt-4 grid gap-4 lg:grid-cols-2">
            <label className="block text-xs font-black text-gray-500">
              客户
              <select name="companyId" required className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-800 outline-none focus:border-indigo-400">
                <option value="">选择客户</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>{company.name}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-black text-gray-500">
              关联商机
              <select name="opportunityId" className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-800 outline-none focus:border-indigo-400">
                <option value="">不关联商机</option>
                {opportunities.map((opportunity) => (
                  <option key={opportunity.id} value={opportunity.id}>
                    {opportunity.title} · {companyNameById.get(opportunity.companyId) || '未知客户'}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-black text-gray-500 lg:col-span-2">
              任务标题
              <input name="title" required maxLength={160} placeholder="例如: 给德国客户补发规格书并确认年度采购计划" className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:border-indigo-400" />
            </label>
            <label className="block text-xs font-black text-gray-500">
              类型
              <select name="type" defaultValue="FOLLOW_UP" className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-800 outline-none focus:border-indigo-400">
                {Object.entries(TYPE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-black text-gray-500">
              优先级
              <select name="priority" defaultValue="NORMAL" className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-800 outline-none focus:border-indigo-400">
                {Object.entries(PRIORITY_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            {canSeeAll ? (
              <label className="block text-xs font-black text-gray-500">
                负责人
                <select name="ownerId" defaultValue={user.id} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-800 outline-none focus:border-indigo-400">
                  {users.map((item) => (
                    <option key={item.id} value={item.id}>{item.name || item.email}</option>
                  ))}
                </select>
              </label>
            ) : (
              <input type="hidden" name="ownerId" value={user.id} />
            )}
            <label className="block text-xs font-black text-gray-500">
              截止时间
              <input name="dueAt" type="datetime-local" className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:border-indigo-400" />
            </label>
            <label className="block text-xs font-black text-gray-500 lg:col-span-2">
              说明
              <textarea name="description" rows={3} placeholder="写清客户背景、要确认的问题、下一步交付物。" className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm leading-relaxed text-gray-800 outline-none focus:border-indigo-400" />
            </label>
            <div className="lg:col-span-2">
              <button className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-black text-white hover:bg-indigo-700">创建任务</button>
            </div>
          </form>
        </details>

        <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-black text-gray-900">负责人任务负载</h2>
            <span className="text-xs font-bold text-gray-400">待办 / 7天完成</span>
          </div>
          <div className="mt-4 space-y-3">
            {ownerStats.map((stat) => (
              <div key={stat.ownerId}>
                <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                  <span className="truncate font-black text-gray-700">{stat.name}</span>
                  <span className="font-bold text-gray-400">{stat.open} / {stat.done}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                  <div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.max(8, Math.round((stat.open / maxOwnerOpen) * 100))}%` }} />
                </div>
              </div>
            ))}
            {ownerStats.length === 0 && <div className="rounded-xl bg-gray-50 p-6 text-center text-sm text-gray-400">暂无待办负载。</div>}
          </div>
        </section>
      </section>

      <section className="mb-6 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-black text-gray-900">未来 7 天任务排程</h2>
            <p className="mt-1 text-xs text-gray-400">按截止时间看跟进节奏,逾期任务仍在筛选页单独处理。</p>
          </div>
          <FilterLink href={`/tasks?${qs({ view: 'today' })}`} active={view === 'today'}>今日到期</FilterLink>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-7">
          {weekBuckets.map((bucket) => (
            <div key={bucket.key} className="min-h-32 rounded-xl border border-gray-100 bg-gray-50 p-3">
              <div className="mb-3">
                <div className="text-xs font-black text-gray-900">{bucket.label}</div>
                <div className="text-[11px] font-bold text-gray-400">{bucket.date}</div>
              </div>
              <div className="space-y-2">
                {bucket.items.map((task) => (
                  <Link key={task.id} href={`/customers/${task.companyId}`} className="block rounded-lg border border-gray-100 bg-white p-2 hover:border-indigo-200">
                    <div className="line-clamp-2 text-xs font-black text-gray-800">{task.title}</div>
                    <div className="mt-1 truncate text-[11px] font-bold text-gray-400">{task.company.name}</div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[11px] font-bold">
                      <span className="text-gray-400">{task.owner.name || task.owner.email}</span>
                      <span className="text-indigo-600">{task.dueAt ? new Date(task.dueAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '-'}</span>
                    </div>
                  </Link>
                ))}
                {bucket.items.length === 0 && <div className="rounded-lg border border-dashed border-gray-200 p-3 text-center text-xs text-gray-400">空</div>}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-6 flex flex-wrap gap-2 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <FilterLink href={`/tasks?${qs({ view: 'todo' })}`} active={view === 'todo'}>待办</FilterLink>
        <FilterLink href={`/tasks?${qs({ view: 'overdue' })}`} active={view === 'overdue'}>逾期</FilterLink>
        <FilterLink href={`/tasks?${qs({ view: 'today' })}`} active={view === 'today'}>今日到期</FilterLink>
        <FilterLink href={`/tasks?${qs({ view: 'week' })}`} active={view === 'week'}>7天排程</FilterLink>
        <FilterLink href={`/tasks?${qs({ view: 'unscheduled' })}`} active={view === 'unscheduled'}>未排期</FilterLink>
        <FilterLink href={`/tasks?${qs({ view: 'escalated' })}`} active={view === 'escalated'}>SLA升级</FilterLink>
        <FilterLink href={`/tasks?${qs({ view: 'drafted' })}`} active={view === 'drafted'}>已有邮件草稿</FilterLink>
        <FilterLink href={`/tasks?${qs({ view: 'done' })}`} active={view === 'done'}>已完成</FilterLink>
        <div className="mx-2 h-9 w-px bg-gray-100" />
        {canSeeAll && (
          <>
            <FilterLink href={`/tasks?${qs({ scope: 'all' })}`} active={scope === 'all'}>全部人员</FilterLink>
            <FilterLink href={`/tasks?${qs({ scope: 'mine' })}`} active={scope === 'mine'}>只看我的</FilterLink>
          </>
        )}
        <div className="mx-2 h-9 w-px bg-gray-100" />
        {['URGENT', 'HIGH', 'NORMAL', 'LOW'].map((p) => (
          <FilterLink key={p} href={`/tasks?${qs({ priority: priority === p ? '' : p })}`} active={priority === p}>{PRIORITY_LABEL[p]}</FilterLink>
        ))}
      </section>

      <section className="rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-6 py-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-bold text-gray-900">任务列表</h2>
              <p className="mt-1 text-xs text-gray-400">当前显示 {tasks.length} 条。邮件草稿只生成草稿,不会自动发送。</p>
            </div>
            <form id={bulkFormId} action={bulkUpdateTasks} className="flex flex-wrap items-end gap-2">
              <label className="text-xs font-black text-gray-500">
                批量动作
                <select name="bulkAction" defaultValue="SNOOZE_1" className="mt-1 w-32 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-800 outline-none focus:border-indigo-400">
                  <option value="SNOOZE_1">顺延1天</option>
                  <option value="SNOOZE_3">顺延3天</option>
                  <option value="SET_DUE">设截止</option>
                  <option value="COMPLETE">标记完成</option>
                  {canSeeAll && <option value="ASSIGN_OWNER">转派负责人</option>}
                </select>
              </label>
              <label className="text-xs font-black text-gray-500">
                截止时间
                <input name="bulkDueAt" type="datetime-local" className="mt-1 w-44 rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-900 outline-none focus:border-indigo-400" />
              </label>
              {canSeeAll && (
                <label className="text-xs font-black text-gray-500">
                  负责人
                  <select name="bulkOwnerId" defaultValue={user.id} className="mt-1 w-40 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-800 outline-none focus:border-indigo-400">
                    {users.map((item) => (
                      <option key={item.id} value={item.id}>{item.name || item.email}</option>
                    ))}
                  </select>
                </label>
              )}
              <button className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-black text-indigo-700 hover:bg-indigo-100">执行批量操作</button>
            </form>
          </div>
        </div>
        <div className="divide-y divide-gray-50">
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} canComplete={view !== 'done'} bulkFormId={bulkFormId} canBulk={view !== 'done'} />
          ))}
          {tasks.length === 0 && <div className="p-12 text-center text-sm text-gray-400">暂无任务。</div>}
        </div>
      </section>
    </div>
  );
}

function TaskRow({ task, canComplete, bulkFormId, canBulk }: { task: any; canComplete: boolean; bulkFormId: string; canBulk: boolean }) {
  const overdue = task.status === 'TODO' && task.dueAt && new Date(task.dueAt).getTime() < Date.now();
  return (
    <div className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        {canBulk && (
          <label className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white">
            <input form={bulkFormId} type="checkbox" name="taskId" value={task.id} className="h-4 w-4 accent-indigo-600" />
          </label>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <TaskPriority priority={task.priority} />
            <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">{TYPE_LABEL[task.type] || task.type}</span>
            {overdue && <span className="rounded-full bg-rose-50 px-2 py-1 text-xs font-bold text-rose-700">已逾期</span>}
            {task.escalatedAt && <span className="rounded-full bg-fuchsia-50 px-2 py-1 text-xs font-bold text-fuchsia-700">SLA已升级</span>}
          </div>
          <div className="mt-3 text-lg font-black text-gray-900">{task.title}</div>
          <div className="mt-1 text-sm leading-relaxed text-gray-600">{task.description || '暂无说明'}</div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs font-bold text-gray-400">
            <span>客户:<Link href={`/customers/${task.companyId}`} className="ml-1 text-indigo-600 hover:underline">{task.company.name}</Link></span>
            <span>负责人:{task.owner.name || task.owner.email}</span>
            <span>截止:{task.dueAt ? new Date(task.dueAt).toLocaleString('zh-CN') : '-'}</span>
            {task.escalatedAt && <span>升级:{new Date(task.escalatedAt).toLocaleString('zh-CN')}</span>}
            {task.opportunity && <span>商机:{task.opportunity.title}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canComplete && (
            <form action={completeTask}>
              <input type="hidden" name="id" value={task.id} />
              <button className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700 hover:bg-emerald-100">完成任务</button>
            </form>
          )}
          {canComplete && (
            <form action={generateDraft}>
              <input type="hidden" name="id" value={task.id} />
              <button className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700 hover:bg-blue-100">生成邮件草稿</button>
            </form>
          )}
        </div>
      </div>
      {task.draftBody && (
        <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/60 p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-black text-blue-700">邮件草稿 {task.draftGeneratedAt ? `· ${new Date(task.draftGeneratedAt).toLocaleString('zh-CN')}` : ''}</div>
            <div className="text-xs text-blue-500">人工确认后再发送</div>
          </div>
          <div className="rounded-lg bg-white p-3 text-sm font-bold text-gray-900">Subject: {task.draftSubject || '-'}</div>
          <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-white p-3 text-sm leading-relaxed text-gray-700">{task.draftBody}</pre>
        </div>
      )}
    </div>
  );
}

function buildFallbackDraft(task: any) {
  const contact = task.company.contacts?.[0];
  const name = contact?.firstName || 'there';
  const product = task.opportunity?.product?.name || task.company.mainProducts || 'your project';
  return {
    subject: `Follow-up on ${product}`,
    body: `Dear ${name},

I hope you are doing well.

I am following up regarding ${product}. Based on our previous communication, I would like to check whether you need any updated specifications, quotation details, technical confirmation, or delivery information from our side.

Please feel free to send us your latest requirements or questions. We will review them carefully and support you with the next step.

Best regards,
ERDI TECH LTD`,
  };
}

function pickNextTask(tasks: any[]) {
  return [...tasks].sort((a, b) => taskUrgencyScore(b) - taskUrgencyScore(a))[0] || null;
}

function taskUrgencyScore(task: any) {
  const now = Date.now();
  const due = task.dueAt ? new Date(task.dueAt).getTime() : null;
  const overdueScore = due && due < now ? 10000 : 0;
  const dueSoonScore = due ? Math.max(0, 5000 - Math.floor(Math.max(due - now, 0) / 3600000)) : 0;
  return overdueScore + dueSoonScore + (PRIORITY_WEIGHT[task.priority] || 0) * 100 + Math.max(0, 30 - Math.floor((now - new Date(task.createdAt).getTime()) / 86400000));
}

function buildTaskReport(tasks: any[], users: any[], totals: { openCount: number; overdueCount: number; reportStart: Date }) {
  const completedCount = tasks.length;
  const timedTasks = tasks.filter((task) => task.createdAt && task.completedAt);
  const onTimeCount = tasks.filter((task) => task.dueAt && task.completedAt && new Date(task.completedAt).getTime() <= new Date(task.dueAt).getTime()).length;
  const withDueCount = tasks.filter((task) => task.dueAt).length;
  const avgCompletionHours = average(timedTasks.map((task) => (new Date(task.completedAt).getTime() - new Date(task.createdAt).getTime()) / 3600000));
  const ownerMap = new Map<string, { ownerId: string; name: string; completed: number; onTime: number; due: number; hours: number[] }>();

  for (const task of tasks) {
    const owner = task.owner || users.find((item) => item.id === task.ownerId);
    const current = ownerMap.get(task.ownerId) || {
      ownerId: task.ownerId,
      name: owner?.name || owner?.email || '未知负责人',
      completed: 0,
      onTime: 0,
      due: 0,
      hours: [] as number[],
    };
    current.completed++;
    if (task.dueAt) {
      current.due++;
      if (task.completedAt && new Date(task.completedAt).getTime() <= new Date(task.dueAt).getTime()) current.onTime++;
    }
    if (task.createdAt && task.completedAt) current.hours.push((new Date(task.completedAt).getTime() - new Date(task.createdAt).getTime()) / 3600000);
    ownerMap.set(task.ownerId, current);
  }

  const dailyTrend = buildCompletionTrend(tasks, totals.reportStart);
  return {
    completedCount,
    onTimeRate: withDueCount > 0 ? onTimeCount / withDueCount : null,
    overdueRate: totals.openCount > 0 ? totals.overdueCount / totals.openCount : 0,
    avgCompletionHours,
    dailyTrend,
    maxDailyCompleted: Math.max(1, ...dailyTrend.map((day) => day.count)),
    ownerRows: Array.from(ownerMap.values())
      .map((row) => ({
        ownerId: row.ownerId,
        name: row.name,
        completed: row.completed,
        onTimeRate: row.due > 0 ? row.onTime / row.due : null,
        avgHours: average(row.hours),
      }))
      .sort((a, b) => b.completed - a.completed)
      .slice(0, 8),
  };
}

function buildCompletionTrend(tasks: any[], reportStart: Date) {
  return Array.from({ length: 14 }, (_, index) => {
    const date = new Date(reportStart);
    date.setDate(reportStart.getDate() + index);
    const key = dateKey(date);
    return {
      key,
      label: date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }),
      count: tasks.filter((task) => task.completedAt && dateKey(new Date(task.completedAt)) === key).length,
    };
  });
}

function average(values: number[]) {
  const finite = values.filter((value) => Number.isFinite(value) && value >= 0);
  if (finite.length === 0) return null;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function formatPercent(value: number | null) {
  if (value === null) return '-';
  return `${Math.round(value * 100)}%`;
}

function formatHours(value: number | null) {
  if (value === null) return '-';
  if (value < 1) return `${Math.max(1, Math.round(value * 60))}分钟`;
  if (value < 48) return `${Math.round(value)}小时`;
  return `${Math.round(value / 24)}天`;
}

function intInput(value: FormDataEntryValue | null, fallback: number) {
  const next = Number(value || fallback);
  if (!Number.isFinite(next)) return fallback;
  return Math.min(720, Math.max(1, Math.round(next)));
}

function buildWeekBuckets(tasks: any[]) {
  const start = startOfDay(new Date());
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = dateKey(date);
    return {
      key,
      label: index === 0 ? '今天' : date.toLocaleDateString('zh-CN', { weekday: 'short' }),
      date: date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }),
      items: tasks.filter((task) => task.dueAt && dateKey(new Date(task.dueAt)) === key).slice(0, 8),
    };
  });
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  const color: Record<string, string> = {
    blue: 'border-l-blue-500 text-blue-700',
    rose: 'border-l-rose-500 text-rose-700',
    amber: 'border-l-amber-500 text-amber-700',
    emerald: 'border-l-emerald-500 text-emerald-700',
  };
  return (
    <div className={`rounded-xl border border-gray-100 border-l-4 bg-white p-4 shadow-sm ${color[tone]}`}>
      <div className="text-xs font-bold text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-black">{value}</div>
    </div>
  );
}

function ReportMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
      <div className="text-xs font-bold text-gray-500">{label}</div>
      <div className="mt-1 text-xl font-black text-gray-900">{value}</div>
    </div>
  );
}

function QueueCard({ href, label, count, note, tone }: { href: string; label: string; count: number; note: string; tone: string }) {
  const style: Record<string, string> = {
    rose: 'border-rose-100 bg-rose-50 text-rose-700',
    amber: 'border-amber-100 bg-amber-50 text-amber-700',
    blue: 'border-blue-100 bg-blue-50 text-blue-700',
    slate: 'border-slate-100 bg-slate-50 text-slate-700',
  };
  return (
    <Link href={href} className={`rounded-xl border p-4 shadow-sm hover:shadow ${style[tone] || style.blue}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-black">{label}</div>
          <div className="mt-1 text-xs font-bold opacity-70">{note}</div>
        </div>
        <div className="text-2xl font-black">{count}</div>
      </div>
    </Link>
  );
}

function FilterLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} className={`rounded-lg px-3 py-2 text-xs font-black ${active ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
      {children}
    </Link>
  );
}

function TaskPriority({ priority }: { priority: string }) {
  const style: Record<string, string> = {
    URGENT: 'bg-rose-50 text-rose-700 border-rose-100',
    HIGH: 'bg-amber-50 text-amber-700 border-amber-100',
    NORMAL: 'bg-blue-50 text-blue-700 border-blue-100',
    LOW: 'bg-slate-50 text-slate-600 border-slate-100',
  };
  return <span className={`rounded-full border px-2 py-1 text-xs font-bold ${style[priority] || style.NORMAL}`}>{PRIORITY_LABEL[priority] || priority}</span>;
}

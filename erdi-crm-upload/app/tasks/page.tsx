import { prisma } from '@/lib/prisma';
import { chat, isLLMAvailable } from '@/lib/llm';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';

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
    if (view === 'drafted') where.draftGeneratedAt = { not: null };
  }

  const [tasks, openCount, overdueCount, todayCount, doneWeekCount, users] = await Promise.all([
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
    prisma.user.findMany({ where: { role: { in: ['SUPER_ADMIN', 'ADMIN', 'SALES'] as any }, isActive: true }, orderBy: [{ role: 'asc' }, { createdAt: 'asc' }] }),
  ]);

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

      <section className="mb-6 flex flex-wrap gap-2 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <FilterLink href={`/tasks?${qs({ view: 'todo' })}`} active={view === 'todo'}>待办</FilterLink>
        <FilterLink href={`/tasks?${qs({ view: 'overdue' })}`} active={view === 'overdue'}>逾期</FilterLink>
        <FilterLink href={`/tasks?${qs({ view: 'today' })}`} active={view === 'today'}>今日到期</FilterLink>
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
          <h2 className="font-bold text-gray-900">任务列表</h2>
          <p className="mt-1 text-xs text-gray-400">当前显示 {tasks.length} 条。邮件草稿只生成草稿,不会自动发送。</p>
        </div>
        <div className="divide-y divide-gray-50">
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} canComplete={view !== 'done'} users={users} />
          ))}
          {tasks.length === 0 && <div className="p-12 text-center text-sm text-gray-400">暂无任务。</div>}
        </div>
      </section>
    </div>
  );
}

function TaskRow({ task, canComplete, users }: { task: any; canComplete: boolean; users: any[] }) {
  const overdue = task.status === 'TODO' && task.dueAt && new Date(task.dueAt).getTime() < Date.now();
  return (
    <div className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <TaskPriority priority={task.priority} />
            <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">{TYPE_LABEL[task.type] || task.type}</span>
            {overdue && <span className="rounded-full bg-rose-50 px-2 py-1 text-xs font-bold text-rose-700">已逾期</span>}
          </div>
          <div className="mt-3 text-lg font-black text-gray-900">{task.title}</div>
          <div className="mt-1 text-sm leading-relaxed text-gray-600">{task.description || '暂无说明'}</div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs font-bold text-gray-400">
            <span>客户:<Link href={`/customers/${task.companyId}`} className="ml-1 text-indigo-600 hover:underline">{task.company.name}</Link></span>
            <span>负责人:{task.owner.name || task.owner.email}</span>
            <span>截止:{task.dueAt ? new Date(task.dueAt).toLocaleString('zh-CN') : '-'}</span>
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

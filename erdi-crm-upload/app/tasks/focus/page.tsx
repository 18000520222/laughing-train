import { prisma } from '@/lib/prisma';
import { chat, isLLMAvailable } from '@/lib/llm';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requirePermission } from '@/lib/permissions';

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

const QUEUE_LABEL: Record<string, string> = {
  overdue: '逾期队列',
  today: '今日队列',
  week: '本周队列',
  escalated: 'SLA升级',
  unscheduled: '未排期',
  all: '全部待办',
};

const PRIORITY_WEIGHT: Record<string, number> = {
  URGENT: 4,
  HIGH: 3,
  NORMAL: 2,
  LOW: 1,
};

async function currentUser() {
  const session = await requirePermission('sales.manage');
  return { user: { id: session.userId, email: session.email, name: session.name }, role: session.role };
}

async function completeFocusTask(formData: FormData) {
  'use server';
  const { user, role } = await currentUser();
  const id = String(formData.get('id') || '');
  const nextUrl = String(formData.get('nextUrl') || '/tasks/focus');
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
      content: `沉浸式队列完成销售任务: ${task.title}`,
    },
  });
  redirect(nextUrl);
}

async function snoozeFocusTask(formData: FormData) {
  'use server';
  const { user, role } = await currentUser();
  const id = String(formData.get('id') || '');
  const days = Number(formData.get('days') || 1);
  const nextUrl = String(formData.get('nextUrl') || '/tasks/focus');
  if (!id) return;

  const task = await prisma.salesTask.findUnique({ where: { id } });
  if (!task) return;
  if (role === 'SALES' && task.ownerId !== user.id) return;

  const base = task.dueAt && task.dueAt > new Date() ? new Date(task.dueAt) : new Date();
  base.setDate(base.getDate() + (days === 3 ? 3 : 1));
  await prisma.salesTask.update({
    where: { id },
    data: { dueAt: base, reminderSentAt: null, escalatedAt: null },
  });
  redirect(nextUrl);
}

async function generateFocusDraft(formData: FormData) {
  'use server';
  const { user, role } = await currentUser();
  const id = String(formData.get('id') || '');
  const nextUrl = String(formData.get('nextUrl') || '/tasks/focus');
  if (!id) return;

  const task = await prisma.salesTask.findUnique({
    where: { id },
    include: {
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
          content: `Create a concise English follow-up email draft for this CRM sales task. Do not invent prices, delivery dates, certifications, or specs.

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
  contacts: task.company.contacts.map((contact) => ({ name: `${contact.firstName} ${contact.lastName || ''}`.trim(), email: contact.email, title: contact.title })),
  opportunities: task.company.opportunities.map((opportunity) => ({ title: opportunity.title, stage: opportunity.stage, amountUSD: opportunity.amountUSD, product: opportunity.product?.name })),
  recentMessages: task.company.inboxMessages.map((message) => ({ direction: message.direction, text: String(message.translatedText || message.originalText || '').slice(0, 500) })),
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
      console.error('Focus task draft generation failed:', err);
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
  redirect(nextUrl);
}

export default async function TaskFocusPage(props: any) {
  const { user, role } = await currentUser();
  const canSeeAll = role === 'SUPER_ADMIN' || role === 'ADMIN';
  const sp = props.searchParams || {};
  const queue = QUEUE_LABEL[String(sp.queue || '')] ? String(sp.queue) : 'overdue';
  const scope = canSeeAll ? String(sp.scope || 'mine') : 'mine';
  const priority = Object.keys(PRIORITY_LABEL).includes(String(sp.priority || '')) ? String(sp.priority) : '';
  const skipped = parseSkipped(sp.skip);

  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const weekEnd = new Date(now);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const baseWhere: any = { status: 'TODO' };
  if (!canSeeAll || scope === 'mine') baseWhere.ownerId = user.id;
  if (priority) baseWhere.priority = priority;
  if (queue === 'overdue') baseWhere.dueAt = { lt: now };
  if (queue === 'today') baseWhere.dueAt = { gte: now, lt: tomorrow };
  if (queue === 'week') baseWhere.dueAt = { gte: now, lt: weekEnd };
  if (queue === 'escalated') baseWhere.escalatedAt = { not: null };
  if (queue === 'unscheduled') baseWhere.dueAt = null;
  const totalWhere = { ...baseWhere };
  if (skipped.length > 0) baseWhere.id = { notIn: skipped };

  const queueParams = new URLSearchParams();
  queueParams.set('queue', queue);
  queueParams.set('scope', scope);
  if (priority) queueParams.set('priority', priority);
  const nextUrl = `/tasks/focus?${queueParams.toString()}`;

  const [tasks, totalCount, completedTodayCount, users] = await Promise.all([
    prisma.salesTask.findMany({
      where: baseWhere,
      orderBy: [{ dueAt: 'asc' }, { priority: 'desc' }, { createdAt: 'asc' }],
      take: 20,
      include: { owner: true, company: true, opportunity: true },
    }),
    prisma.salesTask.count({ where: totalWhere }),
    prisma.salesTask.count({
      where: {
        status: 'DONE',
        completedAt: { gte: startOfDay(now) },
        ...(!canSeeAll || scope === 'mine' ? { ownerId: user.id } : {}),
      },
    }),
    prisma.user.findMany({ where: { role: { in: ['SUPER_ADMIN', 'ADMIN', 'SALES'] as any }, isActive: true }, orderBy: [{ role: 'asc' }, { createdAt: 'asc' }] }),
  ]);

  const sortedTasks = [...tasks].sort((a, b) => taskUrgencyScore(b) - taskUrgencyScore(a));
  const current = sortedTasks[0] || null;
  const upcoming = sortedTasks.slice(1, 7);
  const skipUrl = current ? buildSkipUrl({ queue, scope, priority, skipped: [...skipped, current.id] }) : nextUrl;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <main className="mx-auto max-w-7xl px-4 py-6 md:px-8">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-5">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.2em] text-cyan-300">ERDI CRM Focus Queue</div>
            <h1 className="mt-2 text-3xl font-black tracking-tight">沉浸式任务队列</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-400">一屏只处理最该做的一条任务,完成、顺延、生成草稿后自动进入下一条。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/tasks" className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-black text-gray-200 hover:bg-white/10">返回任务中心</Link>
            <Link href="/sales-command" className="rounded-lg border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-sm font-black text-cyan-200 hover:bg-cyan-400/20">销售指挥台</Link>
          </div>
        </header>

        <section className="mb-5 flex flex-wrap gap-2">
          {Object.entries(QUEUE_LABEL).map(([value, label]) => (
            <FocusChip key={value} href={buildQueueUrl({ queue: value, scope, priority })} active={queue === value}>{label}</FocusChip>
          ))}
          {canSeeAll && (
            <>
              <div className="mx-1 h-9 w-px bg-white/10" />
              <FocusChip href={buildQueueUrl({ queue, scope: 'mine', priority })} active={scope === 'mine'}>只看我的</FocusChip>
              <FocusChip href={buildQueueUrl({ queue, scope: 'all', priority })} active={scope === 'all'}>全员</FocusChip>
            </>
          )}
          <div className="mx-1 h-9 w-px bg-white/10" />
          {Object.keys(PRIORITY_LABEL).map((value) => (
            <FocusChip key={value} href={buildQueueUrl({ queue, scope, priority: priority === value ? '' : value })} active={priority === value}>{PRIORITY_LABEL[value]}</FocusChip>
          ))}
        </section>

        <section className="mb-6 grid gap-3 md:grid-cols-4">
          <FocusMetric label="当前队列" value={QUEUE_LABEL[queue]} />
          <FocusMetric label="待处理" value={totalCount} />
          <FocusMetric label="今日已完成" value={completedTodayCount} />
          <FocusMetric label="已跳过" value={skipped.length} />
        </section>

        {current ? (
          <section className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
            <article className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 shadow-2xl">
              <div className="flex flex-wrap items-center gap-2">
                <TaskPriority priority={current.priority} />
                <span className="rounded-full border border-slate-500/30 bg-slate-500/10 px-3 py-1 text-xs font-black text-slate-200">{TYPE_LABEL[current.type] || current.type}</span>
                {current.dueAt && new Date(current.dueAt).getTime() < Date.now() && <span className="rounded-full border border-rose-400/30 bg-rose-400/10 px-3 py-1 text-xs font-black text-rose-200">已逾期</span>}
                {current.escalatedAt && <span className="rounded-full border border-fuchsia-400/30 bg-fuchsia-400/10 px-3 py-1 text-xs font-black text-fuchsia-200">SLA已升级</span>}
              </div>
              <h2 className="mt-5 text-3xl font-black leading-tight text-white">{current.title}</h2>
              <p className="mt-4 whitespace-pre-wrap text-base leading-relaxed text-gray-300">{current.description || '暂无说明。'}</p>

              <div className="mt-6 grid gap-3 md:grid-cols-2">
                <Info label="客户" value={current.company.name} href={`/customers/${current.companyId}`} />
                <Info label="负责人" value={current.owner.name || current.owner.email} />
                <Info label="截止时间" value={current.dueAt ? new Date(current.dueAt).toLocaleString('zh-CN') : '未排期'} />
                <Info label="商机" value={current.opportunity?.title || '-'} />
              </div>

              <div className="mt-6 flex flex-wrap gap-2">
                <form action={completeFocusTask}>
                  <input type="hidden" name="id" value={current.id} />
                  <input type="hidden" name="nextUrl" value={nextUrl} />
                  <button className="rounded-xl bg-emerald-500 px-5 py-3 text-sm font-black text-white hover:bg-emerald-400">完成并进入下一条</button>
                </form>
                <form action={generateFocusDraft}>
                  <input type="hidden" name="id" value={current.id} />
                  <input type="hidden" name="nextUrl" value={nextUrl} />
                  <button className="rounded-xl border border-blue-400/30 bg-blue-400/10 px-5 py-3 text-sm font-black text-blue-100 hover:bg-blue-400/20">生成邮件草稿</button>
                </form>
                <form action={snoozeFocusTask}>
                  <input type="hidden" name="id" value={current.id} />
                  <input type="hidden" name="days" value="1" />
                  <input type="hidden" name="nextUrl" value={nextUrl} />
                  <button className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-5 py-3 text-sm font-black text-amber-100 hover:bg-amber-400/20">顺延1天</button>
                </form>
                <form action={snoozeFocusTask}>
                  <input type="hidden" name="id" value={current.id} />
                  <input type="hidden" name="days" value="3" />
                  <input type="hidden" name="nextUrl" value={nextUrl} />
                  <button className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-5 py-3 text-sm font-black text-amber-100 hover:bg-amber-400/20">顺延3天</button>
                </form>
                <Link href={skipUrl} className="rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-black text-gray-200 hover:bg-white/10">跳过当前</Link>
              </div>

              {current.draftBody && (
                <div className="mt-6 rounded-2xl border border-blue-400/20 bg-blue-400/10 p-4">
                  <div className="mb-2 text-xs font-black text-blue-200">已有邮件草稿 {current.draftGeneratedAt ? `· ${new Date(current.draftGeneratedAt).toLocaleString('zh-CN')}` : ''}</div>
                  <div className="rounded-lg bg-white p-3 text-sm font-black text-gray-900">Subject: {current.draftSubject || '-'}</div>
                  <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-white p-3 text-sm leading-relaxed text-gray-700">{current.draftBody}</pre>
                </div>
              )}
            </article>

            <aside className="space-y-4">
              <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <h3 className="text-sm font-black text-white">后续队列</h3>
                <div className="mt-4 space-y-3">
                  {upcoming.map((task, index) => (
                    <Link key={task.id} href={`/customers/${task.companyId}`} className="block rounded-xl border border-white/10 bg-white/[0.03] p-3 hover:bg-white/[0.06]">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs font-black text-cyan-200">#{index + 2}</span>
                        <span className="text-xs font-bold text-gray-500">{task.dueAt ? new Date(task.dueAt).toLocaleString('zh-CN') : '未排期'}</span>
                      </div>
                      <div className="mt-2 line-clamp-2 text-sm font-black text-gray-100">{task.title}</div>
                      <div className="mt-1 truncate text-xs font-bold text-gray-500">{task.company.name}</div>
                    </Link>
                  ))}
                  {upcoming.length === 0 && <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-gray-500">这条之后队列为空。</div>}
                </div>
              </section>

              <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <h3 className="text-sm font-black text-white">负责人</h3>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {users.slice(0, 8).map((item) => (
                    <div key={item.id} className="rounded-xl bg-white/[0.04] px-3 py-2 text-xs font-bold text-gray-300">{item.name || item.email}</div>
                  ))}
                </div>
              </section>
            </aside>
          </section>
        ) : (
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-12 text-center">
            <h2 className="text-2xl font-black text-white">这个队列已经清空</h2>
            <p className="mt-3 text-sm text-gray-400">切换到其他队列,或者回任务中心创建新的跟进任务。</p>
            <div className="mt-6 flex justify-center gap-2">
              <Link href="/tasks" className="rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-black text-gray-200 hover:bg-white/10">返回任务中心</Link>
              <Link href={buildQueueUrl({ queue: 'all', scope, priority })} className="rounded-xl bg-cyan-500 px-5 py-3 text-sm font-black text-white hover:bg-cyan-400">查看全部待办</Link>
            </div>
          </section>
        )}
      </main>
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

function parseSkipped(raw: any) {
  return String(raw || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function buildQueueUrl(input: { queue: string; scope: string; priority?: string }) {
  const params = new URLSearchParams();
  params.set('queue', input.queue);
  params.set('scope', input.scope);
  if (input.priority) params.set('priority', input.priority);
  return `/tasks/focus?${params.toString()}`;
}

function buildSkipUrl(input: { queue: string; scope: string; priority?: string; skipped: string[] }) {
  const params = new URLSearchParams();
  params.set('queue', input.queue);
  params.set('scope', input.scope);
  if (input.priority) params.set('priority', input.priority);
  if (input.skipped.length > 0) params.set('skip', input.skipped.join(','));
  return `/tasks/focus?${params.toString()}`;
}

function taskUrgencyScore(task: any) {
  const now = Date.now();
  const due = task.dueAt ? new Date(task.dueAt).getTime() : null;
  const overdueScore = due && due < now ? 10000 : 0;
  const dueSoonScore = due ? Math.max(0, 5000 - Math.floor(Math.max(due - now, 0) / 3600000)) : 0;
  return overdueScore + dueSoonScore + (PRIORITY_WEIGHT[task.priority] || 0) * 100 + Math.max(0, 30 - Math.floor((now - new Date(task.createdAt).getTime()) / 86400000));
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function FocusChip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return <Link href={href} className={`rounded-lg px-3 py-2 text-xs font-black ${active ? 'bg-cyan-400 text-gray-950' : 'bg-white/5 text-gray-300 hover:bg-white/10'}`}>{children}</Link>;
}

function FocusMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="text-xs font-bold text-gray-500">{label}</div>
      <div className="mt-1 truncate text-2xl font-black text-white">{value}</div>
    </div>
  );
}

function Info({ label, value, href }: { label: string; value: string; href?: string }) {
  const content = <div className="mt-1 truncate text-sm font-black text-white">{value}</div>;
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="text-xs font-bold text-gray-500">{label}</div>
      {href ? <Link href={href} className="hover:text-cyan-200">{content}</Link> : content}
    </div>
  );
}

function TaskPriority({ priority }: { priority: string }) {
  const style: Record<string, string> = {
    URGENT: 'border-rose-400/30 bg-rose-400/10 text-rose-200',
    HIGH: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
    NORMAL: 'border-blue-400/30 bg-blue-400/10 text-blue-200',
    LOW: 'border-slate-400/30 bg-slate-400/10 text-slate-200',
  };
  return <span className={`rounded-full border px-3 py-1 text-xs font-black ${style[priority] || style.NORMAL}`}>{PRIORITY_LABEL[priority] || priority}</span>;
}

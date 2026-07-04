import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { InboxStatus, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import OmniboxClient from './OmniboxClient';

export const dynamic = 'force-dynamic';

export default async function OmniboxPage() {
  const role = cookies().get('auth_role')?.value;
  if (!role || !['SUPER_ADMIN', 'ADMIN', 'SALES'].includes(role)) {
    redirect('/dashboard?error=unauthorized');
  }

  const [messages, slaMessages, settings] = await Promise.all([
    prisma.inboxMessage.findMany({
      where: { direction: 'IN' },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { company: { select: { id: true, name: true, country: true, customerCode: true, owner: { select: { name: true, email: true } } } } },
    }),
    prisma.inboxMessage.findMany({
      where: { direction: 'IN' },
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: { company: { select: { id: true, name: true, country: true, customerCode: true, owner: { select: { name: true, email: true } } } } },
    }),
    prisma.systemSettings.findUnique({ where: { id: 'default' } }),
  ]);

  const counts = {
    all: messages.length,
    NEW: messages.filter((m) => m.status === 'NEW').length,
    AI_DRAFTED: messages.filter((m) => m.status === 'AI_DRAFTED').length,
    REPLIED: messages.filter((m) => m.status === 'REPLIED').length,
  };
  const sla = buildInboxSlaReport(slaMessages);

  return (
    <div className="min-h-screen bg-slate-50 p-8 font-sans">
      <header className="mb-6 flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 tracking-tight">全渠道自动化收件箱</h1>
          <p className="text-sm text-gray-500 mt-1">
            WhatsApp / 阿里国际站 / 亚马逊 / 虾皮 统一汇聚 · 自动翻译 · AI 回复草稿
          </p>
        </div>
        <div className="flex flex-wrap gap-3 items-center">
          <span className="text-xs text-gray-500">
            自动回复模式:
            <span className="ml-1 font-bold text-gray-700">
              {settings?.autoReplyMode === 'AUTO'
                ? '全自动发送'
                : settings?.autoReplyMode === 'OFF'
                ? '仅翻译'
                : 'AI草稿+人工确认'}
            </span>
          </span>
          <Link
            href="/settings"
            className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200"
          >
            ⚙️ 自动化设置
          </Link>
        </div>
      </header>

      <section className="mb-6 rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-bold text-gray-900">收件箱 SLA 指挥台</h2>
            <p className="mt-1 text-xs text-gray-500">按 SaleSmartly/HubSpot/Intercom/Zendesk 的会话治理思路,优先处理待回复、超时、未分配和高意向消息。</p>
          </div>
          <span className={`rounded-lg px-3 py-2 text-xs font-black ${sla.healthScore >= 80 ? 'bg-emerald-50 text-emerald-700' : sla.healthScore >= 55 ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'}`}>
            SLA 健康度 {sla.healthScore}
          </span>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <SlaMetric label="待回复" value={sla.pendingCount} detail="NEW + AI草稿" tone={sla.pendingCount > 0 ? 'amber' : 'emerald'} />
          <SlaMetric label="超24小时" value={sla.overdueCount} detail="需要立即处理" tone={sla.overdueCount > 0 ? 'rose' : 'emerald'} />
          <SlaMetric label="12小时预警" value={sla.dueSoonCount} detail="即将超时" tone={sla.dueSoonCount > 0 ? 'amber' : 'emerald'} />
          <SlaMetric label="AI草稿" value={sla.draftReadyCount} detail="可人工确认发送" tone={sla.draftReadyCount > 0 ? 'blue' : 'slate'} />
          <SlaMetric label="未分配" value={sla.unassignedCount} detail="没有负责人" tone={sla.unassignedCount > 0 ? 'rose' : 'emerald'} />
          <SlaMetric label="未关联客户" value={sla.unlinkedCount} detail="需要归档到客户" tone={sla.unlinkedCount > 0 ? 'amber' : 'emerald'} />
        </div>
        <div className="mt-4 rounded-xl bg-gray-50 px-4 py-3 text-xs font-bold text-gray-600">{sla.recommendation}</div>
        <div className="mt-4 grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="overflow-hidden rounded-xl border border-gray-100">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs font-black text-gray-500">
                <tr>
                  <th className="p-3">优先处理消息</th>
                  <th className="p-3">渠道</th>
                  <th className="p-3">等待</th>
                  <th className="p-3">建议动作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {sla.priorityRows.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="p-3">
                      <div className="font-black text-gray-900">{row.senderLabel}</div>
                      <div className="mt-0.5 text-[11px] font-bold text-gray-400">{row.companyLabel} · {row.intentLabel}</div>
                    </td>
                    <td className="p-3 font-bold text-gray-700">{row.channelLabel}</td>
                    <td className="p-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-black ${row.ageHours >= 24 ? 'bg-rose-50 text-rose-700' : row.ageHours >= 12 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                        {row.ageLabel}
                      </span>
                    </td>
                    <td className="p-3 text-xs font-bold text-gray-600">{row.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {sla.priorityRows.length === 0 && <div className="p-8 text-center text-sm font-bold text-gray-400">当前没有待回复消息。</div>}
          </div>
          <div className="rounded-xl border border-gray-100 p-4">
            <h3 className="text-xs font-black text-gray-500">渠道积压</h3>
            <div className="mt-3 space-y-3">
              {sla.channelRows.map((row) => (
                <SlaBar key={row.channel} label={row.channelLabel} value={row.pendingCount} max={sla.maxChannelPending} detail={`${row.overdueCount} 超时 · 平均等待 ${row.avgAgeLabel}`} />
              ))}
              {sla.channelRows.length === 0 && <div className="rounded-lg bg-gray-50 p-3 text-xs font-bold text-gray-400">暂无渠道积压。</div>}
            </div>
          </div>
        </div>
      </section>

      <OmniboxClient initialMessages={JSON.parse(JSON.stringify(messages))} counts={counts} />
    </div>
  );
}

const CHANNEL_LABEL: Record<string, string> = {
  EMAIL: '邮件',
  WHATSAPP: 'WhatsApp',
  ALIBABA: '阿里国际站',
  AMAZON: '亚马逊',
  SHOPEE: '虾皮',
  FACEBOOK: 'Facebook',
  LINKEDIN: 'LinkedIn',
};

const INTENT_LABEL: Record<string, string> = {
  PRICE_INQUIRY: '询价',
  PRODUCT_QUESTION: '产品咨询',
  ORDER_STATUS: '订单状态',
  SAMPLE_REQUEST: '索样',
  COMPLAINT: '投诉',
  GREETING: '寒暄',
  SPAM: '垃圾',
  OTHER: '其他',
};

type OmniboxSlaMessage = Prisma.InboxMessageGetPayload<{
  include: { company: { select: { id: true; name: true; country: true; customerCode: true; owner: { select: { name: true; email: true } } } } };
}>;

type SlaTone = 'blue' | 'emerald' | 'amber' | 'rose' | 'slate';

const PENDING_STATUSES = new Set<InboxStatus>(['NEW', 'AI_DRAFTED']);
const HIGH_INTENTS = new Set(['PRICE_INQUIRY', 'PRODUCT_QUESTION', 'SAMPLE_REQUEST', 'ORDER_STATUS', 'COMPLAINT']);

function buildInboxSlaReport(messages: OmniboxSlaMessage[]) {
  const rows = messages.map(inboxSlaRow);
  const pendingRows = rows.filter((row) => row.pending);
  const pendingCount = pendingRows.length;
  const overdueCount = pendingRows.filter((row) => row.ageHours >= 24).length;
  const dueSoonCount = pendingRows.filter((row) => row.ageHours >= 12 && row.ageHours < 24).length;
  const draftReadyCount = pendingRows.filter((row) => row.status === 'AI_DRAFTED' && row.hasDraft).length;
  const unassignedCount = pendingRows.filter((row) => !row.hasOwner).length;
  const unlinkedCount = pendingRows.filter((row) => !row.hasCompany).length;
  const highIntentPending = pendingRows.filter((row) => row.highIntent).length;
  const healthPenalty = overdueCount * 10 + dueSoonCount * 5 + unassignedCount * 5 + unlinkedCount * 3 + Math.max(0, pendingCount - 20);
  const healthScore = Math.max(0, Math.min(100, Math.round(100 - healthPenalty)));

  const priorityRows = pendingRows
    .sort((a, b) => b.priorityWeight - a.priorityWeight || b.ageHours - a.ageHours)
    .slice(0, 8);

  const channelMap = new Map<string, { channel: string; channelLabel: string; pendingCount: number; overdueCount: number; totalAgeHours: number }>();
  for (const row of pendingRows) {
    const current = channelMap.get(row.channel) || { channel: row.channel, channelLabel: row.channelLabel, pendingCount: 0, overdueCount: 0, totalAgeHours: 0 };
    current.pendingCount += 1;
    current.overdueCount += row.ageHours >= 24 ? 1 : 0;
    current.totalAgeHours += row.ageHours;
    channelMap.set(row.channel, current);
  }
  const channelRows = Array.from(channelMap.values())
    .map((row) => ({
      ...row,
      avgAgeLabel: formatAgeHours(row.pendingCount ? row.totalAgeHours / row.pendingCount : 0),
    }))
    .sort((a, b) => b.overdueCount - a.overdueCount || b.pendingCount - a.pendingCount || b.totalAgeHours - a.totalAgeHours);

  return {
    pendingCount,
    overdueCount,
    dueSoonCount,
    draftReadyCount,
    unassignedCount,
    unlinkedCount,
    highIntentPending,
    healthScore,
    priorityRows,
    channelRows,
    maxChannelPending: Math.max(1, ...channelRows.map((row) => row.pendingCount)),
    recommendation: inboxSlaRecommendation({ pendingCount, overdueCount, dueSoonCount, draftReadyCount, unassignedCount, unlinkedCount, highIntentPending }),
  };
}

function inboxSlaRow(message: OmniboxSlaMessage) {
  const pending = PENDING_STATUSES.has(message.status);
  const ageHours = hoursSince(message.sentAt || message.createdAt);
  const hasCompany = Boolean(message.companyId || message.company);
  const hasOwner = Boolean(message.company?.owner);
  const hasDraft = Boolean(message.aiReplyZh);
  const highIntent = HIGH_INTENTS.has(String(message.intent || ''));
  const priorityWeight =
    (ageHours >= 24 ? 40 : ageHours >= 12 ? 24 : 0) +
    (highIntent ? 20 : 0) +
    (message.status === 'AI_DRAFTED' && hasDraft ? 12 : 0) +
    (!hasOwner ? 10 : 0) +
    (!hasCompany ? 8 : 0) +
    (String(message.channel) === 'ALIBABA' || String(message.channel) === 'WHATSAPP' ? 6 : 0);

  return {
    id: message.id,
    status: String(message.status),
    pending,
    channel: String(message.channel),
    channelLabel: CHANNEL_LABEL[message.channel] || String(message.channel),
    senderLabel: message.senderName || message.senderId || '未知客户',
    companyLabel: message.company ? `${message.company.customerCode ? `${message.company.customerCode} · ` : ''}${message.company.name}` : '未关联客户',
    intentLabel: INTENT_LABEL[message.intent || ''] || message.intent || '未识别意图',
    ageHours,
    ageLabel: formatAgeHours(ageHours),
    hasCompany,
    hasOwner,
    hasDraft,
    highIntent,
    priorityWeight,
    action: inboxSlaAction({ ageHours, highIntent, hasDraft, hasOwner, hasCompany, status: String(message.status) }),
  };
}

function inboxSlaAction(input: { ageHours: number; highIntent: boolean; hasDraft: boolean; hasOwner: boolean; hasCompany: boolean; status: string }) {
  if (!input.hasCompany) return '先关联或新建客户,再回复并沉淀画像。';
  if (!input.hasOwner) return '先分配负责人,避免客户消息无人闭环。';
  if (input.ageHours >= 24) return '已超过 24 小时,立即确认草稿或手动回复。';
  if (input.highIntent && input.hasDraft) return '高意向且已有 AI 草稿,优先人工确认发送。';
  if (input.highIntent) return '高意向消息,优先起草报价/资料回复。';
  if (input.status === 'AI_DRAFTED') return '检查 AI 草稿,确认后发送。';
  return '补充中文回复,并更新客户下一步动作。';
}

function inboxSlaRecommendation(input: { pendingCount: number; overdueCount: number; dueSoonCount: number; draftReadyCount: number; unassignedCount: number; unlinkedCount: number; highIntentPending: number }) {
  if (input.pendingCount === 0) return '当前没有待回复消息。保持渠道同步,继续关注新询盘进入。';
  if (input.overdueCount > 0) return `有 ${input.overdueCount} 条待回复消息超过 24 小时。先处理超时消息,再看高意向和草稿队列。`;
  if (input.unassignedCount > 0) return `有 ${input.unassignedCount} 条待回复消息没有负责人。先分配责任人,否则 SLA 无法闭环。`;
  if (input.unlinkedCount > 0) return `有 ${input.unlinkedCount} 条消息未关联客户。先建客户/归并客户,后续画像和商机才不会断链。`;
  if (input.highIntentPending > 0) return `有 ${input.highIntentPending} 条高意向消息待处理。优先回复询价、索样、订单状态和投诉。`;
  if (input.draftReadyCount > 0) return `有 ${input.draftReadyCount} 条 AI 草稿可确认。先人工审核发送,缩短响应时间。`;
  if (input.dueSoonCount > 0) return `有 ${input.dueSoonCount} 条消息将在 24 小时内超时。先清掉预警队列。`;
  return `当前有 ${input.pendingCount} 条待回复消息。按优先处理队列逐条回复即可。`;
}

function SlaMetric({ label, value, detail, tone }: { label: string; value: number | string; detail: string; tone: SlaTone }) {
  const color: Record<SlaTone, string> = {
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

function SlaBar({ label, value, max, detail }: { label: string; value: number; max: number; detail: string }) {
  const width = Math.max(3, Math.round((value / Math.max(1, max)) * 100));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3">
        <div className="truncate text-xs font-black text-gray-700">{label}</div>
        <div className="text-xs font-bold text-gray-400">{value}</div>
      </div>
      <div className="h-2 rounded-full bg-gray-100">
        <div className="h-2 rounded-full bg-blue-500" style={{ width: `${width}%` }} />
      </div>
      <div className="mt-1 text-[11px] font-bold text-gray-400">{detail}</div>
    </div>
  );
}

function hoursSince(value: Date | string | null | undefined) {
  if (!value) return 999;
  return Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 3600000));
}

function formatAgeHours(hours: number) {
  if (hours < 1) return '<1小时';
  if (hours < 24) return `${Math.round(hours)}小时`;
  return `${Math.round(hours / 24)}天`;
}

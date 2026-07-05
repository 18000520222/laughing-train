import { emailCategoryLabel, type EmailCategory } from '@/lib/email-classifier';

export type GmailLabelPlan = {
  key: string;
  labelName: string;
  category: EmailCategory;
  gmailQuery: string;
  crmAction: string;
  slaHours: number | null;
  description: string;
  tone: 'rose' | 'blue' | 'emerald' | 'amber' | 'slate';
};

export type GmailLabelPlanStats = {
  category: string;
  count: number;
  actionRequired: number;
  leads: number;
  lowConfidence: number;
  oldestDate: Date | null;
  latestDate: Date | null;
};

export type GmailLabelPlanCategoryGroup = {
  category: string;
  actionRequired: boolean;
  isLead: boolean;
  _count: { _all: number };
  _min: { date: Date | null };
  _max: { date: Date | null };
};

export type GmailLabelPlanLowConfidenceGroup = {
  category: string;
  _count: { _all: number };
};

export type GmailLabelPlanAuditRow = GmailLabelPlan & {
  categoryLabel: string;
  messageCount: number;
  actionRequiredCount: number;
  leadCount: number;
  lowConfidenceCount: number;
  latestAt: Date | null;
  oldestAt: Date | null;
  latestAtLabel: string;
  oldestAtLabel: string;
  executionMode: 'task' | 'review' | 'archive' | 'watch';
  executionHint: string;
  priorityScore: number;
};

export const GMAIL_LABEL_PLANS: GmailLabelPlan[] = [
  {
    key: 'inquiry',
    labelName: 'CRM/01-客户询盘',
    category: 'INQUIRY',
    gmailQuery: '(inquiry OR RFQ OR requirement OR rangefinder OR laser OR datasheet OR sample) -unsubscribe',
    crmAction: '转客户和销售任务',
    slaHours: 24,
    description: '新询盘、规格咨询、样品和产品资料请求。',
    tone: 'rose',
  },
  {
    key: 'quote',
    labelName: 'CRM/02-报价PI',
    category: 'QUOTE_PI',
    gmailQuery: '(quote OR quotation OR price OR proforma invoice OR PI OR commercial offer)',
    crmAction: '转报价/PI任务',
    slaHours: 12,
    description: '报价、价格、PI 和商业条款邮件。',
    tone: 'rose',
  },
  {
    key: 'order',
    labelName: 'CRM/03-订单PO',
    category: 'ORDER_PO',
    gmailQuery: '("purchase order" OR "new order" OR PO OR "official order")',
    crmAction: '转订单任务',
    slaHours: 12,
    description: 'PO、正式订单和订单确认。',
    tone: 'rose',
  },
  {
    key: 'finance',
    labelName: 'CRM/04-付款财务',
    category: 'PAYMENT_FINANCE',
    gmailQuery: '(payment OR paid OR receipt OR billing OR commission OR invoice)',
    crmAction: '转财务跟进任务',
    slaHours: 24,
    description: '付款、收据、账单、佣金和财务往来。',
    tone: 'blue',
  },
  {
    key: 'logistics',
    labelName: 'CRM/05-物流交付',
    category: 'LOGISTICS',
    gmailQuery: '(DHL OR FedEx OR UPS OR shipment OR tracking OR delivery OR AWB OR pickup)',
    crmAction: '转物流跟进任务',
    slaHours: 24,
    description: '发货、运单、派送、取件和物流异常。',
    tone: 'blue',
  },
  {
    key: 'support',
    labelName: 'CRM/06-技术售后',
    category: 'TECH_SUPPORT',
    gmailQuery: '(problem OR issue OR troubleshooting OR SDK OR UART OR protocol OR warranty OR repair)',
    crmAction: '转技术/售后任务',
    slaHours: 24,
    description: '技术问题、售后、协议、SDK、维修和质保。',
    tone: 'amber',
  },
  {
    key: 'compliance',
    labelName: 'CRM/07-海关合规',
    category: 'CUSTOMS_COMPLIANCE',
    gmailQuery: '("HS code" OR customs OR clearance OR "certificate of origin" OR MSDS OR "export license")',
    crmAction: '转合规/清关任务',
    slaHours: 24,
    description: '清关、报关、HS Code、原产地证和出口合规。',
    tone: 'amber',
  },
  {
    key: 'security',
    labelName: 'CRM/08-授权安全运维',
    category: 'AUTH_SECURITY',
    gmailQuery: '("verification code" OR "security code" OR "verify your" OR login OR "authorization expired" OR "domain configuration" OR "misconfigured domains" OR 授权)',
    crmAction: '转验证码/账号安全任务',
    slaHours: 2,
    description: '平台验证码、登录确认、授权失效、域名配置和账号安全提醒。',
    tone: 'amber',
  },
  {
    key: 'platform',
    labelName: 'CRM/09-平台通知运维',
    category: 'PLATFORM_ALERT',
    gmailQuery: '(vercel OR supabase OR cloudflare OR google workspace OR shopline OR whatsapp business OR slack OR github OR onedrive)',
    crmAction: '转运维复核',
    slaHours: 24,
    description: '平台系统通知、域名、云服务、渠道平台和站点运行提醒。',
    tone: 'amber',
  },
  {
    key: 'noise',
    labelName: 'CRM/90-营销订阅低优先',
    category: 'MARKETING_NEWSLETTER',
    gmailQuery: '(unsubscribe OR newsletter OR webinar OR "guest post" OR backlink OR "SEO service")',
    crmAction: '清理待动作标记',
    slaHours: null,
    description: '营销、SEO、新闻简报和低价值通知。',
    tone: 'slate',
  },
];

export function buildGmailLabelReadiness(input: { activeAccountCount: number; totalMessages: number }) {
  if (input.activeAccountCount === 0) {
    return {
      status: 'blocked' as const,
      title: 'Gmail/IMAP 未接入',
      detail: 'CRM 当前没有启用邮箱账号。先完成 Gmail 授权或 IMAP 应用专用密码,再让邮件自动进入 CRM。',
    };
  }
  if (input.totalMessages === 0) {
    return {
      status: 'empty' as const,
      title: '邮箱已配置但未沉淀邮件',
      detail: '已存在启用邮箱账号,但 CRM 邮件表为空。建议手动触发 mail-pull 并检查 Gmail 授权/IMAP 权限。',
    };
  }
  return {
    status: 'ready' as const,
    title: 'Gmail 分类闭环可运行',
    detail: 'CRM 已有邮件数据,可以按标签计划持续重跑分类、转任务和清理噪音。',
  };
}

export function labelPlanWithLabels() {
  return GMAIL_LABEL_PLANS.map((plan) => ({
    ...plan,
    categoryLabel: emailCategoryLabel(plan.category),
  }));
}

export function buildGmailLabelPlanAudit(input: { stats: GmailLabelPlanStats[] }): GmailLabelPlanAuditRow[] {
  const byCategory = new Map(input.stats.map((row) => [row.category, row]));
  return labelPlanWithLabels()
    .map((plan) => {
      const stats = byCategory.get(plan.category) || emptyStats(plan.category);
      const executionMode = labelExecutionMode(plan.category, stats);
      return {
        ...plan,
        messageCount: stats.count,
        actionRequiredCount: stats.actionRequired,
        leadCount: stats.leads,
        lowConfidenceCount: stats.lowConfidence,
        latestAt: stats.latestDate,
        oldestAt: stats.oldestDate,
        latestAtLabel: formatDate(stats.latestDate),
        oldestAtLabel: formatDate(stats.oldestDate),
        executionMode,
        executionHint: labelExecutionHint(plan, stats, executionMode),
        priorityScore: labelPriorityScore(plan, stats),
      };
    })
    .sort((a, b) => b.priorityScore - a.priorityScore || b.actionRequiredCount - a.actionRequiredCount || b.messageCount - a.messageCount || a.key.localeCompare(b.key));
}

export function buildGmailLabelPlanStats(
  rows: GmailLabelPlanCategoryGroup[],
  lowConfidenceRows: GmailLabelPlanLowConfidenceGroup[]
): GmailLabelPlanStats[] {
  const lowConfidenceByCategory = new Map(lowConfidenceRows.map((row) => [row.category, row._count._all]));
  const byCategory = new Map<string, GmailLabelPlanStats>();
  for (const row of rows) {
    const current = byCategory.get(row.category) || {
      category: row.category,
      count: 0,
      actionRequired: 0,
      leads: 0,
      lowConfidence: lowConfidenceByCategory.get(row.category) || 0,
      oldestDate: null,
      latestDate: null,
    };
    current.count += row._count._all;
    if (row.actionRequired) current.actionRequired += row._count._all;
    if (row.isLead) current.leads += row._count._all;
    current.oldestDate = minDate(current.oldestDate, row._min.date);
    current.latestDate = maxDate(current.latestDate, row._max.date);
    byCategory.set(row.category, current);
  }
  return Array.from(byCategory.values());
}

function emptyStats(category: string): GmailLabelPlanStats {
  return { category, count: 0, actionRequired: 0, leads: 0, lowConfidence: 0, oldestDate: null, latestDate: null };
}

function labelExecutionMode(category: EmailCategory, stats: GmailLabelPlanStats): GmailLabelPlanAuditRow['executionMode'] {
  if (category === 'MARKETING_NEWSLETTER') return 'archive';
  if (stats.lowConfidence > 0 || category === 'PLATFORM_ALERT') return 'review';
  if (stats.actionRequired > 0) return 'task';
  return 'watch';
}

function labelExecutionHint(plan: GmailLabelPlan, stats: GmailLabelPlanStats, mode: GmailLabelPlanAuditRow['executionMode']) {
  if (stats.count === 0) return '暂无 CRM 样本;Gmail 授权恢复后先打标签观察。';
  if (mode === 'archive') return `${stats.count} 封低优先邮件可打标签后归档,减少收件箱噪音。`;
  if (mode === 'task') return `${stats.actionRequired} 封需要动作,按 ${plan.crmAction} 进入 CRM 闭环。`;
  if (mode === 'review') return `${stats.count} 封先复核真实性和误判,再决定是否转任务或归档。`;
  return `${stats.count} 封持续观察,暂不需要批量动作。`;
}

function labelPriorityScore(plan: GmailLabelPlan, stats: GmailLabelPlanStats) {
  const slaBoost = plan.slaHours ? Math.max(0, 24 - Math.min(24, plan.slaHours)) : 0;
  const actionBoost = stats.actionRequired * 4;
  const leadBoost = stats.leads * 3;
  const reviewBoost = stats.lowConfidence * 2;
  const volumeBoost = Math.min(20, stats.count);
  return slaBoost + actionBoost + leadBoost + reviewBoost + volumeBoost;
}

function formatDate(value: Date | null) {
  if (!value) return '-';
  return value.toLocaleDateString('zh-CN');
}

function minDate(a: Date | null, b: Date | null) {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

function maxDate(a: Date | null, b: Date | null) {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

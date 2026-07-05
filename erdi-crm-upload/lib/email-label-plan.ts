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

export const GMAIL_LABEL_PLANS: GmailLabelPlan[] = [
  {
    key: 'inquiry',
    labelName: 'ERDI/01-Inquiry',
    category: 'INQUIRY',
    gmailQuery: '(inquiry OR RFQ OR requirement OR rangefinder OR laser OR datasheet OR sample) -unsubscribe',
    crmAction: '转客户和销售任务',
    slaHours: 24,
    description: '新询盘、规格咨询、样品和产品资料请求。',
    tone: 'rose',
  },
  {
    key: 'quote',
    labelName: 'ERDI/02-Quote-PI',
    category: 'QUOTE_PI',
    gmailQuery: '(quote OR quotation OR price OR proforma invoice OR PI OR commercial offer)',
    crmAction: '转报价/PI任务',
    slaHours: 12,
    description: '报价、价格、PI 和商业条款邮件。',
    tone: 'rose',
  },
  {
    key: 'order',
    labelName: 'ERDI/03-Order-PO',
    category: 'ORDER_PO',
    gmailQuery: '("purchase order" OR "new order" OR PO OR "official order")',
    crmAction: '转订单任务',
    slaHours: 12,
    description: 'PO、正式订单和订单确认。',
    tone: 'rose',
  },
  {
    key: 'finance',
    labelName: 'ERDI/04-Payment-Finance',
    category: 'PAYMENT_FINANCE',
    gmailQuery: '(payment OR paid OR receipt OR billing OR commission OR invoice)',
    crmAction: '转财务跟进任务',
    slaHours: 24,
    description: '付款、收据、账单、佣金和财务往来。',
    tone: 'blue',
  },
  {
    key: 'logistics',
    labelName: 'ERDI/05-Logistics',
    category: 'LOGISTICS',
    gmailQuery: '(DHL OR FedEx OR UPS OR shipment OR tracking OR delivery OR AWB OR pickup)',
    crmAction: '转物流跟进任务',
    slaHours: 24,
    description: '发货、运单、派送、取件和物流异常。',
    tone: 'blue',
  },
  {
    key: 'support',
    labelName: 'ERDI/06-Tech-Support',
    category: 'TECH_SUPPORT',
    gmailQuery: '(problem OR issue OR troubleshooting OR SDK OR UART OR protocol OR warranty OR repair)',
    crmAction: '转技术/售后任务',
    slaHours: 24,
    description: '技术问题、售后、协议、SDK、维修和质保。',
    tone: 'amber',
  },
  {
    key: 'compliance',
    labelName: 'ERDI/07-Customs-Compliance',
    category: 'CUSTOMS_COMPLIANCE',
    gmailQuery: '("HS code" OR customs OR clearance OR "certificate of origin" OR MSDS OR "export license")',
    crmAction: '转合规/清关任务',
    slaHours: 24,
    description: '清关、报关、HS Code、原产地证和出口合规。',
    tone: 'amber',
  },
  {
    key: 'security',
    labelName: 'ERDI/08-Auth-Security',
    category: 'AUTH_SECURITY',
    gmailQuery: '("verification code" OR "security code" OR "verify your" OR login)',
    crmAction: '转验证码/账号安全任务',
    slaHours: 2,
    description: '平台验证码、登录确认和账号安全提醒。',
    tone: 'amber',
  },
  {
    key: 'noise',
    labelName: 'ERDI/90-Noise',
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

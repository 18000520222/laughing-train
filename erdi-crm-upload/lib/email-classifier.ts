export type EmailCategory =
  | 'INQUIRY'
  | 'QUOTE_PI'
  | 'ORDER_PO'
  | 'PAYMENT_FINANCE'
  | 'LOGISTICS'
  | 'TECH_SUPPORT'
  | 'PLATFORM_ALERT'
  | 'AUTH_SECURITY'
  | 'MARKETING_NEWSLETTER'
  | 'SEO_SPAM'
  | 'INTERNAL'
  | 'OTHER';

export interface EmailClassification {
  category: EmailCategory;
  categoryReason: string;
  classificationScore: number;
  actionRequired: boolean;
  isLead: boolean;
  classificationTags: string[];
}

const OWN_DOMAINS = ['erdicn.com', 'erdimail.com', 'erditechs.com', 'erdicrm.com'];
const FREE_MAIL = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'qq.com', '163.com', '126.com', 'mail.ru'];

const CATEGORY_RULES: Array<{
  category: EmailCategory;
  tags: string[];
  actionRequired: boolean;
  isLead: boolean;
  score: number;
  keywords: string[];
}> = [
  {
    category: 'ORDER_PO',
    tags: ['订单', 'PO'],
    actionRequired: true,
    isLead: true,
    score: 95,
    keywords: ['purchase order', 'new order', ' po', 'po260', 'order confirmation', '订单', '采购订单'],
  },
  {
    category: 'QUOTE_PI',
    tags: ['报价', 'PI'],
    actionRequired: true,
    isLead: true,
    score: 90,
    keywords: ['quotation', 'quote', '报价', 'pi ', 'proforma invoice', 'invoice request', '价格', 'price'],
  },
  {
    category: 'INQUIRY',
    tags: ['询盘', '客户需求'],
    actionRequired: true,
    isLead: true,
    score: 88,
    keywords: ['inquiry', 'requirement', 'request for', 'rfq', 'laser rangefinder', 'lrf', 'rangefinder', 'module', 'target designator', '测距', '询盘'],
  },
  {
    category: 'TECH_SUPPORT',
    tags: ['技术售后'],
    actionRequired: true,
    isLead: true,
    score: 82,
    keywords: ['problem', 'issue', 'troubleshooting', 'sdk', 'uart', 'protocol', 'screw', 'orientation', 'support', '故障', '问题'],
  },
  {
    category: 'PAYMENT_FINANCE',
    tags: ['付款财务'],
    actionRequired: true,
    isLead: false,
    score: 76,
    keywords: ['payment', 'paid', 'receipt', 'bill', 'billing', 'commission', '付款', '账单', '收据', '入账', 'invoice'],
  },
  {
    category: 'LOGISTICS',
    tags: ['物流'],
    actionRequired: true,
    isLead: false,
    score: 72,
    keywords: ['dhl', 'shipment', 'pickup', 'tracking', 'logistics', 'delivery', 'express', '取件', '发件', '运单'],
  },
  {
    category: 'AUTH_SECURITY',
    tags: ['安全验证码'],
    actionRequired: true,
    isLead: false,
    score: 65,
    keywords: ['security code', 'verification code', 'verify your', 'login', '安全码', '验证码', '重要安全提醒'],
  },
  {
    category: 'PLATFORM_ALERT',
    tags: ['平台通知'],
    actionRequired: false,
    isLead: false,
    score: 45,
    keywords: ['vercel', 'google workspace', 'google payments', 'shopline', 'amazon accelerate', 'whatsapp business', 'slack', 'onedrive', 'pingpong'],
  },
  {
    category: 'SEO_SPAM',
    tags: ['SEO垃圾'],
    actionRequired: false,
    isLead: false,
    score: 10,
    keywords: ['seo', 'backlink', 'guest post', 'domain authority', 'high da', 'dofollow', 'traffic', 'rank higher'],
  },
  {
    category: 'MARKETING_NEWSLETTER',
    tags: ['营销新闻'],
    actionRequired: false,
    isLead: false,
    score: 20,
    keywords: ['newsletter', 'webinar', 'daily digest', 'register now', 'trial', 'unsubscribe', 'promotion', 'points'],
  },
];

export function classifyEmail(input: { from?: string | null; subject?: string | null; textBody?: string | null; htmlBody?: string | null }): EmailClassification {
  const from = String(input.from || '').toLowerCase();
  const subject = String(input.subject || '');
  const body = String(input.textBody || input.htmlBody || '');
  const text = `${from}\n${subject}\n${body}`.toLowerCase();
  const domain = extractDomain(from);

  if (domain && OWN_DOMAINS.some((d) => domain === d || domain.endsWith('.' + d))) {
    return result('INTERNAL', 'sender-own-domain', 35, false, false, ['内部邮件']);
  }

  for (const rule of CATEGORY_RULES) {
    const hit = rule.keywords.find((k) => text.includes(k.toLowerCase()));
    if (hit) {
      return result(rule.category, `keyword:${hit}`, boostScore(rule.score, domain, rule.isLead), rule.actionRequired, rule.isLead, rule.tags);
    }
  }

  if (from.includes('noreply') || from.includes('no-reply') || from.includes('notification')) {
    return result('PLATFORM_ALERT', 'sender-notification', 35, false, false, ['平台通知']);
  }

  if (domain && FREE_MAIL.includes(domain) && hasProductSignal(text)) {
    return result('INQUIRY', 'free-mail-with-product-signal', 78, true, true, ['询盘', '个人邮箱']);
  }

  if (hasProductSignal(text)) {
    return result('INQUIRY', 'product-signal', 74, true, true, ['询盘']);
  }

  return result('OTHER', 'fallback', 30, false, false, ['其他']);
}

export function emailCategoryLabel(category: string) {
  const labels: Record<string, string> = {
    INQUIRY: '外贸询盘',
    QUOTE_PI: '报价/PI',
    ORDER_PO: '订单/PO',
    PAYMENT_FINANCE: '付款财务',
    LOGISTICS: '物流',
    TECH_SUPPORT: '技术售后',
    PLATFORM_ALERT: '平台通知',
    AUTH_SECURITY: '安全验证码',
    MARKETING_NEWSLETTER: '营销新闻',
    SEO_SPAM: 'SEO垃圾',
    INTERNAL: '内部邮件',
    OTHER: '其他',
    UNCLASSIFIED: '未分类',
  };
  return labels[category] || category;
}

function result(category: EmailCategory, reason: string, score: number, actionRequired: boolean, isLead: boolean, tags: string[]): EmailClassification {
  return {
    category,
    categoryReason: reason,
    classificationScore: Math.max(0, Math.min(100, score)),
    actionRequired,
    isLead,
    classificationTags: tags,
  };
}

function boostScore(score: number, domain: string | null, isLead: boolean) {
  if (!isLead) return score;
  if (domain && !FREE_MAIL.includes(domain)) return Math.min(100, score + 5);
  return score;
}

function extractDomain(from: string) {
  const match = from.match(/[a-z0-9._%+-]+@([a-z0-9.-]+\.[a-z]{2,})/i);
  return match?.[1]?.toLowerCase() || null;
}

function hasProductSignal(text: string) {
  return ['lrf', 'laser', 'rangefinder', '1535nm', '905nm', '1064nm', 'erbium', '测距', '激光'].some((k) => text.includes(k));
}

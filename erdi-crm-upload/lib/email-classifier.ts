import { stripQuotedHistory } from '@/lib/email-content';

export type EmailCategory =
  | 'INQUIRY'
  | 'QUOTE_PI'
  | 'ORDER_PO'
  | 'PAYMENT_FINANCE'
  | 'LOGISTICS'
  | 'TECH_SUPPORT'
  | 'CUSTOMS_COMPLIANCE'
  | 'MEETING_FOLLOWUP'
  | 'SUPPLIER_PURCHASE'
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
const SYSTEM_SERVICE_DOMAINS = [
  'vercel.com',
  'github.com',
  'supabase.com',
  'cloudflare.com',
  'slack.com',
  'dhl.com',
  'fedex.com',
  'ups.com',
];

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
    keywords: ['purchase order', 'new order', 'po260', 'order confirmation', '订单', '采购订单', 'place an order', 'official order'],
  },
  {
    category: 'QUOTE_PI',
    tags: ['报价', 'PI'],
    actionRequired: true,
    isLead: true,
    score: 90,
    keywords: ['quotation', 'quote', '报价', 'proforma invoice', 'invoice request', '价格', 'price', 'best price', 'price list', 'commercial offer'],
  },
  {
    category: 'INQUIRY',
    tags: ['询盘', '客户需求'],
    actionRequired: true,
    isLead: true,
    score: 88,
    keywords: ['inquiry', 'requirement', 'request for', 'rfq', 'laser rangefinder', 'lrf', 'rangefinder', 'module', 'target designator', 'datasheet', 'specification', '测距', '询盘', '样品', 'sample'],
  },
  {
    category: 'TECH_SUPPORT',
    tags: ['技术售后'],
    actionRequired: true,
    isLead: true,
    score: 82,
    keywords: ['problem', 'issue', 'troubleshooting', 'sdk', 'uart', 'protocol', 'screw', 'orientation', 'support', 'warranty', 'repair', '故障', '问题', '售后'],
  },
  {
    category: 'CUSTOMS_COMPLIANCE',
    tags: ['海关合规'],
    actionRequired: true,
    isLead: false,
    score: 80,
    keywords: ['customs', 'clearance', 'hs code', 'tariff code', 'certificate of origin', 'msds', 'export license', 'import permit', 'declaration', '海关', '清关', '报关', '原产地证'],
  },
  {
    category: 'PAYMENT_FINANCE',
    tags: ['付款财务'],
    actionRequired: true,
    isLead: false,
    score: 86,
    keywords: ['payment', 'down payment', 'refund', 'paid', 'receipt', 'bill', 'billing', 'commission', 'bank transfer', 'remittance', '付款', '退款', '账单', '收据', '入账', 'invoice'],
  },
  {
    category: 'LOGISTICS',
    tags: ['物流'],
    actionRequired: true,
    isLead: false,
    score: 72,
    keywords: ['dhl', 'fedex', 'ups', 'shipment', 'pickup', 'tracking', 'logistics', 'delivery', 'express', 'air waybill', 'awb', '取件', '发件', '运单'],
  },
  {
    category: 'MEETING_FOLLOWUP',
    tags: ['会议跟进'],
    actionRequired: true,
    isLead: true,
    score: 70,
    keywords: ['meeting', 'call schedule', 'schedule a call', 'appointment', 'zoom', 'teams meeting', 'calendar invite', '会议', '约时间', '电话沟通'],
  },
  {
    category: 'SUPPLIER_PURCHASE',
    tags: ['供应采购'],
    actionRequired: true,
    isLead: false,
    score: 68,
    keywords: ['supplier quotation', 'vendor quote', 'factory price', 'component', 'raw material', '采购报价', '供应商', '物料', '元器件'],
  },
  {
    category: 'AUTH_SECURITY',
    tags: ['安全验证码'],
    actionRequired: true,
    isLead: false,
    score: 65,
    keywords: [
      'security code',
      'verification code',
      'verify your',
      'login',
      'misconfigured domains',
      'domains need configuration',
      'domain configuration',
      'authorization expired',
      'authorization has expired',
      'token expired',
      '授权已经失效',
      '授权失效',
      '更新有效时间',
      '安全码',
      '验证码',
      '重要安全提醒',
    ],
  },
  {
    category: 'PLATFORM_ALERT',
    tags: ['平台通知'],
    actionRequired: false,
    isLead: false,
    score: 45,
    keywords: ['vercel', 'google workspace', 'google payments', 'shopline', 'amazon accelerate', 'whatsapp business', 'slack', 'onedrive', 'pingpong', 'github', 'supabase', 'cloudflare'],
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
  const body = stripQuotedHistory(String(input.textBody || input.htmlBody || ''));
  const text = `${from}\n${subject}\n${body}`.toLowerCase().replace(/\s+/g, ' ');
  const domain = extractDomain(from);

  if (domain && OWN_DOMAINS.some((d) => domain === d || domain.endsWith('.' + d))) {
    return result('INTERNAL', 'sender-own-domain', 35, false, false, ['内部邮件']);
  }

  if (isLoyaltyMarketingSender(from, domain)) {
    return result('MARKETING_NEWSLETTER', 'sender-loyalty-marketing', 20, false, false, ['营销新闻']);
  }

  if (hasDigestNewsletterSignal(text)) {
    return result('MARKETING_NEWSLETTER', 'digest-newsletter', 20, false, false, ['营销新闻']);
  }

  if (hasMailDeliveryFailureSignal(text)) {
    return result('PLATFORM_ALERT', 'mail-delivery-failure', 35, false, false, ['平台通知']);
  }

  if (hasTravelBookingSignal(text) && !hasProductSignal(text)) {
    return result('PLATFORM_ALERT', 'travel-booking-notice', 35, false, false, ['平台通知']);
  }

  if (hasLogisticsGuideSignal(text)) {
    return result('PLATFORM_ALERT', 'logistics-guide-notice', 35, false, false, ['平台通知']);
  }

  if (hasSeoSpamSignal(text)) {
    return result('SEO_SPAM', 'seo-spam-signal', 10, false, false, ['SEO垃圾']);
  }

  if (hasMarketingSignal(text) && !hasDirectBusinessIntent(text)) {
    return result('MARKETING_NEWSLETTER', 'marketing-without-business-intent', 20, false, false, ['营销新闻']);
  }

  const authOpsHit = criticalAuthOpsSignal(text);
  if (authOpsHit) {
    return result('AUTH_SECURITY', `auth-ops:${authOpsHit}`, 88, true, false, ['安全验证码', '运维授权']);
  }

  const systemSender = automatedServiceSender(from, domain);
  if (systemSender && !hasPlatformCustomerLead(text) && !hasStrongCustomerTransaction(text)) {
    return result('PLATFORM_ALERT', `automated-service:${systemSender}`, 94, false, false, ['平台通知', '自动归档']);
  }

  const settlementHit = settlementSignal(text);
  if (settlementHit) {
    return result('PAYMENT_FINANCE', `settlement:${settlementHit}`, 92, true, false, ['付款财务']);
  }

  const matched = CATEGORY_RULES.map((rule) => {
    const hits = rule.keywords.filter((k) => includesKeyword(text, k));
    if (hits.length === 0) return null;
    const score = boostScore(rule.score + Math.min(8, (hits.length - 1) * 2), domain, rule.isLead);
    return { rule, hits, score };
  })
    .filter(Boolean)
    .sort((a, b) => (b!.score === a!.score ? categoryPriority(b!.rule.category) - categoryPriority(a!.rule.category) : b!.score - a!.score))[0];

  if (matched) {
    return result(
      matched.rule.category,
      `keyword:${matched.hits[0]}${matched.hits.length > 1 ? `(+${matched.hits.length - 1})` : ''}`,
      matched.score,
      matched.rule.actionRequired,
      matched.rule.isLead,
      matched.rule.tags
    );
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
    CUSTOMS_COMPLIANCE: '海关合规',
    MEETING_FOLLOWUP: '会议跟进',
    SUPPLIER_PURCHASE: '供应采购',
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

function includesKeyword(text: string, keyword: string) {
  const needle = keyword.toLowerCase().replace(/\s+/g, ' ');
  if (needle.trim() !== needle) return text.includes(needle.trim());
  return text.includes(needle);
}

function hasSeoSpamSignal(text: string) {
  return ['backlink', 'guest post', 'domain authority', 'high da', 'high dr', 'dofollow', 'seo service', 'rank higher', 'increase traffic'].some((k) =>
    text.includes(k)
  );
}

function hasMarketingSignal(text: string) {
  return ['unsubscribe', 'newsletter', 'webinar', 'register now', 'free trial', 'promotion', 'limited time', 'click here', 'points', 'rewards', 'member benefits'].some((k) => text.includes(k));
}

function hasDigestNewsletterSignal(text: string) {
  return ['daily digest', 'weekly digest', 'medium daily digest'].some((k) => text.includes(k));
}

function hasMailDeliveryFailureSignal(text: string) {
  return ['mail delivery subsystem', 'mailer-daemon', 'delivery status notification (failure)', 'undeliverable'].some((k) => text.includes(k));
}

function hasTravelBookingSignal(text: string) {
  const travelWords = ['hotel', 'holiday inn', 'ihg', 'booking', 'reservation', 'your stay', 'check-in', 'check out', '预订', '酒店', '假日酒店', '入住'];
  return travelWords.some((k) => text.includes(k));
}

function hasLogisticsGuideSignal(text: string) {
  const hasCarrier = ['dhl', 'fedex', 'ups'].some((k) => text.includes(k));
  const hasGuide = ['operation guide', 'user guide', 'how to', '操作指南', '使用指南', '发件人操作指南'].some((k) => text.includes(k));
  return hasCarrier && hasGuide;
}

function isLoyaltyMarketingSender(from: string, domain: string | null) {
  const sender = from.toLowerCase();
  const loyaltyDomains = ['points-mail.com', 'mc.ihg.com'];
  return Boolean(
    (domain && loyaltyDomains.some((d) => domain === d || domain.endsWith('.' + d))) ||
      sender.includes('one rewards') ||
      sender.includes('ihgonerewards') ||
      sender.includes('ihg one rewards')
  );
}

function hasDirectBusinessIntent(text: string) {
  return [
    'please quote',
    'quote request',
    'quotation',
    'inquiry',
    'rfq',
    'purchase order',
    'proforma invoice',
    'we need',
    'we require',
    'send price',
    'technical datasheet',
    'laser',
    'rangefinder',
    'lrf',
  ].some((k) => text.includes(k));
}

function hasPlatformCustomerLead(text: string) {
  return /new (?:quote|inquiry|enquiry)|received a new quote|新询盘|新的报价请求/i.test(text);
}

function hasStrongCustomerTransaction(text: string) {
  return [
    /\b(?:request for quotation|rfq|purchase order|proforma invoice|signed contract)\b/i,
    /\b(?:payment|funds?) (?:has|have|was|were) (?:received|credited)\b/i,
    /\b(?:laser rangefinder|1535nm|905nm|1064nm|erbium glass laser)\b/i,
    /询盘|请报价|采购订单|已签合同|款项已到账/i,
  ].some((pattern) => pattern.test(text));
}

function automatedServiceSender(from: string, domain: string | null) {
  if (domain && SYSTEM_SERVICE_DOMAINS.some((item) => domain === item || domain.endsWith(`.${item}`))) return domain;
  if (/\b(?:no-?reply|notifications?|mailer-daemon)\b/i.test(from)) return 'automated-sender';
  return null;
}

function settlementSignal(text: string) {
  return ['refund', 'down payment', 'bank transfer', 'remittance', 'payment received', 'payment confirmation'].find((k) => text.includes(k)) || null;
}

function criticalAuthOpsSignal(text: string) {
  return [
    'misconfigured domains',
    'domains need configuration',
    'domain configuration',
    'authorization expired',
    'authorization has expired',
    'token expired',
    '授权已经失效',
    '授权失效',
    '更新有效时间',
  ].find((k) => text.includes(k)) || null;
}

function categoryPriority(category: EmailCategory) {
  const priority: Record<EmailCategory, number> = {
    ORDER_PO: 100,
    QUOTE_PI: 95,
    INQUIRY: 90,
    TECH_SUPPORT: 80,
    CUSTOMS_COMPLIANCE: 78,
    PAYMENT_FINANCE: 75,
    LOGISTICS: 72,
    MEETING_FOLLOWUP: 68,
    SUPPLIER_PURCHASE: 64,
    AUTH_SECURITY: 62,
    PLATFORM_ALERT: 30,
    SEO_SPAM: 20,
    MARKETING_NEWSLETTER: 15,
    INTERNAL: 10,
    OTHER: 0,
  };
  return priority[category] || 0;
}

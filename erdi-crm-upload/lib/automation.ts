export type AutomationTemplate = {
  key: string;
  name: string;
  description: string;
  category: string;
  channel: string;
  triggerType: string;
  triggerLabel: string;
  triggerConfig: Record<string, unknown>;
  conditionType?: string;
  conditionLabel?: string;
  conditionConfig?: Record<string, unknown>;
  actionType: string;
  actionLabel: string;
  actionConfig: Record<string, unknown>;
};

export const AUTOMATION_CORE_TEMPLATE_KEYS = [
  'assign_sales_owner',
  'score_high_value_lead',
  'keyword_auto_reply',
  'language_reply',
  'off_hours_reply',
  'tag_product_interest',
  'customer_health_repair',
  'nurture_silent_lead',
  'welcome_new_visitor',
];

export const AUTOMATION_BLUEPRINT_GROUPS = [
  {
    key: 'lead_intake',
    title: '线索进入与分配',
    description: '新线索入库后自动评分、分配负责人并提醒销售,避免渠道线索掉地上。',
    templateKeys: ['assign_sales_owner', 'score_high_value_lead'],
  },
  {
    key: 'conversation_ai',
    title: '会话 AI 回复',
    description: '关键词识别、语言识别和非工作时间兜底,让多渠道询盘先进入可控草稿/提醒。',
    templateKeys: ['keyword_auto_reply', 'language_reply', 'off_hours_reply'],
  },
  {
    key: 'profile_nurture',
    title: '画像与持续开发',
    description: '从客户消息沉淀产品兴趣,对未回复客户和低健康客户生成修复/开发任务。',
    templateKeys: ['tag_product_interest', 'customer_health_repair', 'nurture_silent_lead'],
  },
  {
    key: 'visitor_reception',
    title: '访客接待',
    description: '网站或聊天入口首次会话自动生成欢迎和需求采集话术。',
    templateKeys: ['welcome_new_visitor'],
  },
];

export const CHANNEL_LABEL: Record<string, string> = {
  ALL: '全渠道',
  CHAT_WIDGET: '聊天插件',
  WHATSAPP: 'WhatsApp',
  EMAIL: '邮件',
  ALIBABA: '阿里国际站',
  AMAZON: 'Amazon',
  SHOPEE: 'Shopee',
  FACEBOOK: 'Facebook',
  LINKEDIN: 'LinkedIn',
  SALESMARTLY: 'SaleSmartly',
};

export const STATUS_LABEL: Record<string, string> = {
  DRAFT: '草稿',
  ACTIVE: '已开启',
  PAUSED: '已暂停',
};

export const RUN_STATUS_LABEL: Record<string, string> = {
  MATCHED: '已匹配',
  SKIPPED: '跳过',
  ACTION_SENT: '已执行动作',
  FAILED: '失败',
};

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    key: 'welcome_new_visitor',
    name: '新客户欢迎语',
    description: '客户首次进入网站或发来第一条消息后,自动发送 ERDI 产品欢迎语。',
    category: '客户接待',
    channel: 'CHAT_WIDGET',
    triggerType: 'NEW_VISITOR',
    triggerLabel: '新访客 / 首次会话',
    triggerConfig: { firstSessionOnly: true },
    conditionType: 'BUSINESS_HOURS',
    conditionLabel: '自动执行时段',
    conditionConfig: { timezone: 'Asia/Shanghai', weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], start: '09:00', end: '20:00' },
    actionType: 'SEND_MESSAGE',
    actionLabel: '发送欢迎消息',
    actionConfig: {
      message:
        'Hello, this is ERDI TECH. Tell us your target range, wavelength, and application. Our sales engineer will help you choose the right laser rangefinder module.',
    },
  },
  {
    key: 'keyword_auto_reply',
    name: '识别关键词自动回复',
    description: '识别 price、datasheet、rangefinder 等关键词,自动回复产品资料和下一步问题。',
    category: '智能回复',
    channel: 'ALL',
    triggerType: 'CUSTOMER_MESSAGE',
    triggerLabel: '客户消息包含关键词',
    triggerConfig: { keywords: ['price', 'quotation', 'datasheet', 'rangefinder', 'laser'] },
    conditionType: 'KEYWORD_MATCH',
    conditionLabel: '命中任一关键词',
    conditionConfig: { mode: 'contains_any' },
    actionType: 'AI_REPLY_DRAFT',
    actionLabel: '生成 AI 回复草稿',
    actionConfig: { tone: 'professional', requireHumanApproval: true },
  },
  {
    key: 'assign_sales_owner',
    name: '自动分配指定客服',
    description: '按国家、渠道或产品线把新询盘分给对应业务员,减少漏跟进。',
    category: '销售协同',
    channel: 'ALL',
    triggerType: 'NEW_LEAD',
    triggerLabel: '新线索入库',
    triggerConfig: { sources: ['EMAIL', 'ALIBABA', 'WHATSAPP', 'LINKEDIN'] },
    conditionType: 'ROUTE_RULE',
    conditionLabel: '按国家 / 产品线分配',
    conditionConfig: { countryFallback: 'sales@erdicn.com' },
    actionType: 'ASSIGN_OWNER',
    actionLabel: '分配负责人并创建跟进',
    actionConfig: { followUpHours: 4 },
  },
  {
    key: 'language_reply',
    name: '自动识别客户语言回复',
    description: '客户使用西语、俄语、阿语等语言时,先翻译成中文,再生成对应语言回复。',
    category: 'AI 翻译',
    channel: 'ALL',
    triggerType: 'CUSTOMER_MESSAGE',
    triggerLabel: '收到客户消息',
    triggerConfig: { detectLanguage: true },
    conditionType: 'LANGUAGE_NOT_ZH',
    conditionLabel: '客户语言不是中文',
    conditionConfig: { targetInternalLang: 'zh' },
    actionType: 'TRANSLATE_AND_DRAFT',
    actionLabel: '翻译 + 起草客户语言回复',
    actionConfig: { approvalMode: 'DRAFT' },
  },
  {
    key: 'off_hours_reply',
    name: '非营业时间自动回复',
    description: '夜间或周末客户咨询时,自动说明已收到并承诺回复时效。',
    category: '客户接待',
    channel: 'ALL',
    triggerType: 'CUSTOMER_MESSAGE',
    triggerLabel: '非工作时间收到消息',
    triggerConfig: { anyInbound: true },
    conditionType: 'OUTSIDE_BUSINESS_HOURS',
    conditionLabel: '不在自动执行时段',
    conditionConfig: { timezone: 'Asia/Shanghai', start: '09:00', end: '20:00' },
    actionType: 'SEND_MESSAGE',
    actionLabel: '发送离线说明',
    actionConfig: {
      message:
        'Thanks for contacting ERDI TECH. We have received your message and will reply with product details and quotation as soon as the sales engineer is online.',
    },
  },
  {
    key: 'tag_product_interest',
    name: '自动为客户打标签',
    description: '从客户消息中识别 1535nm、905nm、rangefinder、drone 等兴趣标签。',
    category: '客户画像',
    channel: 'ALL',
    triggerType: 'CUSTOMER_MESSAGE',
    triggerLabel: '收到产品相关消息',
    triggerConfig: { extractProductInterest: true },
    conditionType: 'INTENT_MATCH',
    conditionLabel: '意图为产品咨询 / 询价',
    conditionConfig: { intents: ['PRICE_INQUIRY', 'PRODUCT_QUESTION'] },
    actionType: 'ADD_TAG',
    actionLabel: '补充客户画像标签',
    actionConfig: { tags: ['激光测距', '待分配产品线'] },
  },
  {
    key: 'nurture_silent_lead',
    name: '多轮自动跟进开发信',
    description: '借鉴外贸通自动开发:客户未回复时按节奏发送多语言开发信和资料。',
    category: '外贸开发',
    channel: 'EMAIL',
    triggerType: 'NO_REPLY_TIMEOUT',
    triggerLabel: '客户超时未回复',
    triggerConfig: { waitHours: 48 },
    conditionType: 'LEAD_NOT_REPLIED',
    conditionLabel: '线索仍未回复且未成交',
    conditionConfig: { maxRounds: 3 },
    actionType: 'DRIP_EMAIL_DRAFT',
    actionLabel: '生成下一封开发信草稿',
    actionConfig: { languages: ['en', 'es', 'fr'], requireHumanApproval: true },
  },
  {
    key: 'customer_health_repair',
    name: '客户健康短板自动修复',
    description: '客户来信时自动检查五点健康度,低分、无联系人、停滞商机或无负责人时生成修复任务。',
    category: '客户健康',
    channel: 'ALL',
    triggerType: 'CUSTOMER_MESSAGE',
    triggerLabel: '收到客户消息',
    triggerConfig: { anyInbound: true },
    conditionType: 'CUSTOMER_HEALTH',
    conditionLabel: '客户五点体检存在短板',
    conditionConfig: {
      maxScore: 55,
      shortfallsAny: ['资料', '联系人', '互动', '商机', '下一步', '停滞', '逾期任务'],
      includeStalled: true,
      includeOverdue: true,
      includeUnassigned: true,
    },
    actionType: 'CREATE_HEALTH_REPAIR_TASK',
    actionLabel: '生成客户健康修复任务',
    actionConfig: { dueHours: 24, source: 'CUSTOMER_HEALTH_AUTOMATION' },
  },
  {
    key: 'score_high_value_lead',
    name: '高价值线索评分提醒',
    description: '根据国家、邮箱域名、产品关键词、金额意向给线索评分,高分推送销售提醒。',
    category: '线索评分',
    channel: 'ALL',
    triggerType: 'NEW_LEAD',
    triggerLabel: '新线索入库',
    triggerConfig: { scoreLead: true },
    conditionType: 'LEAD_SCORE',
    conditionLabel: '线索评分 >= 80',
    conditionConfig: { minScore: 80 },
    actionType: 'CREATE_NOTIFICATION',
    actionLabel: '通知负责人立即跟进',
    actionConfig: { priority: 'high', slaMinutes: 30 },
  },
];

export function getTemplate(key: string) {
  return AUTOMATION_TEMPLATES.find((template) => template.key === key);
}

export function buildCanvas(template: AutomationTemplate) {
  return {
    nodes: [
      { id: 'trigger', type: 'trigger', label: template.triggerLabel, x: 80, y: 80 },
      template.conditionLabel
        ? { id: 'condition', type: 'condition', label: template.conditionLabel, x: 380, y: 80 }
        : null,
      { id: 'action', type: 'action', label: template.actionLabel, x: template.conditionLabel ? 690 : 380, y: 80 },
    ].filter(Boolean),
    edges: template.conditionLabel
      ? [
          { from: 'trigger', to: 'condition', label: '下一步' },
          { from: 'condition', to: 'action', label: '匹配' },
        ]
      : [{ from: 'trigger', to: 'action', label: '下一步' }],
  };
}

export function compactJson(value: unknown) {
  if (!value) return '未配置';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

type RadarLevel = 'hot' | 'risk' | 'warm' | 'normal';

type RadarInboxMessage = {
  direction?: string | null;
  status?: string | null;
  sentAt?: Date | string | null;
  createdAt?: Date | string | null;
};

type RadarFollowUp = {
  createdAt?: Date | string | null;
};

type RadarOpportunity = {
  title?: string | null;
  stage?: string | null;
  stageChangedAt?: Date | string | null;
  updatedAt?: Date | string | null;
  amountUSD?: number | null;
};

export type SalesRadarCompany = {
  id?: string;
  name: string;
  type?: string | null;
  source?: string | null;
  country?: string | null;
  ownerId?: string | null;
  priorityScore?: number | null;
  nextAction?: string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
  inboxMessages?: RadarInboxMessage[];
  followUps?: RadarFollowUp[];
  opportunities?: RadarOpportunity[];
  _count?: {
    inboxMessages?: number;
    opportunities?: number;
  };
};

export type SalesRadarInsight = {
  score: number;
  level: RadarLevel;
  levelLabel: string;
  title: string;
  recommendedAction: string;
  reasons: string[];
  metrics: {
    daysSinceLastInteraction: number | null;
    daysSinceLastInbound: number | null;
    openOpportunityCount: number;
    stalledOpportunityCount: number;
    awaitingReply: boolean;
  };
};

const CLOSED_STAGES = new Set(['CLOSED_WON', 'CLOSED_LOST']);
const QUOTE_TYPES = new Set(['QUOTED', 'CONTRACT_SENT']);

export function buildSalesRadar(company: SalesRadarCompany, now = new Date()): SalesRadarInsight {
  const inboxMessages = company.inboxMessages || [];
  const followUps = company.followUps || [];
  const opportunities = company.opportunities || [];

  const lastInboundAt = latestDate(inboxMessages.filter((m) => m.direction === 'IN'));
  const lastOutboundAt = latestDate(inboxMessages.filter((m) => m.direction === 'OUT'));
  const lastMessageAt = latestDate(inboxMessages);
  const lastFollowUpAt = latestDate(followUps);
  const lastInteractionAt = maxDate([lastMessageAt, lastFollowUpAt, toDate(company.updatedAt), toDate(company.createdAt)]);

  const openOpportunities = opportunities.filter((o) => !CLOSED_STAGES.has(String(o.stage || '')));
  const stalledOpportunities = openOpportunities.filter((o) => {
    const stageDate = toDate(o.stageChangedAt) || toDate(o.updatedAt);
    return stageDate ? diffDays(stageDate, now) >= 7 : false;
  });
  const quotedOpenOpportunities = openOpportunities.filter((o) => ['QUOTING', 'NEGOTIATING', 'SPEC_CONFIRMING'].includes(String(o.stage || '')));

  const daysSinceLastInteraction = lastInteractionAt ? diffDays(lastInteractionAt, now) : null;
  const daysSinceLastInbound = lastInboundAt ? diffDays(lastInboundAt, now) : null;
  const awaitingReply = !!lastInboundAt && (!lastOutboundAt || lastInboundAt.getTime() > lastOutboundAt.getTime());
  const missingNextAction = !String(company.nextAction || '').trim();
  const missingOwner = !company.ownerId;
  const basePriority = Math.max(0, Math.min(100, company.priorityScore || 0));

  let score = Math.round(basePriority * 0.65);
  const reasons: string[] = [];

  if (missingOwner) {
    score += 18;
    reasons.push('客户没有负责人,容易漏跟');
  }
  if (awaitingReply) {
    score += daysSinceLastInbound !== null && daysSinceLastInbound <= 2 ? 30 : 24;
    reasons.push(daysSinceLastInbound === 0 ? '客户今天来信等待回复' : `客户来信后已 ${daysSinceLastInbound} 天未见我方后续回复`);
  }
  if (openOpportunities.length > 0) {
    score += Math.min(18, 8 + openOpportunities.length * 3);
    reasons.push(`${openOpportunities.length} 个进行中商机需要推进`);
  }
  if (stalledOpportunities.length > 0) {
    score += 20;
    reasons.push(`${stalledOpportunities.length} 个商机阶段停留超过 7 天`);
  }
  if (QUOTE_TYPES.has(String(company.type || '')) || quotedOpenOpportunities.length > 0) {
    score += 12;
    reasons.push('已到报价/合同阶段,需要推进到确认订单');
  }
  if (missingNextAction) {
    score += 10;
    reasons.push('缺少下一步动作,销售执行不够明确');
  }
  if (daysSinceLastInteraction !== null && daysSinceLastInteraction >= 30 && !CLOSED_STAGES.has(String(company.type || ''))) {
    score += daysSinceLastInteraction >= 90 ? 22 : 14;
    reasons.push(`最近 ${daysSinceLastInteraction} 天无互动,有休眠风险`);
  }
  if ((company._count?.inboxMessages || 0) >= 2) {
    score += 6;
    reasons.push('已有多封/多条往来,不是冷启动线索');
  }

  score = Math.max(0, Math.min(100, score));
  const level = pickLevel(score, stalledOpportunities.length > 0, daysSinceLastInteraction);

  if (reasons.length === 0) {
    reasons.push('当前信号平稳,按计划维护即可');
  }

  return {
    score,
    level,
    levelLabel: levelLabel(level),
    title: radarTitle(level, awaitingReply, stalledOpportunities.length),
    recommendedAction: recommendAction(company, {
      missingOwner,
      awaitingReply,
      missingNextAction,
      stalledOpportunities,
      daysSinceLastInteraction,
      quotedOpenOpportunities,
    }),
    reasons: reasons.slice(0, 4),
    metrics: {
      daysSinceLastInteraction,
      daysSinceLastInbound,
      openOpportunityCount: openOpportunities.length,
      stalledOpportunityCount: stalledOpportunities.length,
      awaitingReply,
    },
  };
}

function recommendAction(
  company: SalesRadarCompany,
  state: {
    missingOwner: boolean;
    awaitingReply: boolean;
    missingNextAction: boolean;
    stalledOpportunities: RadarOpportunity[];
    daysSinceLastInteraction: number | null;
    quotedOpenOpportunities: RadarOpportunity[];
  }
) {
  if (state.missingOwner) return '先分配负责人,并要求今天内完成首轮判断和客户回复。';
  if (state.awaitingReply) return '优先回复客户最新问题,同步产品规格、交期、价格边界或下一步确认项。';
  if (state.stalledOpportunities.length > 0) {
    const title = state.stalledOpportunities[0]?.title || '重点商机';
    return `复盘「${title}」卡住原因,补报价/样品/规格确认动作,必要时升级给负责人。`;
  }
  if (state.quotedOpenOpportunities.length > 0 || QUOTE_TYPES.has(String(company.type || ''))) {
    return '围绕已报价内容跟进客户反馈,推动确认 PI、样品、付款或技术澄清。';
  }
  if (state.missingNextAction) return '补一条明确下一步动作:何时联系、联系谁、发送什么资料、要客户确认什么。';
  if (state.daysSinceLastInteraction !== null && state.daysSinceLastInteraction >= 30) {
    return '发一封轻量唤醒邮件,带最新产品/案例/交付能力,询问项目是否继续推进。';
  }
  return '保持当前节奏,下一次跟进时补齐客户痛点、竞品和采购时间线。';
}

function pickLevel(score: number, hasStalledOpportunity: boolean, daysSinceLastInteraction: number | null): RadarLevel {
  if (hasStalledOpportunity || (daysSinceLastInteraction !== null && daysSinceLastInteraction >= 45)) return 'risk';
  if (score >= 82) return 'hot';
  if (score >= 55) return 'warm';
  return 'normal';
}

function levelLabel(level: RadarLevel) {
  const labels: Record<RadarLevel, string> = {
    hot: '高意向',
    risk: '风险预警',
    warm: '可推进',
    normal: '常规维护',
  };
  return labels[level];
}

function radarTitle(level: RadarLevel, awaitingReply: boolean, stalledCount: number) {
  if (awaitingReply) return '客户等待回复';
  if (stalledCount > 0) return '商机停留过久';
  if (level === 'hot') return '高价值推进';
  if (level === 'warm') return '需要明确下一步';
  if (level === 'risk') return '关系有流失风险';
  return '保持节奏';
}

function latestDate(items: Array<{ sentAt?: Date | string | null; createdAt?: Date | string | null }>) {
  return maxDate(items.map((item) => toDate(item.sentAt) || toDate(item.createdAt)));
}

function maxDate(dates: Array<Date | null>) {
  const timestamps = dates.map((date) => date?.getTime() || 0).filter((time) => time > 0);
  if (timestamps.length === 0) return null;
  return new Date(Math.max(...timestamps));
}

function toDate(value?: Date | string | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function diffDays(from: Date, to: Date) {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86400000));
}

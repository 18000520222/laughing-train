import { CHANNEL_LABEL, RUN_STATUS_LABEL } from '@/lib/automation';

type FlowForInsights = {
  id: string;
  flowCode: string;
  name: string;
  category: string;
  channel: string;
  status: string;
  conditionType: string | null;
  actionType: string;
  triggerCount: number;
  uniqueContactCount: number;
  lastRunAt: Date | null;
  runs: Array<{
    id: string;
    channel: string;
    status: string;
    matched: boolean;
    createdAt: Date;
    summary: string | null;
  }>;
};

export type AutomationFunnelRow = {
  key: string;
  label: string;
  flowCount: number;
  activeFlows: number;
  runs: number;
  matchedRuns: number;
  actionRuns: number;
  failedRuns: number;
  skippedRuns: number;
  matchRate: number | null;
  actionRate: number | null;
  failureRate: number | null;
  healthScore: number;
};

export type AutomationRiskFlowRow = {
  id: string;
  flowCode: string;
  name: string;
  category: string;
  channelLabel: string;
  actionType: string;
  status: string;
  runs: number;
  matchedRuns: number;
  failedRuns: number;
  skippedRuns: number;
  matchRate: number | null;
  actionRate: number | null;
  failureRate: number | null;
  lastRunAtLabel: string;
  reason: string;
  weight: number;
};

export function buildAutomationFunnelInsights(flows: FlowForInsights[]) {
  const runCount = flows.reduce((sum, flow) => sum + flow.runs.length, 0);
  const matchedRuns = flows.reduce((sum, flow) => sum + flow.runs.filter((run) => run.matched).length, 0);
  const actionRuns = flows.reduce((sum, flow) => sum + flow.runs.filter((run) => run.status === 'ACTION_SENT').length, 0);
  const failedRuns = flows.reduce((sum, flow) => sum + flow.runs.filter((run) => run.status === 'FAILED').length, 0);
  const skippedRuns = flows.reduce((sum, flow) => sum + flow.runs.filter((run) => run.status === 'SKIPPED').length, 0);
  const byChannel = buildRows(flows, (flow) => flow.channel, (key) => CHANNEL_LABEL[key] || key);
  const byAction = buildRows(flows, (flow) => flow.actionType, actionLabel);
  const byCondition = buildRows(flows, (flow) => flow.conditionType || 'NO_CONDITION', conditionLabel);
  const riskFlows = flows
    .map(flowRisk)
    .filter(Boolean)
    .sort((a, b) => b!.weight - a!.weight || b!.failedRuns - a!.failedRuns || a!.matchRate! - b!.matchRate!)
    .slice(0, 10) as AutomationRiskFlowRow[];

  return {
    flowCount: flows.length,
    activeFlows: flows.filter((flow) => flow.status === 'ACTIVE').length,
    runCount,
    matchedRuns,
    actionRuns,
    failedRuns,
    skippedRuns,
    matchRate: runCount ? matchedRuns / runCount : null,
    actionRate: runCount ? actionRuns / runCount : null,
    failureRate: runCount ? failedRuns / runCount : null,
    byChannel,
    byAction,
    byCondition,
    riskFlows,
    maxChannelRuns: Math.max(1, ...byChannel.map((row) => row.runs)),
    maxActionRuns: Math.max(1, ...byAction.map((row) => row.runs)),
    maxConditionRuns: Math.max(1, ...byCondition.map((row) => row.runs)),
    recommendation: automationFunnelRecommendation({ runCount, matchedRuns, actionRuns, failedRuns, skippedRuns, riskFlows }),
  };
}

function buildRows(
  flows: FlowForInsights[],
  keyOf: (flow: FlowForInsights) => string,
  labelOf: (key: string) => string
): AutomationFunnelRow[] {
  const buckets = new Map<string, { flows: FlowForInsights[]; runs: FlowForInsights['runs'] }>();
  for (const flow of flows) {
    const key = keyOf(flow) || 'UNKNOWN';
    const bucket = buckets.get(key) || { flows: [], runs: [] };
    bucket.flows.push(flow);
    bucket.runs.push(...flow.runs);
    buckets.set(key, bucket);
  }

  return Array.from(buckets.entries())
    .map(([key, bucket]) => {
      const runs = bucket.runs.length;
      const matchedRuns = bucket.runs.filter((run) => run.matched).length;
      const actionRuns = bucket.runs.filter((run) => run.status === 'ACTION_SENT').length;
      const failedRuns = bucket.runs.filter((run) => run.status === 'FAILED').length;
      const skippedRuns = bucket.runs.filter((run) => run.status === 'SKIPPED').length;
      return {
        key,
        label: labelOf(key),
        flowCount: bucket.flows.length,
        activeFlows: bucket.flows.filter((flow) => flow.status === 'ACTIVE').length,
        runs,
        matchedRuns,
        actionRuns,
        failedRuns,
        skippedRuns,
        matchRate: runs ? matchedRuns / runs : null,
        actionRate: runs ? actionRuns / runs : null,
        failureRate: runs ? failedRuns / runs : null,
        healthScore: funnelHealthScore({ runs, matchedRuns, actionRuns, failedRuns, skippedRuns }),
      };
    })
    .sort((a, b) => b.runs - a.runs || b.healthScore - a.healthScore || b.activeFlows - a.activeFlows);
}

function flowRisk(flow: FlowForInsights): AutomationRiskFlowRow | null {
  const runs = flow.runs.length;
  const matchedRuns = flow.runs.filter((run) => run.matched).length;
  const actionRuns = flow.runs.filter((run) => run.status === 'ACTION_SENT').length;
  const failedRuns = flow.runs.filter((run) => run.status === 'FAILED').length;
  const skippedRuns = flow.runs.filter((run) => run.status === 'SKIPPED').length;
  const matchRate = runs ? matchedRuns / runs : null;
  const actionRate = runs ? actionRuns / runs : null;
  const failureRate = runs ? failedRuns / runs : null;
  let reason = '';
  let weight = 0;

  if (flow.status === 'ACTIVE' && !flow.lastRunAt && flow.triggerCount === 0) {
    reason = '已开启但没有触发记录';
    weight = 95;
  } else if (failedRuns > 0) {
    reason = `最近 ${failedRuns} 次失败`;
    weight = 90 + failedRuns;
  } else if (runs >= 5 && matchRate !== null && matchRate < 0.35) {
    reason = '命中率低于 35%';
    weight = 78;
  } else if (runs >= 5 && skippedRuns / runs >= 0.7) {
    reason = '跳过过多,条件或渠道可能错配';
    weight = 72;
  } else if (runs >= 5 && actionRate !== null && actionRate < 0.2 && actionRequiresExecution(flow.actionType)) {
    reason = '动作执行率偏低';
    weight = 66;
  } else if (flow.status === 'DRAFT') {
    reason = '草稿未上线';
    weight = 45;
  } else if (flow.status === 'PAUSED') {
    reason = '流程已暂停';
    weight = 35;
  }

  if (!reason) return null;
  return {
    id: flow.id,
    flowCode: flow.flowCode,
    name: flow.name,
    category: flow.category,
    channelLabel: CHANNEL_LABEL[flow.channel] || flow.channel,
    actionType: actionLabel(flow.actionType),
    status: flow.status,
    runs,
    matchedRuns,
    failedRuns,
    skippedRuns,
    matchRate,
    actionRate,
    failureRate,
    lastRunAtLabel: flow.lastRunAt ? flow.lastRunAt.toLocaleDateString('zh-CN') : '从未运行',
    reason,
    weight,
  };
}

function automationFunnelRecommendation(input: {
  runCount: number;
  matchedRuns: number;
  actionRuns: number;
  failedRuns: number;
  skippedRuns: number;
  riskFlows: AutomationRiskFlowRow[];
}) {
  if (input.runCount === 0) return '近样本暂无自动化运行。先确认渠道入口和核心流程处于 ACTIVE,再用真实入站消息触发。';
  if (input.failedRuns > 0) return `近样本有 ${input.failedRuns} 次失败。优先处理失败重放台和下方高风险流程,避免客户消息卡在自动化里。`;
  if (input.skippedRuns / input.runCount >= 0.7) return '自动化跳过比例偏高。重点复核关键词、语言、意图、客户健康等条件是否过严。';
  if (input.matchedRuns > 0 && input.actionRuns === 0) return '流程能命中,但动作执行偏少。检查动作类型是否只生成草稿,以及是否需要明确转任务/通知/标签动作。';
  if (input.riskFlows.length > 0) return `有 ${input.riskFlows.length} 个流程需要运营复核。先处理已开启未触发、低命中和动作执行率偏低的流程。`;
  return '自动化漏斗运行稳定。下一步把渠道/动作效果继续接到销售任务和商机收入归因。';
}

function funnelHealthScore(input: { runs: number; matchedRuns: number; actionRuns: number; failedRuns: number; skippedRuns: number }) {
  if (input.runs === 0) return 50;
  const matchRate = input.matchedRuns / input.runs;
  const actionRate = input.actionRuns / input.runs;
  const failureRate = input.failedRuns / input.runs;
  const skippedRate = input.skippedRuns / input.runs;
  const score = 55 + matchRate * 25 + actionRate * 20 - failureRate * 45 - Math.max(0, skippedRate - 0.55) * 25;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function actionRequiresExecution(actionType: string) {
  return ['ASSIGN_OWNER', 'ADD_TAG', 'CREATE_NOTIFICATION', 'CREATE_HEALTH_REPAIR_TASK', 'DRIP_EMAIL_DRAFT'].includes(actionType);
}

function actionLabel(actionType: string) {
  const labels: Record<string, string> = {
    SEND_MESSAGE: '发送/草稿消息',
    AI_REPLY_DRAFT: 'AI 回复草稿',
    TRANSLATE_AND_DRAFT: '翻译并起草',
    ASSIGN_OWNER: '分配负责人',
    ADD_TAG: '客户标签',
    CREATE_NOTIFICATION: '销售提醒',
    DRIP_EMAIL_DRAFT: '开发信草稿',
    CREATE_HEALTH_REPAIR_TASK: '健康修复任务',
  };
  return labels[actionType] || actionType;
}

function conditionLabel(conditionType: string) {
  const labels: Record<string, string> = {
    NO_CONDITION: '无条件',
    KEYWORD_MATCH: '关键词命中',
    BUSINESS_HOURS: '工作时间',
    OUTSIDE_BUSINESS_HOURS: '非工作时间',
    LANGUAGE_NOT_ZH: '非中文客户',
    INTENT_MATCH: '意图匹配',
    LEAD_SCORE: '线索评分',
    CUSTOMER_HEALTH: '客户健康',
    ROUTE_RULE: '路由规则',
    LEAD_NOT_REPLIED: '超时未回复',
  };
  return labels[conditionType] || conditionType;
}

export { actionLabel as automationActionLabel, conditionLabel as automationConditionLabel };

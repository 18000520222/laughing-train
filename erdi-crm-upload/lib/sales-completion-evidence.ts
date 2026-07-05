export type CompletionEvidenceTaskInput = {
  id: string;
  title: string;
  source: string;
  completedAt: Date | null;
  dueAt: Date | null;
  owner?: { name: string | null; email: string } | null;
  company?: { id: string; name: string } | null;
  opportunity?: { id: string; title: string; amountUSD: number | null } | null;
};

export type CompletionEvidenceFollowUpInput = {
  id: string;
  companyId: string;
  content: string;
  type: string;
  createdAt: Date;
  user?: { name: string | null; email: string } | null;
};

export type CompletionEvidenceMessageInput = {
  id: string;
  companyId: string | null;
  direction: string;
  senderName: string | null;
  originalText: string;
  translatedText: string | null;
  sentAt: Date | null;
  createdAt: Date;
};

export type CompletionEvidenceOpportunityInput = {
  id: string;
  companyId: string;
  title: string;
  stage: string;
  amountUSD: number | null;
  stageChangedAt: Date;
  updatedAt: Date;
};

export type CompletionEvidenceRow = {
  taskId: string;
  taskTitle: string;
  companyName: string;
  ownerName: string;
  completedAt: Date;
  dueAt: Date | null;
  evidenceCount: number;
  followUpCount: number;
  outboundCount: number;
  stageChangeCount: number;
  statusLabel: string;
  strongestEvidence: string;
  nextAuditAction: string;
  href: string;
  tone: 'rose' | 'amber' | 'emerald';
};

const EVIDENCE_LOOKBACK_MINUTES = 5;
const EVIDENCE_WINDOW_DAYS = 14;

export function buildSalesCompletionEvidenceReport({
  tasks,
  followUps,
  messages,
  opportunities,
}: {
  tasks: CompletionEvidenceTaskInput[];
  followUps: CompletionEvidenceFollowUpInput[];
  messages: CompletionEvidenceMessageInput[];
  opportunities: CompletionEvidenceOpportunityInput[];
}) {
  const doneTasks = tasks.filter((task) => task.completedAt && task.company?.id);
  const rows = doneTasks.map((task) => completionEvidenceRow(task, followUps, messages, opportunities));
  const missingEvidence = rows.filter((row) => row.evidenceCount === 0).length;
  const weakEvidence = rows.filter((row) => row.evidenceCount > 0 && row.stageChangeCount === 0 && row.outboundCount === 0).length;
  const strongEvidence = rows.filter((row) => row.stageChangeCount > 0 || row.outboundCount > 0).length;
  const onTimeDone = rows.filter((row) => !row.dueAt || row.completedAt.getTime() <= row.dueAt.getTime()).length;
  const sortedRows = rows.sort((a, b) => toneRank(a.tone) - toneRank(b.tone) || b.completedAt.getTime() - a.completedAt.getTime());

  return {
    completedTasks: rows.length,
    missingEvidence,
    weakEvidence,
    strongEvidence,
    onTimeDone,
    evidenceRate: rows.length ? (rows.length - missingEvidence) / rows.length : null,
    strongEvidenceRate: rows.length ? strongEvidence / rows.length : null,
    allRows: sortedRows,
    rows: sortedRows.slice(0, 9),
    recommendation: completionEvidenceRecommendation({ completedTasks: rows.length, missingEvidence, weakEvidence, strongEvidence }),
  };
}

function completionEvidenceRow(
  task: CompletionEvidenceTaskInput,
  followUps: CompletionEvidenceFollowUpInput[],
  messages: CompletionEvidenceMessageInput[],
  opportunities: CompletionEvidenceOpportunityInput[]
): CompletionEvidenceRow {
  const completedAt = task.completedAt!;
  const companyId = task.company!.id;
  const windowStart = new Date(completedAt.getTime() - EVIDENCE_LOOKBACK_MINUTES * 60000);
  const windowEnd = new Date(completedAt.getTime() + EVIDENCE_WINDOW_DAYS * 86400000);
  const matchedFollowUps = followUps.filter((item) => item.companyId === companyId && inWindow(item.createdAt, windowStart, windowEnd));
  const matchedOutbounds = messages.filter((item) => item.companyId === companyId && item.direction === 'OUT' && inWindow(item.sentAt || item.createdAt, windowStart, windowEnd));
  const matchedStageChanges = opportunities.filter((item) => item.companyId === companyId && inWindow(item.stageChangedAt || item.updatedAt, windowStart, windowEnd));
  const evidenceCount = matchedFollowUps.length + matchedOutbounds.length + matchedStageChanges.length;
  const strongestEvidence =
    stageEvidence(matchedStageChanges[0]) ||
    outboundEvidence(matchedOutbounds[0]) ||
    followUpEvidence(matchedFollowUps[0]) ||
    '完成后暂无跟进记录、出站消息或商机阶段推进。';
  const tone = evidenceCount === 0 ? 'rose' : matchedStageChanges.length > 0 || matchedOutbounds.length > 0 ? 'emerald' : 'amber';

  return {
    taskId: task.id,
    taskTitle: task.title,
    companyName: task.company?.name || '未知客户',
    ownerName: task.owner?.name || task.owner?.email || '未分配',
    completedAt,
    dueAt: task.dueAt,
    evidenceCount,
    followUpCount: matchedFollowUps.length,
    outboundCount: matchedOutbounds.length,
    stageChangeCount: matchedStageChanges.length,
    statusLabel: evidenceCount === 0 ? '缺完成证据' : tone === 'emerald' ? '有业务结果' : '仅有记录',
    strongestEvidence,
    nextAuditAction: evidenceCount === 0 ? '要求负责人补跟进记录或同步客户回复。' : tone === 'amber' ? '确认是否已真实回复客户或推进商机。' : '抽查证据是否和任务目标一致。',
    href: `/customers/${companyId}`,
    tone,
  };
}

function completionEvidenceRecommendation(input: { completedTasks: number; missingEvidence: number; weakEvidence: number; strongEvidence: number }) {
  if (input.completedTasks === 0) return '近 30 天暂无可审计的已完成销售任务。先让销售任务进入 CRM 并从任务队列完成。';
  if (input.missingEvidence > 0) return `${input.missingEvidence} 个已完成任务缺少业务证据。先追负责人补跟进记录、客户回复或商机阶段结果。`;
  if (input.weakEvidence > 0) return `${input.weakEvidence} 个已完成任务只有内部记录。建议抽查是否真的联系客户,并补出站消息或商机推进。`;
  return `${input.strongEvidence} 个已完成任务有出站消息或商机推进证据。继续把完成动作和客户结果绑在一起。`;
}

function inWindow(value: Date, start: Date, end: Date) {
  const time = value.getTime();
  return time >= start.getTime() && time <= end.getTime();
}

function followUpEvidence(item: CompletionEvidenceFollowUpInput | undefined) {
  if (!item) return '';
  return `跟进记录: ${item.content.slice(0, 80)}`;
}

function outboundEvidence(item: CompletionEvidenceMessageInput | undefined) {
  if (!item) return '';
  return `出站消息: ${(item.translatedText || item.originalText).slice(0, 80)}`;
}

function stageEvidence(item: CompletionEvidenceOpportunityInput | undefined) {
  if (!item) return '';
  return `商机推进: ${item.title} -> ${stageLabel(item.stage)} / $${Math.round(item.amountUSD || 0).toLocaleString()}`;
}

function stageLabel(stage: string) {
  const labels: Record<string, string> = {
    UNPROCESSED: '未处理',
    REPLIED: '已回复',
    QUOTING: '报价中',
    NEGOTIATING: '谈判中',
    SPEC_CONFIRMING: '规格确认',
    CLOSED_WON: '已成交',
    CLOSED_LOST: '已流失',
  };
  return labels[stage] || stage;
}

function toneRank(tone: CompletionEvidenceRow['tone']) {
  const ranks: Record<CompletionEvidenceRow['tone'], number> = { rose: 0, amber: 1, emerald: 2 };
  return ranks[tone];
}

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const sourcePath = path.join(process.cwd(), 'lib/sales-priority-queue.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const pageSource = fs.readFileSync(path.join(process.cwd(), 'app/sales-command/page.tsx'), 'utf8');
const customerPageSource = fs.readFileSync(path.join(process.cwd(), 'app/customers/[id]/page.tsx'), 'utf8');
const actionRouteSource = fs.readFileSync(path.join(process.cwd(), 'app/api/sales-command/priority-action/route.ts'), 'utf8');
const morningRouteSource = fs.readFileSync(path.join(process.cwd(), 'app/api/sales-command/morning-briefing/route.ts'), 'utf8');
const completionEvidenceRouteSource = fs.readFileSync(path.join(process.cwd(), 'app/api/sales-command/completion-evidence/route.ts'), 'utf8');
const completionEvidenceResolveRouteSource = fs.readFileSync(path.join(process.cwd(), 'app/api/customers/completion-evidence/resolve/route.ts'), 'utf8');
const completionEvidenceCronSource = fs.readFileSync(path.join(process.cwd(), 'app/api/cron/completion-evidence/route.ts'), 'utf8');
const completionEvidenceEscalationCronSource = fs.readFileSync(path.join(process.cwd(), 'app/api/cron/completion-evidence-escalations/route.ts'), 'utf8');
const morningCronSource = fs.readFileSync(path.join(process.cwd(), 'app/api/cron/morning-briefing/route.ts'), 'utf8');
const morningWatchSource = fs.readFileSync(path.join(process.cwd(), 'lib/sales-morning-briefing-watch.ts'), 'utf8');
const morningClosureSource = fs.readFileSync(path.join(process.cwd(), 'lib/sales-morning-briefing-closure.ts'), 'utf8');
const actionClosurePath = path.join(process.cwd(), 'lib/sales-action-closure.ts');
const actionClosureSource = fs.readFileSync(actionClosurePath, 'utf8');
const completionEvidencePath = path.join(process.cwd(), 'lib/sales-completion-evidence.ts');
const completionEvidenceSource = fs.readFileSync(completionEvidencePath, 'utf8');
const completionEvidenceEscalationPath = path.join(process.cwd(), 'lib/sales-completion-evidence-escalation.ts');
const completionEvidenceEscalationSource = fs.readFileSync(completionEvidenceEscalationPath, 'utf8');
const completionEvidenceRepairSource = fs.readFileSync(path.join(process.cwd(), 'lib/sales-completion-evidence-repair.ts'), 'utf8');
const vercelConfig = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8'));
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
});

const exported = {};
const sandbox = {
  exports: exported,
  module: { exports: exported },
  require,
};
vm.runInNewContext(compiled.outputText, sandbox, { filename: sourcePath });
const { buildSalesMorningBriefing, buildSalesOwnerPriorityReport, buildSalesPriorityQueue } = sandbox.module.exports;
const actionClosureCompiled = ts.transpileModule(actionClosureSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
});
const actionClosureExported = {};
const actionClosureSandbox = {
  exports: actionClosureExported,
  module: { exports: actionClosureExported },
  require,
};
vm.runInNewContext(actionClosureCompiled.outputText, actionClosureSandbox, { filename: actionClosurePath });
const { buildSalesActionClosureReport } = actionClosureSandbox.module.exports;
const completionEvidenceCompiled = ts.transpileModule(completionEvidenceSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
});
const completionEvidenceExported = {};
const completionEvidenceSandbox = {
  exports: completionEvidenceExported,
  module: { exports: completionEvidenceExported },
  require,
};
vm.runInNewContext(completionEvidenceCompiled.outputText, completionEvidenceSandbox, { filename: completionEvidencePath });
const { buildSalesCompletionEvidenceReport } = completionEvidenceSandbox.module.exports;
const completionEvidenceEscalationCompiled = ts.transpileModule(completionEvidenceEscalationSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
});
const completionEvidenceEscalationExported = {};
const completionEvidenceEscalationSandbox = {
  exports: completionEvidenceEscalationExported,
  module: { exports: completionEvidenceEscalationExported },
  require,
};
vm.runInNewContext(completionEvidenceEscalationCompiled.outputText, completionEvidenceEscalationSandbox, { filename: completionEvidenceEscalationPath });
const { buildCompletionEvidenceEscalationReport } = completionEvidenceEscalationSandbox.module.exports;

const now = new Date('2026-07-04T12:00:00Z');
const queue = buildSalesPriorityQueue({
  now,
  channelSamples: [
    {
      id: 'msg1',
      companyId: 'c1',
      companyName: 'Priority Buyer',
      ownerName: 'Sales A',
      channelLabel: 'WhatsApp',
      intentLabel: '询价',
      statusLabel: 'AI 草稿',
      isOverdue: true,
      ageHours: 37,
      downstreamOutcomes: 1,
      wonRevenue: 0,
      taskConverted: false,
    },
  ],
  salesTasks: [
    {
      id: 'task1',
      title: 'Send PI today',
      priority: 'URGENT',
      dueAt: new Date('2026-07-03T10:00:00Z'),
      company: { id: 'c2', name: 'Task Buyer' },
      owner: { name: 'Sales B', email: 'b@example.com' },
      opportunity: { id: 'o1', title: 'Rangefinder bulk order', amountUSD: 42000, stage: 'NEGOTIATING' },
    },
  ],
  staleOpportunities: [
    {
      ageDays: 18,
      opportunity: {
        id: 'opp1',
        title: 'Stalled defense order',
        amountUSD: 52000,
        stage: 'SPEC_CONFIRMING',
        company: { name: 'Defense Buyer' },
        owner: { name: 'Sales C', email: 'c@example.com' },
      },
    },
  ],
  customerHealthRows: [
    {
      company: { id: 'c3', name: 'Weak Profile Buyer', priorityScore: 82, owner: { name: 'Sales D', email: 'd@example.com' } },
      health: { score: 42, action: '补齐联系人和下一步动作。', shortfalls: ['联系人', '互动'], priorityWeight: 80 },
    },
  ],
  automationRisks: [
    {
      id: 'flow1',
      name: 'Alibaba failed assignment',
      channelLabel: '阿里国际站',
      actionType: '销售提醒',
      reason: '最近 3 次失败',
      weight: 93,
      failedRuns: 3,
      runs: 4,
    },
  ],
  emailTasks: [
    {
      id: 'email-task',
      companyId: 'c4',
      companyName: 'Email Buyer',
      ownerName: 'Sales E',
      status: 'TODO',
      statusLabel: '已逾期',
      isOverdue: true,
      downstreamOutcomes: 0,
      wonRevenue: 0,
      title: 'Reply RFQ email',
      categoryLabel: '询盘',
    },
  ],
  healthTasks: [],
  completionEvidenceEscalations: [
    {
      taskId: 'repair-escalated',
      taskTitle: '补完成证据: Done without evidence',
      companyId: 'c1',
      companyName: 'Priority Buyer',
      ownerName: 'Sales A',
      statusLabel: '已升级',
      ageHours: 28,
      escalatedAt: new Date('2026-07-04T06:00:00Z'),
    },
  ],
});
const ownerReport = buildSalesOwnerPriorityReport(queue.items);
const morningBriefing = buildSalesMorningBriefing(queue.items, ownerReport.rows);
const actionClosure = buildSalesActionClosureReport({
  now,
  items: queue.items,
  tasks: [
    {
      id: 'daily-msg-task',
      title: 'Reply to Priority Buyer',
      status: 'TODO',
      dueAt: new Date('2026-07-03T12:00:00Z'),
      completedAt: null,
      createdAt: new Date('2026-07-03T08:00:00Z'),
      source: 'DAILY_PRIORITY',
      sourceRef: 'priority:MESSAGE_SLA:msg1',
      owner: { name: 'Sales A', email: 'a@example.com' },
      company: { id: 'c1', name: 'Priority Buyer' },
      opportunity: null,
    },
    {
      id: 'task1',
      title: 'Send PI today',
      status: 'DONE',
      dueAt: new Date('2026-07-03T10:00:00Z'),
      completedAt: new Date('2026-07-04T09:00:00Z'),
      createdAt: new Date('2026-07-03T07:00:00Z'),
      source: 'MANUAL',
      sourceRef: null,
      owner: { name: 'Sales B', email: 'b@example.com' },
      company: { id: 'c2', name: 'Task Buyer' },
      opportunity: { id: 'o1', title: 'Rangefinder bulk order', amountUSD: 42000 },
    },
  ],
});
const completionEvidence = buildSalesCompletionEvidenceReport({
  tasks: [
    {
      id: 'done-missing',
      title: 'Done without evidence',
      source: 'DAILY_PRIORITY',
      completedAt: new Date('2026-07-04T08:00:00Z'),
      dueAt: new Date('2026-07-04T10:00:00Z'),
      owner: { name: 'Sales A', email: 'a@example.com' },
      company: { id: 'c1', name: 'Priority Buyer' },
      opportunity: null,
    },
    {
      id: 'done-weak',
      title: 'Done with note only',
      source: 'EMAIL_ACTION_BULK',
      completedAt: new Date('2026-07-04T09:00:00Z'),
      dueAt: new Date('2026-07-04T10:00:00Z'),
      owner: { name: 'Sales B', email: 'b@example.com' },
      company: { id: 'c2', name: 'Task Buyer' },
      opportunity: null,
    },
    {
      id: 'done-strong',
      title: 'Done with outbound and opportunity',
      source: 'OMNIBOX_BULK',
      completedAt: new Date('2026-07-04T10:00:00Z'),
      dueAt: new Date('2026-07-04T10:00:00Z'),
      owner: { name: 'Sales C', email: 'c@example.com' },
      company: { id: 'c3', name: 'Defense Buyer' },
      opportunity: { id: 'opp1', title: 'Stalled defense order', amountUSD: 52000 },
    },
  ],
  followUps: [
    {
      id: 'fu1',
      companyId: 'c2',
      content: 'Completed note only',
      type: 'TASK',
      createdAt: new Date('2026-07-04T09:01:00Z'),
      user: { name: 'Sales B', email: 'b@example.com' },
    },
  ],
  messages: [
    {
      id: 'out1',
      companyId: 'c3',
      direction: 'OUT',
      senderName: 'Sales C',
      originalText: 'Sent quotation to customer',
      translatedText: '已发送报价',
      sentAt: new Date('2026-07-04T10:05:00Z'),
      createdAt: new Date('2026-07-04T10:05:00Z'),
    },
  ],
  opportunities: [
    {
      id: 'opp1',
      companyId: 'c3',
      title: 'Stalled defense order',
      stage: 'QUOTING',
      amountUSD: 52000,
      stageChangedAt: new Date('2026-07-04T10:10:00Z'),
      updatedAt: new Date('2026-07-04T10:10:00Z'),
    },
  ],
});
const completionEvidenceEscalation = buildCompletionEvidenceEscalationReport({
  now,
  escalationNotifications: 4,
  tasks: [
    {
      id: 'repair-escalated',
      title: '补完成证据: Done without evidence',
      status: 'TODO',
      source: 'COMPLETION_EVIDENCE_AUDIT',
      sourceRef: 'completion-evidence:done-missing',
      dueAt: new Date('2026-07-03T08:00:00Z'),
      escalatedAt: new Date('2026-07-04T06:00:00Z'),
      createdAt: new Date('2026-07-03T00:00:00Z'),
      completedAt: null,
      owner: { name: 'Sales A', email: 'a@example.com' },
      company: { id: 'c1', name: 'Priority Buyer' },
    },
    {
      id: 'repair-overdue',
      title: '补完成证据: Done with note only',
      status: 'TODO',
      source: 'COMPLETION_EVIDENCE_AUDIT',
      sourceRef: 'completion-evidence:done-weak',
      dueAt: new Date('2026-07-04T06:00:00Z'),
      escalatedAt: null,
      createdAt: new Date('2026-07-03T12:00:00Z'),
      completedAt: null,
      owner: { name: 'Sales B', email: 'b@example.com' },
      company: { id: 'c2', name: 'Task Buyer' },
    },
    {
      id: 'repair-resolved',
      title: '补完成证据: Done with outbound and opportunity',
      status: 'DONE',
      source: 'COMPLETION_EVIDENCE_AUDIT',
      sourceRef: 'completion-evidence:done-strong',
      dueAt: new Date('2026-07-04T06:00:00Z'),
      escalatedAt: null,
      createdAt: new Date('2026-07-03T12:00:00Z'),
      completedAt: new Date('2026-07-04T11:00:00Z'),
      owner: { name: 'Sales C', email: 'c@example.com' },
      company: { id: 'c3', name: 'Defense Buyer' },
    },
  ],
});

const failures = [];
if (!Array.isArray(queue.items) || queue.items.length < 5) failures.push('priority queue should include cross-module items');
if (queue.urgentCount < 2) failures.push(`urgent count too low: ${queue.urgentCount}`);
if (queue.revenueAtRisk < 90000) failures.push(`revenue at risk too low: ${queue.revenueAtRisk}`);
if (!queue.items.some((item) => item.kind === 'AUTOMATION_RISK')) failures.push('automation risk missing from queue');
if (!queue.items.some((item) => item.kind === 'COMPLETION_EVIDENCE_ESCALATION' && item.kindLabel === '补证据升级')) failures.push('completion evidence escalation missing from queue');
if (!queue.items.some((item) => item.kind === 'MESSAGE_SLA' && item.action.includes('先回复客户'))) failures.push('overdue message action missing');
if (!queue.items.some((item) => item.kind === 'OPPORTUNITY_STALL' && item.href === '/opportunity/opp1')) failures.push('stalled opportunity link missing');
if (!Array.isArray(ownerReport.rows) || ownerReport.rows.length < 5) failures.push('owner priority report should group owners');
if (ownerReport.urgentOwnerCount < 2) failures.push(`urgent owner count too low: ${ownerReport.urgentOwnerCount}`);
if (!ownerReport.rows.some((row) => row.ownerName === 'Sales C' && row.impactUSD >= 52000)) failures.push('owner report should retain stalled opportunity impact');
if (!ownerReport.rows.every((row) => Array.isArray(row.itemIds) && row.itemIds.length === row.itemCount)) failures.push('owner report itemIds missing');
if (!ownerReport.rows.some((row) => row.urgentItemIds.length > 0)) failures.push('owner report urgent itemIds missing');
if (!ownerReport.recommendation.includes('负责人')) failures.push('owner report recommendation missing');
if (!morningBriefing.headline.includes('今日')) failures.push('morning briefing headline missing');
if (morningBriefing.watchOwners.length < 3) failures.push('morning briefing should include top watch owners');
if (morningBriefing.mustDoItems.length !== 3) failures.push('morning briefing should include 3 must-do items');
if (morningBriefing.topItemIds.length !== 3 || morningBriefing.urgentItemIds.length < 2) failures.push('morning briefing bulk ids missing');
if (!morningBriefing.playbook.some((line) => line.includes('晨会') || line.includes('客户消息') || line.includes('商机'))) failures.push('morning briefing playbook missing');
if (!morningBriefing.playbook.some((line) => line.includes('补证据升级'))) failures.push('morning briefing should mention completion evidence escalations');
if (actionClosure.overdueTasks < 1) failures.push('action closure should detect overdue linked task');
if (actionClosure.doneTasks < 1) failures.push('action closure should detect done linked task');
if (actionClosure.missingTasks < 1) failures.push('action closure should detect priority items not converted to tasks');
if (!actionClosure.rows.some((row) => row.statusLabel === '逾期未完成')) failures.push('action closure overdue row missing');
if (completionEvidence.completedTasks !== 3) failures.push('completion evidence should inspect completed tasks');
if (completionEvidence.missingEvidence !== 1) failures.push('completion evidence should detect missing evidence');
if (completionEvidence.weakEvidence !== 1) failures.push('completion evidence should detect note-only evidence');
if (completionEvidence.strongEvidence !== 1) failures.push('completion evidence should detect outbound/stage evidence');
if (!completionEvidence.rows.some((row) => row.statusLabel === '有业务结果')) failures.push('completion evidence strong row missing');
if (completionEvidenceEscalation.totalRepairTasks !== 3) failures.push('completion evidence escalation should inspect repair tasks');
if (completionEvidenceEscalation.openRepairTasks !== 2) failures.push('completion evidence escalation open tasks mismatch');
if (completionEvidenceEscalation.overdueOpenTasks !== 2) failures.push('completion evidence escalation overdue tasks mismatch');
if (completionEvidenceEscalation.escalatedOpenTasks !== 1) failures.push('completion evidence escalation escalated tasks mismatch');
if (completionEvidenceEscalation.resolvedTasks !== 1) failures.push('completion evidence escalation resolved tasks mismatch');
if (!completionEvidenceEscalation.ownerRows.some((row) => row.label === 'Sales A' && row.escalated === 1)) failures.push('completion evidence escalation owner ranking missing');
if (!pageSource.includes('老板每日作战清单')) failures.push('daily priority panel UI missing');
if (!pageSource.includes('老板晨会摘要')) failures.push('morning briefing UI missing');
if (!pageSource.includes('晨会通知处理闭环')) failures.push('morning briefing closure UI missing');
if (!pageSource.includes('buildMorningBriefingClosureReport')) failures.push('morning briefing closure report not wired');
if (!pageSource.includes('超过24h未读')) failures.push('morning briefing stale unread label missing');
if (!pageSource.includes('作战清单执行闭环')) failures.push('action closure UI missing');
if (!pageSource.includes('buildSalesActionClosureReport')) failures.push('action closure report not wired');
if (!pageSource.includes("sourceRef: { in: priorityActionSourceRefs }")) failures.push('action closure does not query priority sourceRefs');
if (!pageSource.includes('任务完成证据链')) failures.push('completion evidence UI missing');
if (!pageSource.includes('buildSalesCompletionEvidenceReport')) failures.push('completion evidence report not wired');
if (!pageSource.includes("direction: 'OUT'") && !pageSource.includes('direction: "OUT"')) failures.push('completion evidence should query outbound messages');
if (!pageSource.includes('stageChangedAt: { gte: completionWindowStart }')) failures.push('completion evidence should query opportunity stage changes');
if (!pageSource.includes('/api/sales-command/completion-evidence')) failures.push('completion evidence action route not wired');
if (!pageSource.includes('批量补证据') || !pageSource.includes('补证据')) failures.push('completion evidence repair buttons missing');
if (!pageSource.includes('CompletionEvidenceResultBanner')) failures.push('completion evidence result banner missing');
if (!pageSource.includes('补证据升级审计')) failures.push('completion evidence escalation UI missing');
if (!pageSource.includes('buildCompletionEvidenceEscalationReport')) failures.push('completion evidence escalation report not wired');
if (!pageSource.includes('补证据任务逾期升级')) failures.push('completion evidence escalation notifications not queried');
if (!pageSource.includes('CompletionEvidenceEscalationPanel')) failures.push('completion evidence escalation panel not rendered');
if (!pageSource.includes('处理晨会前三项') || !pageSource.includes('一键处理全部高危')) failures.push('morning briefing bulk buttons missing');
if (!pageSource.includes('通知前三项负责人') || !pageSource.includes('通知全部高危负责人')) failures.push('morning briefing notify buttons missing');
if (!pageSource.includes('MorningNotifyResultBanner')) failures.push('morning briefing notify result banner missing');
if (!pageSource.includes('/api/sales-command/morning-briefing')) failures.push('morning briefing notify route not wired');
if (!pageSource.includes('buildSalesMorningBriefing')) failures.push('sales command does not build morning briefing');
if (!pageSource.includes('负责人每日战报')) failures.push('owner priority panel UI missing');
if (!pageSource.includes('处理此负责人') || !pageSource.includes('只处理高危')) failures.push('owner priority bulk buttons missing');
if (!pageSource.includes('buildSalesPriorityQueue')) failures.push('sales command does not build priority queue');
if (!pageSource.includes('completionEvidenceEscalations: completionEscalation.rows')) failures.push('sales command priority queue missing completion evidence escalations');
if (!pageSource.includes('buildSalesOwnerPriorityReport')) failures.push('sales command does not build owner priority report');
if (!pageSource.includes('buildAutomationFunnelInsights')) failures.push('automation risk feed not wired into sales command');
if (!pageSource.includes('priorityQueue')) failures.push('priority queue variable missing from sales command');
if (!pageSource.includes('/api/sales-command/priority-action')) failures.push('daily priority action form missing');
if (!pageSource.includes('批量处理前5') || !pageSource.includes('批量处理高危')) failures.push('daily priority bulk action buttons missing');
if (!pageSource.includes('name="itemIds"')) failures.push('daily priority bulk itemIds input missing');
if (!pageSource.includes('priorityActionLabel')) failures.push('priority action labels missing');
if (!pageSource.includes('PriorityActionResultBanner')) failures.push('priority action result banner missing');
if (!pageSource.includes('作战清单批量动作已执行')) failures.push('daily priority bulk result label missing');
if (!actionRouteSource.includes('export async function POST')) failures.push('priority action POST route missing');
if (!actionRouteSource.includes('parsePriorityItemIds')) failures.push('priority action batch parser missing');
if (!actionRouteSource.includes("form.get('itemIds')") && !actionRouteSource.includes("form.getAll('itemIds')")) failures.push('priority action itemIds support missing');
if (!actionRouteSource.includes('source: SOURCE') || !actionRouteSource.includes("const SOURCE = 'DAILY_PRIORITY'")) failures.push('daily priority task source missing');
if (!actionRouteSource.includes('createMessageTask') || !actionRouteSource.includes('createOpportunityTask') || !actionRouteSource.includes('notifyAutomationRisk')) failures.push('priority action handlers missing');
if (!actionRouteSource.includes('priority:${itemId}')) failures.push('priority idempotency sourceRef missing');
if (!morningRouteSource.includes('export async function POST')) failures.push('morning briefing POST route missing');
if (!morningRouteSource.includes('sendMorningBriefingNotifications')) failures.push('morning briefing route should use shared notification helper');
if (!morningRouteSource.includes('morningNotify')) failures.push('morning briefing redirect result missing');
if (!completionEvidenceRouteSource.includes('export async function POST')) failures.push('completion evidence POST route missing');
if (!completionEvidenceRouteSource.includes('createCompletionEvidenceRepairTasks')) failures.push('completion evidence POST route should use shared repair helper');
if (!completionEvidenceCronSource.includes('export async function GET')) failures.push('completion evidence cron GET route missing');
if (!completionEvidenceCronSource.includes('runCompletionEvidenceRepairWatch')) failures.push('completion evidence cron should use shared watch helper');
if (!completionEvidenceCronSource.includes('COMPLETION_EVIDENCE_KEY')) failures.push('completion evidence cron key missing');
if (!completionEvidenceEscalationCronSource.includes('export async function GET')) failures.push('completion evidence escalation cron GET route missing');
if (!completionEvidenceEscalationCronSource.includes('escalateStaleCompletionEvidenceRepairs')) failures.push('completion evidence escalation cron should use shared helper');
if (!completionEvidenceEscalationCronSource.includes('COMPLETION_EVIDENCE_ESCALATION_KEY')) failures.push('completion evidence escalation key missing');
if (!morningWatchSource.includes('buildSalesMorningBriefingFromDatabase')) failures.push('morning briefing database builder missing');
if (!morningWatchSource.includes('sendMorningBriefingNotifications')) failures.push('morning briefing shared notification sender missing');
if (!morningWatchSource.includes('resolveBriefingTarget')) failures.push('morning briefing target resolver missing');
if (!morningWatchSource.includes('buildCompletionEvidenceEscalationReport')) failures.push('morning briefing completion evidence escalation report missing');
if (!morningWatchSource.includes('completionEvidenceEscalationTargets')) failures.push('morning briefing completion evidence escalation targets missing');
if (!morningWatchSource.includes('COMPLETION_EVIDENCE_ESCALATION')) failures.push('morning briefing completion evidence escalation kind missing');
if (!morningWatchSource.includes('groupTargets')) failures.push('morning briefing grouping missing');
if (!morningWatchSource.includes('老板晨会摘要: 今日必须处理')) failures.push('morning briefing notification title missing');
if (!morningWatchSource.includes('createdAt: { gte: input.todayStart }')) failures.push('morning briefing daily dedupe missing');
if (!morningCronSource.includes('export async function GET')) failures.push('morning briefing cron GET route missing');
if (!morningCronSource.includes('buildSalesMorningBriefingFromDatabase')) failures.push('morning briefing cron database builder missing');
if (!morningCronSource.includes('sendMorningBriefingNotifications')) failures.push('morning briefing cron sender missing');
if (!morningCronSource.includes('MORNING_BRIEFING_KEY')) failures.push('morning briefing cron key missing');
if (!morningClosureSource.includes('buildMorningBriefingClosureReport')) failures.push('morning briefing closure builder missing');
if (!morningClosureSource.includes('staleUnread')) failures.push('morning briefing stale unread metric missing');
if (!morningClosureSource.includes('repeatedLineCount')) failures.push('morning briefing repeated line metric missing');
if (!morningClosureSource.includes('超过 24 小时未读')) failures.push('morning briefing closure recommendation missing');
if (!morningClosureSource.includes('停滞商机')) failures.push('morning briefing top risk line priority missing');
if (!actionClosureSource.includes('buildSalesActionClosureReport')) failures.push('action closure builder missing');
if (!actionClosureSource.includes('未转任务')) failures.push('action closure missing task status missing');
if (!actionClosureSource.includes('逾期未完成')) failures.push('action closure overdue status missing');
if (!actionClosureSource.includes('priority:${item.id}')) failures.push('action closure priority sourceRef lookup missing');
if (!completionEvidenceSource.includes('buildSalesCompletionEvidenceReport')) failures.push('completion evidence builder missing');
if (!completionEvidenceSource.includes('缺完成证据')) failures.push('completion evidence missing status missing');
if (!completionEvidenceSource.includes('有业务结果')) failures.push('completion evidence strong status missing');
if (!completionEvidenceSource.includes('商机推进')) failures.push('completion evidence opportunity proof missing');
if (!completionEvidenceSource.includes('allRows: sortedRows')) failures.push('completion evidence full audit rows missing');
if (!completionEvidenceEscalationSource.includes('buildCompletionEvidenceEscalationReport')) failures.push('completion evidence escalation builder missing');
if (!completionEvidenceEscalationSource.includes('ownerRows')) failures.push('completion evidence escalation owner rows missing');
if (!completionEvidenceEscalationSource.includes('companyRows')) failures.push('completion evidence escalation company rows missing');
if (!completionEvidenceEscalationSource.includes('补证据任务已升级')) failures.push('completion evidence escalation recommendation missing');
if (!completionEvidenceEscalationSource.includes('completion-evidence-workbench')) failures.push('completion evidence escalation should deep link to customer workbench');
if (!source.includes("COMPLETION_EVIDENCE_ESCALATION")) failures.push('priority queue completion evidence escalation kind missing');
if (!source.includes('completionEvidenceEscalationItem')) failures.push('priority queue completion evidence escalation item missing');
if (!source.includes('completionTask=${row.taskId}#completion-evidence-workbench')) failures.push('priority queue completion evidence item should deep link to workbench');
if (!source.includes('点名补证据升级任务')) failures.push('priority queue completion evidence escalation playbook missing');
if (!morningWatchSource.includes('completionTask=${task.id}#completion-evidence-workbench')) failures.push('morning briefing completion evidence should deep link to workbench');
if (!customerPageSource.includes('补证据处理台')) failures.push('customer completion evidence workbench missing');
if (!customerPageSource.includes('/api/customers/completion-evidence/resolve')) failures.push('customer completion evidence resolve form missing');
if (!customerPageSource.includes('补证据并完成')) failures.push('customer completion evidence submit button missing');
if (!completionEvidenceResolveRouteSource.includes("REPAIR_SOURCE = 'COMPLETION_EVIDENCE_AUDIT'")) failures.push('completion evidence resolve route should only close repair tasks');
if (!completionEvidenceResolveRouteSource.includes('tx.followUp.create') || !completionEvidenceResolveRouteSource.includes('tx.salesTask.update')) failures.push('completion evidence resolve route should create proof and close task atomically');
if (!completionEvidenceRepairSource.includes("COMPLETION_EVIDENCE_REPAIR_SOURCE = 'COMPLETION_EVIDENCE_AUDIT'")) failures.push('completion evidence shared source missing');
if (!completionEvidenceRepairSource.includes('runCompletionEvidenceRepairWatch')) failures.push('completion evidence watch helper missing');
if (!completionEvidenceRepairSource.includes('escalateStaleCompletionEvidenceRepairs')) failures.push('completion evidence escalation helper missing');
if (!completionEvidenceRepairSource.includes('completionEvidenceSourceRef(task.id)')) failures.push('completion evidence idempotency helper missing');
if (!completionEvidenceRepairSource.includes('任务完成证据待补')) failures.push('completion evidence shared owner notification missing');
if (!completionEvidenceRepairSource.includes('补证据任务逾期升级')) failures.push('completion evidence overdue escalation notification missing');
if (!completionEvidenceRepairSource.includes("evidence.statusLabel === '有业务结果'")) failures.push('completion evidence escalation should skip resolved proof');
if (!completionEvidenceRepairSource.includes('cooldownStart')) failures.push('completion evidence escalation dedupe window missing');
if (!completionEvidenceRepairSource.includes('report.allRows')) failures.push('completion evidence watch should audit all rows');
if (!vercelConfig.crons?.some((cron) => cron.path === '/api/cron/completion-evidence' && cron.schedule === '15 10 * * *')) failures.push('completion evidence Vercel cron missing');
if (!vercelConfig.crons?.some((cron) => cron.path === '/api/cron/completion-evidence-escalations' && cron.schedule === '10 11 * * *')) failures.push('completion evidence escalation Vercel cron missing');

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
} else {
  console.log('sales priority queue smoke passed: cross-module risks sorted and sales command UI wired');
}

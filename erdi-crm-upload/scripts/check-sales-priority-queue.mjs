import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const sourcePath = path.join(process.cwd(), 'lib/sales-priority-queue.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const pageSource = fs.readFileSync(path.join(process.cwd(), 'app/sales-command/page.tsx'), 'utf8');
const actionRouteSource = fs.readFileSync(path.join(process.cwd(), 'app/api/sales-command/priority-action/route.ts'), 'utf8');
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
const { buildSalesOwnerPriorityReport, buildSalesPriorityQueue } = sandbox.module.exports;

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
});
const ownerReport = buildSalesOwnerPriorityReport(queue.items);

const failures = [];
if (!Array.isArray(queue.items) || queue.items.length < 5) failures.push('priority queue should include cross-module items');
if (queue.urgentCount < 2) failures.push(`urgent count too low: ${queue.urgentCount}`);
if (queue.revenueAtRisk < 90000) failures.push(`revenue at risk too low: ${queue.revenueAtRisk}`);
if (!queue.items.some((item) => item.kind === 'AUTOMATION_RISK')) failures.push('automation risk missing from queue');
if (!queue.items.some((item) => item.kind === 'MESSAGE_SLA' && item.action.includes('先回复客户'))) failures.push('overdue message action missing');
if (!queue.items.some((item) => item.kind === 'OPPORTUNITY_STALL' && item.href === '/opportunity/opp1')) failures.push('stalled opportunity link missing');
if (!Array.isArray(ownerReport.rows) || ownerReport.rows.length < 5) failures.push('owner priority report should group owners');
if (ownerReport.urgentOwnerCount < 2) failures.push(`urgent owner count too low: ${ownerReport.urgentOwnerCount}`);
if (!ownerReport.rows.some((row) => row.ownerName === 'Sales C' && row.impactUSD >= 52000)) failures.push('owner report should retain stalled opportunity impact');
if (!ownerReport.recommendation.includes('负责人')) failures.push('owner report recommendation missing');
if (!pageSource.includes('老板每日作战清单')) failures.push('daily priority panel UI missing');
if (!pageSource.includes('负责人每日战报')) failures.push('owner priority panel UI missing');
if (!pageSource.includes('buildSalesPriorityQueue')) failures.push('sales command does not build priority queue');
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

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
} else {
  console.log('sales priority queue smoke passed: cross-module risks sorted and sales command UI wired');
}

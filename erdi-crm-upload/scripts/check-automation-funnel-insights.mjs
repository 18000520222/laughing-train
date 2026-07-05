import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const insightsSource = fs.readFileSync(path.join(process.cwd(), 'lib/automation-insights.ts'), 'utf8');
const pageSource = fs.readFileSync(path.join(process.cwd(), 'app/automation/page.tsx'), 'utf8');
const repairSource = fs.readFileSync(path.join(process.cwd(), 'lib/automation-risk-repair.ts'), 'utf8');
const repairRouteSource = fs.readFileSync(path.join(process.cwd(), 'app/api/automation/risks/repair/route.ts'), 'utf8');

const checks = [
  {
    ok: insightsSource.includes('export function buildAutomationFunnelInsights'),
    message: 'buildAutomationFunnelInsights export missing',
  },
  {
    ok: insightsSource.includes('byChannel') && insightsSource.includes('byAction') && insightsSource.includes('byCondition'),
    message: 'channel/action/condition breakdown missing',
  },
  {
    ok: insightsSource.includes('riskFlows') && insightsSource.includes('assessAutomationFlowRisk'),
    message: 'risk flow queue missing',
  },
  {
    ok: insightsSource.includes('assessAutomationFlowRisk') && insightsSource.includes('repairAction') && insightsSource.includes('automationRiskRepairAdvice'),
    message: 'automation risk repair advice missing',
  },
  {
    ok: insightsSource.includes('buildAutomationNodeDiagnostics') && insightsSource.includes('nodeDiagnostics') && insightsSource.includes("node: 'trigger'") && insightsSource.includes("node: 'condition'") && insightsSource.includes("node: 'action'"),
    message: 'automation node diagnostics missing',
  },
  {
    ok: insightsSource.includes('export function diagnoseAutomationFlowNodes') && insightsSource.includes('return buildAutomationNodeDiagnostics'),
    message: 'selected flow node diagnostics helper missing',
  },
  {
    ok: insightsSource.includes("run.status === 'ACTION_SENT'") && insightsSource.includes("run.status === 'FAILED'") && insightsSource.includes("run.status === 'SKIPPED'"),
    message: 'run status funnel counts missing',
  },
  {
    ok: insightsSource.includes('automationFunnelRecommendation'),
    message: 'automation funnel recommendation missing',
  },
  {
    ok: pageSource.includes('buildAutomationFunnelInsights'),
    message: 'automation page does not load funnel insights',
  },
  {
    ok: pageSource.includes('自动化渠道/动作漏斗'),
    message: 'automation funnel UI section missing',
  },
  {
    ok: pageSource.includes('AutomationFunnelPanel'),
    message: 'automation funnel panel component missing',
  },
  {
    ok: pageSource.includes('funnel.riskFlows'),
    message: 'automation risk flow table missing',
  },
  {
    ok: pageSource.includes('/api/automation/risks/repair') && pageSource.includes('RiskRepairResultBanner') && pageSource.includes('automation-risk-repair'),
    message: 'automation risk repair UI missing',
  },
  {
    ok: pageSource.includes('NodeDiagnostics') && pageSource.includes('nodeDiagnosticClass') && pageSource.includes('row.nodeDiagnostics'),
    message: 'automation node diagnostics UI missing',
  },
  {
    ok: pageSource.includes('diagnoseAutomationFlowNodes(selected)') && pageSource.includes('<FlowCanvas flow={selected} diagnostics={selectedDiagnostics} />'),
    message: 'selected flow diagnostics are not wired into the canvas',
  },
  {
    ok: pageSource.includes('function NodeHealth') && pageSource.includes('canvasNodeStyle') && pageSource.includes('nodeStatusLabel'),
    message: 'automation canvas node health UI missing',
  },
  {
    ok: repairSource.includes('repairAutomationRiskFlow') && repairSource.includes('bulkReplayFailedAutomationRuns') && repairSource.includes('operatorNote'),
    message: 'automation risk repair helper missing',
  },
  {
    ok: repairRouteSource.includes('repairAutomationRiskFlow') && repairRouteSource.includes('riskRepair') && repairRouteSource.includes('303'),
    message: 'automation risk repair route missing',
  },
];

const failures = checks.filter((check) => !check.ok);
const runtimeFailures = runRuntimeChecks();
failures.push(...runtimeFailures.map((message) => ({ message, ok: false })));
if (failures.length > 0) {
  for (const failure of failures) console.error(failure.message);
  process.exitCode = 1;
} else {
  console.log('automation funnel insights smoke passed: channel/action/condition funnel and risk queue wired');
}

function runRuntimeChecks() {
  const runtimeSource = `${insightsSource.replace(
    /import[^\n]+automation';\n/,
    "const CHANNEL_LABEL = { EMAIL: '邮件', ALL: '全渠道' }; const RUN_STATUS_LABEL = {};\n"
  )}\nexports.__result = { assessAutomationFlowRisk, diagnoseAutomationFlowNodes };`;
  const compiled = ts.transpileModule(runtimeSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const sandbox = { exports: {}, console };
  vm.runInNewContext(compiled, sandbox, { filename: 'automation-insights.js' });
  const { assessAutomationFlowRisk, diagnoseAutomationFlowNodes } = sandbox.exports.__result;
  const base = {
    id: 'flow',
    flowCode: 'FLOW',
    name: 'Flow',
    category: 'Test',
    channel: 'EMAIL',
    status: 'ACTIVE',
    triggerType: 'CUSTOMER_MESSAGE',
    conditionType: 'KEYWORD_MATCH',
    actionType: 'ASSIGN_OWNER',
    triggerCount: 0,
    uniqueContactCount: 0,
    lastRunAt: null,
  };
  const cold = assessAutomationFlowRisk({ ...base, runs: [] });
  const skipped = assessAutomationFlowRisk({
    ...base,
    id: 'skipped',
    triggerCount: 5,
    lastRunAt: new Date(),
    runs: Array.from({ length: 5 }, (_, index) => sampleRun(`s${index}`, 'SKIPPED', false)),
  });
  const failed = assessAutomationFlowRisk({
    ...base,
    id: 'failed',
    triggerCount: 1,
    lastRunAt: new Date(),
    runs: [sampleRun('f1', 'FAILED', true)],
  });
  const lowAction = assessAutomationFlowRisk({
    ...base,
    id: 'low-action',
    triggerCount: 5,
    lastRunAt: new Date(),
    runs: Array.from({ length: 5 }, (_, index) => sampleRun(`a${index}`, 'MATCHED', true)),
  });

  const runtimeFailures = [];
  const selectedDiagnostics = diagnoseAutomationFlowNodes({ ...base, runs: [] });
  if (!selectedDiagnostics.some((node) => node.node === 'trigger' && node.status === 'blocked')) runtimeFailures.push('selected flow canvas should diagnose trigger blocked');
  if (!cold?.nodeDiagnostics.some((node) => node.node === 'trigger' && node.status === 'blocked')) runtimeFailures.push('cold flow should diagnose trigger blocked');
  if (!skipped?.nodeDiagnostics.some((node) => node.node === 'condition' && node.status === 'risk')) runtimeFailures.push('high skipped flow should diagnose condition risk');
  if (!failed?.nodeDiagnostics.some((node) => node.node === 'action' && node.status === 'blocked')) runtimeFailures.push('failed flow should diagnose action blocked');
  if (!lowAction?.nodeDiagnostics.some((node) => node.node === 'action' && node.status === 'risk')) runtimeFailures.push('low execution flow should diagnose action risk');
  return runtimeFailures;
}

function sampleRun(id, status, matched) {
  return { id, channel: 'EMAIL', status, matched, createdAt: new Date(), summary: null };
}

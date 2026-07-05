import fs from 'node:fs';
import path from 'node:path';

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
    ok: repairSource.includes('repairAutomationRiskFlow') && repairSource.includes('bulkReplayFailedAutomationRuns') && repairSource.includes('operatorNote'),
    message: 'automation risk repair helper missing',
  },
  {
    ok: repairRouteSource.includes('repairAutomationRiskFlow') && repairRouteSource.includes('riskRepair') && repairRouteSource.includes('303'),
    message: 'automation risk repair route missing',
  },
];

const failures = checks.filter((check) => !check.ok);
if (failures.length > 0) {
  for (const failure of failures) console.error(failure.message);
  process.exitCode = 1;
} else {
  console.log('automation funnel insights smoke passed: channel/action/condition funnel and risk queue wired');
}

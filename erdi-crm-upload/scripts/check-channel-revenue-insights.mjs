import fs from 'node:fs';
import path from 'node:path';

const insightsSource = fs.readFileSync(path.join(process.cwd(), 'lib/channel-revenue-insights.ts'), 'utf8');
const pageSource = fs.readFileSync(path.join(process.cwd(), 'app/sales-command/page.tsx'), 'utf8');

const checks = [
  {
    ok: insightsSource.includes('export function buildChannelMessageRevenueReport'),
    message: 'buildChannelMessageRevenueReport export missing',
  },
  {
    ok: insightsSource.includes('byChannel') && insightsSource.includes('downstreamOutcomes') && insightsSource.includes('influencedRevenue'),
    message: 'channel, downstream, or influenced revenue metrics missing',
  },
  {
    ok: insightsSource.includes("sourceRef?.startsWith('inbox:')") && insightsSource.includes('taskConverted'),
    message: 'inbox task conversion wiring missing',
  },
  {
    ok: insightsSource.includes('overduePending') && insightsSource.includes('slaRate') && insightsSource.includes('avgReplyHours'),
    message: 'reply SLA or overdue metrics missing',
  },
  {
    ok: insightsSource.includes('uniqueOpps') && insightsSource.includes("opp.stage === 'CLOSED_WON'"),
    message: 'unique opportunity revenue attribution missing',
  },
  {
    ok: pageSource.includes('buildChannelMessageRevenueReport'),
    message: 'sales command does not load channel revenue report',
  },
  {
    ok: pageSource.includes('全渠道消息收入闭环'),
    message: 'channel revenue UI section missing',
  },
  {
    ok: pageSource.includes('渠道收入与 SLA') && pageSource.includes('关键消息样本'),
    message: 'channel revenue breakdown or sample UI missing',
  },
  {
    ok: pageSource.includes("sourceRef: { startsWith: 'inbox:' }") && pageSource.includes('OMNIBOX_BULK'),
    message: 'sales task query does not include omnibox inbox task conversion',
  },
];

const failures = checks.filter((check) => !check.ok);
if (failures.length > 0) {
  for (const failure of failures) console.error(failure.message);
  process.exitCode = 1;
} else {
  console.log('channel revenue insights smoke passed: message SLA, task conversion, downstream and revenue attribution wired');
}

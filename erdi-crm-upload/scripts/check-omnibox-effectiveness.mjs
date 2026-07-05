import fs from 'node:fs';
import path from 'node:path';

const insightsSource = fs.readFileSync(path.join(process.cwd(), 'lib/omnibox-insights.ts'), 'utf8');
const pageSource = fs.readFileSync(path.join(process.cwd(), 'app/omnibox/page.tsx'), 'utf8');

const checks = [
  {
    ok: insightsSource.includes('export function buildOmniboxEffectivenessReport'),
    message: 'buildOmniboxEffectivenessReport export missing',
  },
  {
    ok: insightsSource.includes('byChannel') && insightsSource.includes('byIntent') && insightsSource.includes('byOwner'),
    message: 'channel/intent/owner breakdown missing',
  },
  {
    ok: insightsSource.includes("sourceRef?.startsWith('inbox:')") && pageSource.includes("source: 'OMNIBOX_BULK'"),
    message: 'OMNIBOX_BULK task conversion wiring missing',
  },
  {
    ok: insightsSource.includes("message.status === 'REPLIED'") && insightsSource.includes('replyRate') && insightsSource.includes('slaRate'),
    message: 'reply and SLA metrics missing',
  },
  {
    ok: insightsSource.includes('highIntentPending') && insightsSource.includes('draftRate'),
    message: 'high intent or AI draft metrics missing',
  },
  {
    ok: pageSource.includes('buildOmniboxEffectivenessReport'),
    message: 'omnibox page does not load effectiveness report',
  },
  {
    ok: pageSource.includes('全渠道会话效果复盘'),
    message: 'omnibox effectiveness UI section missing',
  },
  {
    ok: pageSource.includes('EffectivenessPanel'),
    message: 'effectiveness panel component missing',
  },
  {
    ok: pageSource.includes('收件箱转任务样本'),
    message: 'task conversion sample UI missing',
  },
];

const failures = checks.filter((check) => !check.ok);
if (failures.length > 0) {
  for (const failure of failures) console.error(failure.message);
  process.exitCode = 1;
} else {
  console.log('omnibox effectiveness smoke passed: reply/SLA, channel/intent/owner, task conversion wired');
}

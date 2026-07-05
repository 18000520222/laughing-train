import fs from 'node:fs';
import path from 'node:path';

const auditSource = fs.readFileSync(path.join(process.cwd(), 'lib/email-audit.ts'), 'utf8');
const salesCommandSource = fs.readFileSync(path.join(process.cwd(), 'app/sales-command/page.tsx'), 'utf8');

const checks = [
  {
    ok: auditSource.includes('export async function buildEmailActionClosureAudit'),
    message: 'buildEmailActionClosureAudit export missing',
  },
  {
    ok: auditSource.includes("source: 'EMAIL_ACTION_BULK'"),
    message: 'email action closure does not read EMAIL_ACTION_BULK tasks',
  },
  {
    ok: auditSource.includes("classificationTags: { has: '已转任务' }"),
    message: 'converted email tag count missing',
  },
  {
    ok: auditSource.includes("classificationTags: { has: '已清理' }"),
    message: 'cleared noise tag count missing',
  },
  {
    ok: auditSource.includes('stageAt >= task.createdAt'),
    message: 'downstream opportunity attribution missing',
  },
  {
    ok: salesCommandSource.includes('buildEmailActionClosureAudit'),
    message: 'sales command does not load email action closure report',
  },
  {
    ok: salesCommandSource.includes('邮件动作闭环复盘'),
    message: 'sales command email action closure panel missing',
  },
  {
    ok: salesCommandSource.includes('emailActionClosure.byCategory'),
    message: 'sales command does not render category breakdown',
  },
  {
    ok: salesCommandSource.includes('emailActionClosure.topTasks'),
    message: 'sales command does not render closure samples',
  },
];

const failures = checks.filter((check) => !check.ok);
if (failures.length > 0) {
  for (const failure of failures) console.error(failure.message);
  process.exitCode = 1;
} else {
  console.log('email action closure smoke passed: report, tags, downstream attribution, UI wired');
}

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const sourcePath = path.join(process.cwd(), 'lib/customer-health.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
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
const { buildCustomerHealthRow, buildCustomerHealthReport } = sandbox.module.exports;

const now = new Date('2026-07-04T12:00:00Z');

const healthyFixture = {
  id: 'healthy',
  name: 'Healthy Buyer',
  customerCode: 'CUST-2026-001',
  type: 'QUOTED',
  country: 'United States',
  industry: 'Defense optics',
  website: 'https://example.com',
  mainProducts: '1535nm laser rangefinder module',
  customerProfile: 'Integrator with clear sample plan',
  nextAction: 'Send PI tomorrow',
  ownerId: 'u1',
  owner: { name: 'Sales A' },
  contacts: [{ email: 'buyer@example.com', phone: '+1 555' }, { email: 'tech@example.com' }],
  opportunities: [{ stage: 'QUOTING', stageChangedAt: '2026-07-01T12:00:00Z', updatedAt: '2026-07-01T12:00:00Z' }],
  followUps: [{ createdAt: '2026-07-03T12:00:00Z' }],
  inboxMessages: [{ direction: 'IN', sentAt: '2026-07-02T12:00:00Z', createdAt: '2026-07-02T12:00:00Z' }],
  salesTasks: [{ dueAt: '2026-07-05T12:00:00Z' }],
  createdAt: '2026-06-01T12:00:00Z',
  updatedAt: '2026-07-03T12:00:00Z',
};

const riskyFixture = {
  id: 'risky',
  name: 'Risky Buyer',
  type: 'INQUIRY',
  contacts: [],
  opportunities: [{ stage: 'NEGOTIATING', stageChangedAt: '2026-06-01T12:00:00Z', updatedAt: '2026-06-01T12:00:00Z' }],
  followUps: [],
  inboxMessages: [],
  salesTasks: [{ dueAt: '2026-07-01T12:00:00Z' }],
  createdAt: '2026-04-01T12:00:00Z',
  updatedAt: '2026-04-01T12:00:00Z',
};

const healthy = buildCustomerHealthRow(healthyFixture, now);
const risky = buildCustomerHealthRow(riskyFixture, now);
const report = buildCustomerHealthReport([healthyFixture, riskyFixture], now);

const failures = [];
if (healthy.score < 75) failures.push(`healthy score too low: ${healthy.score}`);
if (healthy.shortfalls.length > 0) failures.push(`healthy has shortfalls: ${healthy.shortfalls.join(',')}`);
if (risky.score >= 55) failures.push(`risky score too high: ${risky.score}`);
if (risky.hasOwner) failures.push('risky should be unassigned');
if (!risky.shortfalls.includes('资料')) failures.push('risky should flag profile shortfall');
if (!risky.shortfalls.includes('联系人')) failures.push('risky should flag contact shortfall');
if (!risky.shortfalls.includes('停滞')) failures.push('risky should flag stalled opportunity');
if (risky.overdueTaskCount !== 1) failures.push(`risky overdue count mismatch: ${risky.overdueTaskCount}`);
if (report.customerCount !== 2) failures.push(`report customer count mismatch: ${report.customerCount}`);
if (report.staleCount !== 1) failures.push(`report stale count mismatch: ${report.staleCount}`);
if (report.dimensionRows.length !== 5) failures.push(`dimension count mismatch: ${report.dimensionRows.length}`);

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
} else {
  console.log('customer health smoke passed: 2 customers, 5 dimensions');
}

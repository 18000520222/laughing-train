import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

test('production build never mutates the database schema', () => {
  const packageJson = JSON.parse(read('package.json'));
  assert.doesNotMatch(packageJson.scripts.build, /db push|force-reset|accept-data-loss/i);
  assert.match(packageJson.scripts['db:deploy:incremental'], /db execute/);
});

test('manual migrations contain no destructive database operations', () => {
  for (const file of [
    'prisma/manual-migrations/20260715_email_sales_automation.sql',
    'prisma/manual-migrations/20260715_company_crm_foundation.sql',
  ]) {
    const sql = read(file).replace(/^\s*--.*$/gm, '');
    assert.doesNotMatch(sql, /\b(DROP|TRUNCATE)\b|force-reset|accept-data-loss/i, file);
  }
});

test('legacy forgeable role cookies are never trusted', () => {
  const files = [
    'lib/auth.ts',
    'lib/permissions.ts',
    'middleware.ts',
    'app/page.tsx',
    'app/layout.tsx',
  ];
  for (const file of files) {
    assert.doesNotMatch(read(file), /cookies\(\).*auth_(?:role|userId|email)/, file);
  }
});

test('retired bootstrap routes contain no default credentials or sample customer data', () => {
  const content = `${read('app/api/init-db/route.ts')}\n${read('app/api/import-gmail-leads/route.ts')}\n${read('app/api/webhook/mail-inbound/route.ts')}`;
  assert.doesNotMatch(content, /sales666|finance888|erdi123|erdi-import-2026/i);
  assert.match(content, /status:\s*410/g);
});

test('email payment evidence always enters finance review first', () => {
  const content = read('lib/email-sales-automation.ts');
  const paymentFunction = content.slice(content.indexOf('async function upsertEmailPayment'), content.indexOf('async function matchBankAccount'));
  assert.match(paymentFunction, /status:\s*'PENDING'/);
  assert.doesNotMatch(paymentFunction, /status:\s*'CONFIRMED'/);
  assert.match(paymentFunction, /待财务复核/);
});

test('all five trade document routes use the shared immutable renderer', () => {
  for (const route of ['pi', 'ci', 'pl', 'contract', 'customs']) {
    const content = read(`app/${route}/[id]/page.tsx`);
    assert.match(content, /TradeDocumentView/);
    assert.ok(content.length < 2000, `${route} route should remain a thin wrapper`);
  }
  assert.doesNotMatch(read('app/pl/[id]/page.tsx'), /000000000000000000000000/);
});

test('public webhook handlers require signatures, long tokens, or are retired', () => {
  const routes = [
    'app/api/webhooks/meta/route.ts',
    'app/api/whatsapp/webhook/route.ts',
    'app/api/facebook/webhook/route.ts',
    'app/api/alibaba/webhook/route.ts',
    'app/api/shopee/webhook/route.ts',
    'app/api/tracking/webhook/route.ts',
    'app/api/shopline/route.ts',
    'app/api/webhook/route.ts',
  ];
  for (const route of routes) {
    assert.match(read(route), /verifyMetaWebhookSignature|isWebhookTokenAuthorized|verifyShoplineWebhook/, route);
  }
});

test('system service notifications cannot enter the sales lead pipeline', () => {
  const classifier = read('lib/email-classifier.ts');
  const sync = read('lib/email-sync.ts');
  const hygiene = read('lib/email-lead-hygiene.ts');
  assert.match(classifier, /automated-service:/);
  assert.match(classifier, /vercel\.com/);
  assert.match(classifier, /dhl\.com/);
  assert.match(classifier, /carrier-notice:/);
  assert.match(sync, /NOISE_CATEGORIES[^\n]+PLATFORM_ALERT/);
  assert.match(hygiene, /stage:\s*'CLOSED_LOST'/);
  assert.match(hygiene, /processingState:\s*preserveOperationalInbox\s*\?\s*'INGESTED'\s*:\s*'IGNORED'/);
  assert.match(hygiene, /status:\s*'ARCHIVED'/);
  assert.match(hygiene, /preserveOperationalInbox/);
  assert.doesNotMatch(hygiene, /\.delete(?:Many)?\(/);
});

test('AfterShip tracking uses the current versioned API and never counts HTTP errors as success', () => {
  const route = read('app/api/tracking/sync/route.ts');
  const middleware = read('middleware.ts');
  assert.match(route, /tracking\/2026-07/);
  assert.match(route, /'as-api-key'/);
  assert.match(route, /if \(!response\.ok\)/);
  assert.match(route, /failedBatches/);
  assert.doesNotMatch(route, /api\.aftership\.com\/v4/);
  assert.doesNotMatch(route, /'aftership-api-key'/);
  assert.match(middleware, /\/api\/tracking\/sync/);
});

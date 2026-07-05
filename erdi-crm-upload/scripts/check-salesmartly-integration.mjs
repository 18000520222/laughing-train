import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const schema = read('prisma/schema.prisma');
const types = read('lib/channels/types.ts');
const adapter = read('lib/channels/salesmartly.ts');
const registry = read('lib/channels/registry.ts');
const webhookRoute = read('app/api/salesmartly/webhook/route.ts');
const replyRoute = read('app/api/omnibox/reply/route.ts');
const settingsPage = read('app/settings/channels/page.tsx');
const automation = read('lib/automation.ts');
const inbox = read('lib/inbox.ts');
const omnibox = read('app/omnibox/page.tsx');
const revenue = read('lib/channel-revenue-insights.ts');
const middleware = read('middleware.ts');

const checks = [
  {
    ok: schema.includes('salesmartlyWebhookKey') && schema.includes('salesmartlyReplyUrl') && schema.includes('salesmartlyApiKey'),
    message: 'SystemSettings is missing SaleSmartly credentials',
  },
  {
    ok: enumBlock(schema, 'InboxChannel').includes('SALESMARTLY') && enumBlock(schema, 'AutomationChannel').includes('SALESMARTLY'),
    message: 'Prisma channel enums are missing SALESMARTLY',
  },
  {
    ok: types.includes("'SALESMARTLY'"),
    message: 'ChannelType is missing SALESMARTLY',
  },
  {
    ok: adapter.includes("readonly channel = 'SALESMARTLY'") && adapter.includes('parseInbound') && adapter.includes('SALESMARTLY_REPLY_URL') && adapter.includes('stableId'),
    message: 'SaleSmartly adapter parser/send support missing',
  },
  {
    ok: registry.includes('salesmartlyAdapter') && registry.includes('SALESMARTLY: salesmartlyAdapter'),
    message: 'SaleSmartly adapter is not registered',
  },
  {
    ok: webhookRoute.includes('salesmartlyAdapter.parseInbound') && webhookRoute.includes('ingestInbound') && webhookRoute.includes('verifyWebhook') && webhookRoute.includes('markReplied'),
    message: 'SaleSmartly webhook route is not wired to inbox pipeline',
  },
  {
    ok: replyRoute.includes('salesmartlyAdapter') && replyRoute.includes('SALESMARTLY: salesmartlyAdapter'),
    message: 'Omnibox reply route cannot send SaleSmartly replies',
  },
  {
    ok: settingsPage.includes('/api/salesmartly/webhook') && settingsPage.includes('salesmartlyWebhookKey') && settingsPage.includes("byChannel('SALESMARTLY')"),
    message: 'Channel settings page is missing SaleSmartly configuration/health',
  },
  {
    ok: middleware.includes('/api/salesmartly/webhook'),
    message: 'SaleSmartly webhook is not public in middleware',
  },
  {
    ok: automation.includes('SALESMARTLY') && inbox.includes('SaleSmartly') && omnibox.includes('SALESMARTLY') && revenue.includes('SALESMARTLY'),
    message: 'SaleSmartly labels are missing from CRM reports',
  },
];

const failures = checks.filter((check) => !check.ok);
if (failures.length) {
  for (const failure of failures) console.error(failure.message);
  process.exitCode = 1;
} else {
  console.log('salesmartly integration smoke passed: channel enum, webhook, adapter, reply and settings wired');
}

function enumBlock(source, name) {
  const match = source.match(new RegExp(`enum ${name} \\{([\\s\\S]*?)\\}`));
  return match?.[1] || '';
}

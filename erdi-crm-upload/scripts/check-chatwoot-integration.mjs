import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const schema = read('prisma/schema.prisma');
const types = read('lib/channels/types.ts');
const adapter = read('lib/channels/chatwoot.ts');
const registry = read('lib/channels/registry.ts');
const webhookRoute = read('app/api/chatwoot/webhook/route.ts');
const replyRoute = read('app/api/omnibox/reply/route.ts');
const settingsPage = read('app/settings/channels/page.tsx');
const automation = read('lib/automation.ts');
const inbox = read('lib/inbox.ts');
const omnibox = read('app/omnibox/OmniboxClient.tsx') + read('app/omnibox/page.tsx');
const revenue = read('lib/channel-revenue-insights.ts');
const middleware = read('middleware.ts');

const checks = [
  {
    ok: schema.includes('chatwootBaseUrl') && schema.includes('chatwootAccountId') && schema.includes('chatwootApiToken') && schema.includes('chatwootWebhookKey'),
    message: 'SystemSettings is missing Chatwoot credentials',
  },
  {
    ok: enumBlock(schema, 'InboxChannel').includes('CHATWOOT') && enumBlock(schema, 'AutomationChannel').includes('CHATWOOT'),
    message: 'Prisma channel enums are missing CHATWOOT',
  },
  {
    ok: types.includes("'CHATWOOT'"),
    message: 'ChannelType is missing CHATWOOT',
  },
  {
    ok: adapter.includes("readonly channel = 'CHATWOOT'") && adapter.includes('parseInbound') && adapter.includes('CHATWOOT_BASE_URL') && adapter.includes('api_access_token'),
    message: 'Chatwoot adapter parser/send support missing',
  },
  {
    ok: registry.includes('chatwootAdapter') && registry.includes('CHATWOOT: chatwootAdapter'),
    message: 'Chatwoot adapter is not registered',
  },
  {
    ok: webhookRoute.includes('chatwootAdapter.parseInbound') && webhookRoute.includes('ingestInbound') && webhookRoute.includes('verifyWebhook') && webhookRoute.includes('markReplied'),
    message: 'Chatwoot webhook route is not wired to inbox pipeline',
  },
  {
    ok: replyRoute.includes('chatwootAdapter') && replyRoute.includes('CHATWOOT: chatwootAdapter'),
    message: 'Omnibox reply route cannot send Chatwoot replies',
  },
  {
    ok: settingsPage.includes('/api/chatwoot/webhook') && settingsPage.includes('chatwootBaseUrl') && settingsPage.includes("byChannel('CHATWOOT')"),
    message: 'Channel settings page is missing Chatwoot configuration/health',
  },
  {
    ok: middleware.includes('/api/chatwoot/webhook'),
    message: 'Chatwoot webhook is not public in middleware',
  },
  {
    ok: automation.includes('CHATWOOT') && inbox.includes('Chatwoot') && omnibox.includes('CHATWOOT') && revenue.includes('CHATWOOT'),
    message: 'Chatwoot labels are missing from CRM reports',
  },
];

const failures = checks.filter((check) => !check.ok);
if (failures.length) {
  for (const failure of failures) console.error(failure.message);
  process.exitCode = 1;
} else {
  console.log('chatwoot integration smoke passed: channel enum, webhook, adapter, reply and settings wired');
}

function enumBlock(source, name) {
  const match = source.match(new RegExp(`enum ${name} \\{([\\s\\S]*?)\\}`));
  return match?.[1] || '';
}

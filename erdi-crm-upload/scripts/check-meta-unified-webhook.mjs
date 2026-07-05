import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const schema = read('prisma/schema.prisma');
const middleware = read('middleware.ts');
const route = read('app/api/webhooks/meta/route.ts');
const helper = read('lib/meta-webhook.ts');
const channelTypes = read('lib/channels/types.ts');
const omnibox = read('app/omnibox/OmniboxClient.tsx');

const checks = [
  {
    ok: schema.includes('INSTAGRAM') && schema.includes('enum InboxChannel') && schema.includes('enum AutomationChannel'),
    message: 'Prisma schema is missing Instagram channel support',
  },
  {
    ok: middleware.includes('/api/webhooks/'),
    message: 'middleware does not allow unified webhook routes',
  },
  {
    ok: route.includes('verifyMetaWebhook') && route.includes('handleMetaWebhookPayload'),
    message: 'unified Meta webhook route is not wired',
  },
  {
    ok: helper.includes('whatsapp_business_account') && helper.includes('INSTAGRAM') && helper.includes('FACEBOOK') && helper.includes('ERDI_META_CRM_2026'),
    message: 'Meta webhook helper does not dispatch WhatsApp/Facebook/Instagram with the unified token',
  },
  {
    ok: channelTypes.includes("'INSTAGRAM'") && omnibox.includes('INSTAGRAM'),
    message: 'Frontend channel types/labels are missing Instagram',
  },
];

const failures = checks.filter((check) => !check.ok);
if (failures.length) {
  for (const failure of failures) console.error(failure.message);
  process.exitCode = 1;
} else {
  console.log('meta unified webhook smoke passed: Facebook, Instagram, Messenger and WhatsApp are wired');
}

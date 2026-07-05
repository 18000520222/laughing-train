import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const sourcePath = path.join(process.cwd(), 'lib/email-classifier.ts');
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
const { classifyEmail } = sandbox.module.exports;

const cases = [
  {
    name: 'laser rangefinder inquiry',
    expected: 'INQUIRY',
    input: {
      from: 'buyer@example-defense.com',
      subject: 'RFQ for 1535nm laser rangefinder module',
      textBody: 'Please send datasheet and price for sample testing.',
    },
  },
  {
    name: 'quotation request',
    expected: 'QUOTE_PI',
    input: {
      from: 'procurement@opticsbuyer.com',
      subject: 'Quotation request',
      textBody: 'Please quote your best price and proforma invoice for 20 units.',
    },
  },
  {
    name: 'purchase order',
    expected: 'ORDER_PO',
    input: {
      from: 'orders@buyer.com',
      subject: 'Purchase Order PO260715',
      textBody: 'Attached is our official order confirmation.',
    },
  },
  {
    name: 'customs clearance',
    expected: 'CUSTOMS_COMPLIANCE',
    input: {
      from: 'logistics@forwarder.com',
      subject: 'HS code and certificate of origin required',
      textBody: 'Customs clearance needs MSDS and export license information.',
    },
  },
  {
    name: 'shipment tracking',
    expected: 'LOGISTICS',
    input: {
      from: 'agent@forwarder.com',
      subject: 'DHL tracking and pickup',
      textBody: 'Please confirm AWB and delivery address.',
    },
  },
  {
    name: 'security verification',
    expected: 'AUTH_SECURITY',
    input: {
      from: 'security-noreply@google.com',
      subject: 'Your verification code',
      textBody: 'Use this security code to login.',
    },
  },
  {
    name: 'hotel rewards noise is not customs',
    expected: 'MARKETING_NEWSLETTER',
    input: {
      from: '"IHG One Rewards" <IHGOneRewards@mc.ihg.com>',
      subject: 'Yilin, 进阶奖赏等你来享',
      textBody: 'COO, rewards points, refund options, and member benefits are waiting for you.',
    },
  },
  {
    name: 'loyalty sender beats settlement words',
    expected: 'MARKETING_NEWSLETTER',
    input: {
      from: '"IHG One Rewards" <ihgonerewards@points-mail.com>',
      subject: 'Now’s the time to get 100% more points',
      textBody: 'Refund your points and compare member price.',
    },
  },
  {
    name: 'hotel booking notice is not quote',
    expected: 'PLATFORM_ALERT',
    input: {
      from: '"Holiday Inn Express" <reservations@ihg.com>',
      subject: '您在 Holiday Inn Express 成都龙泉驿北智选假日酒店 的预订已更改',
      textBody: 'Your hotel reservation and stay details have changed.',
    },
  },
  {
    name: 'carrier operation guide is not quote',
    expected: 'PLATFORM_ALERT',
    input: {
      from: 'iocs@dhl.com',
      subject: '【DHL】远程取件发件人操作指南',
      textBody: 'DHL sender operation guide and how to arrange pickup.',
    },
  },
  {
    name: 'daily digest is not logistics',
    expected: 'MARKETING_NEWSLETTER',
    input: {
      from: '"Medium Daily Digest" <noreply@medium.com>',
      subject: 'The Beautiful Abstract Structures Known as Finite Groups | Keith McNulty',
      textBody: 'Medium Daily Digest. Delivery to your inbox.',
    },
  },
  {
    name: 'mail delivery failure is platform alert',
    expected: 'PLATFORM_ALERT',
    input: {
      from: '"Mail Delivery Subsystem" <mailer-daemon@googlemail.com>',
      subject: 'Delivery Status Notification (Failure)',
      textBody: 'Your message was undeliverable.',
    },
  },
  {
    name: 'refund down payment',
    expected: 'PAYMENT_FINANCE',
    input: {
      from: 'Ariel <ariel@example-defense.com>',
      subject: 'Refund for down payment for Diode Pump Micro-Optics Module',
      textBody: 'Please arrange the refund for the down payment.',
    },
  },
  {
    name: 'business inquiry beats footer marketing',
    expected: 'INQUIRY',
    input: {
      from: '"Bogdan" <buyer@example.com>',
      subject: 'Re: Response to Your Inquiry about LRF0818C',
      textBody: 'Please confirm the laser rangefinder details. Unsubscribe from footer.',
    },
  },
  {
    name: 'seo spam',
    expected: 'SEO_SPAM',
    input: {
      from: 'seo@example.net',
      subject: 'High DA guest post backlink service',
      textBody: 'Rank higher with dofollow backlinks and more traffic.',
    },
  },
  {
    name: 'internal mail',
    expected: 'INTERNAL',
    input: {
      from: 'sales@erdicn.com',
      subject: 'Internal follow-up',
      textBody: 'Please check this customer.',
    },
  },
];

let failed = 0;
for (const item of cases) {
  const result = classifyEmail(item.input);
  if (result.category !== item.expected) {
    failed++;
    console.error(`${item.name}: expected ${item.expected}, got ${result.category} (${result.categoryReason})`);
  }
}

if (failed > 0) {
  process.exitCode = 1;
} else {
  console.log(`email classifier smoke passed: ${cases.length} cases`);
}

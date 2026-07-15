import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);

function compile(file, aliases = {}) {
  const source = fs.readFileSync(file, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  });
  const exported = {};
  const sandbox = {
    exports: exported,
    module: { exports: exported },
    require: (specifier) => aliases[specifier] || require(specifier),
  };
  vm.runInNewContext(output.outputText, sandbox, { filename: file });
  return sandbox.module.exports;
}

const content = compile(path.join(process.cwd(), 'lib/email-content.ts'));
const automation = compile(path.join(process.cwd(), 'lib/email-sales-automation.ts'), {
  '@/lib/prisma': { prisma: {} },
  '@/lib/customer-code': { ensureCustomerCode: async () => 'CUST-TEST-0001' },
  '@/lib/email-content': content,
});

const cases = [
  {
    name: 'new RFQ is inquiry, not quoted',
    stage: 'INQUIRY',
    input: { direction: 'IN', subject: 'RFQ for 1535nm LRF', textBody: 'Please quote 10 pcs of LRF1535.' },
  },
  {
    name: 'sent PI proves quoted stage',
    stage: 'QUOTED',
    input: { direction: 'OUT', category: 'QUOTE_PI', subject: 'Quotation ERDI-2601', textBody: 'Please find attached our quotation and proforma invoice.' },
  },
  {
    name: 'customer signed contract',
    stage: 'CONTRACT_SENT',
    input: { direction: 'IN', subject: 'Signed contract', textBody: 'Attached is the signed sales contract for 20 units.' },
  },
  {
    name: 'new order PO subject is contract stage',
    stage: 'CONTRACT_SENT',
    input: { direction: 'OUT', subject: 'Re: New order PO260622-1', textBody: 'We are arranging shipping now. Products and services are listed in our signature.' },
    productName: null,
  },
  {
    name: 'confirmed bank payment is won',
    stage: 'DEAL_WON',
    input: { direction: 'IN', subject: 'Payment confirmation', textBody: 'We have made the bank transfer. Payment of USD 12,500 was completed. Reference: ABC12345.' },
    amount: 12500,
  },
  {
    name: 'future payment is not won',
    notStage: 'DEAL_WON',
    input: { direction: 'IN', subject: 'Payment', textBody: 'Please send the PI. Payment will follow soon.' },
  },
  {
    name: 'initiated future wire is not won',
    notStage: 'DEAL_WON',
    input: { direction: 'IN', subject: 'Payment confirmation', textBody: 'A wire payment of USD 9,600 has been initiated and will be sent from our account on Monday.' },
  },
  {
    name: 'scheduled payment is not won',
    notStage: 'DEAL_WON',
    input: { direction: 'IN', subject: 'Re: Payment confirmation', textBody: 'The payment was scheduled to leave our account today. It can take two or three days to be deposited.' },
  },
  {
    name: 'reply subject alone is not payment proof',
    notStage: 'DEAL_WON',
    input: { direction: 'IN', subject: 'Re: Payment Confirmation and Shipping Arrangements', textBody: 'Could you recommend a spare parts supplier after the warranty period?' },
  },
  {
    name: 'reply payment sent subject with logistics body is not won',
    notStage: 'DEAL_WON',
    input: { direction: 'IN', subject: 'Re: Payment Sent', textBody: 'Thank you. I handed the shipping documents to the carrier.\n---------------- 25.11.2024, 14:49, "Sales" <sales@example.com>: Subject: Payment Sent;' },
  },
  {
    name: 'new payment confirmation attachment is won',
    stage: 'DEAL_WON',
    input: { direction: 'IN', subject: 'Payment confirmation for invoice LRF250409 attached', textBody: 'Please see attachment.' },
  },
  {
    name: 'refund is not won',
    stage: null,
    input: { direction: 'IN', subject: 'Refund for down payment', textBody: 'Please arrange the refund for the down payment of USD 2,000.' },
  },
  {
    name: 'quoted history cannot override latest rejection',
    stage: null,
    input: {
      direction: 'IN',
      subject: 'Re: Signed contract',
      textBody: 'We cannot move forward with this project.\n\nOn Monday, sales@erdicn.com wrote:\nPlease find the signed contract and payment confirmation.',
    },
  },
  {
    name: 'outlook quoted payment history is ignored',
    stage: null,
    input: {
      direction: 'IN',
      subject: 'Re: PO shipping address',
      textBody: 'Please use the corrected ship-to address.\n\nFrom: Buyer Name\nSent: Friday, April 3, 2026 8:04 AM\nTo: Sales\nSubject: Re: PO\nPayment made, please ship the order.',
    },
  },
];

let failed = 0;
for (const item of cases) {
  const result = automation.analyzeSalesEmail(item.input);
  if ((Object.hasOwn(item, 'stage') && result.stage !== item.stage) || (item.notStage && result.stage === item.notStage) || (item.amount && result.amount !== item.amount) || (Object.hasOwn(item, 'productName') && result.productName !== item.productName)) {
    failed++;
    console.error(`${item.name}: expected ${item.stage ?? `not ${item.notStage}`}/${item.amount || '-'}, got ${result.stage}/${result.amount || '-'} (${result.reason})`);
  }
}

if (failed) process.exitCode = 1;
else console.log(`email sales automation smoke passed: ${cases.length} cases`);

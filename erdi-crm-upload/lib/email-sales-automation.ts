import { createHash } from 'crypto';
import { prisma } from '@/lib/prisma';
import { ensureCustomerCode } from '@/lib/customer-code';
import { extractEmailAddress, stripQuotedHistory, subjectKey } from '@/lib/email-content';

export type CustomerSalesStage = 'INQUIRY' | 'QUOTED' | 'CONTRACT_SENT' | 'DEAL_WON';

export interface SalesEmailAnalysis {
  stage: CustomerSalesStage | null;
  confidence: number;
  reason: string;
  amount: number | null;
  currency: string | null;
  quantity: number | null;
  unitPrice: number | null;
  productName: string | null;
  paymentMethod: string | null;
  paymentReference: string | null;
  isRefundOrFailure: boolean;
}

interface SalesEmailInput {
  subject?: string | null;
  textBody?: string | null;
  from?: string | null;
  category?: string | null;
  direction?: string | null;
}

const STAGE_RANK: Record<CustomerSalesStage, number> = {
  INQUIRY: 1,
  QUOTED: 2,
  CONTRACT_SENT: 3,
  DEAL_WON: 4,
};

const OPP_STAGE: Record<CustomerSalesStage, 'UNPROCESSED' | 'QUOTING' | 'SPEC_CONFIRMING' | 'CLOSED_WON'> = {
  INQUIRY: 'UNPROCESSED',
  QUOTED: 'QUOTING',
  CONTRACT_SENT: 'SPEC_CONFIRMING',
  DEAL_WON: 'CLOSED_WON',
};

const REFUND_OR_FAILURE = [
  /\brefund(?:ed| request| for)?\b/i,
  /\bwire (?:recall|recalled|return(?:ed)?)\b/i,
  /\bpayment (?:failed|rejected|declined|cancelled|canceled|reversed|returned)\b/i,
  /\bnot (?:yet )?paid\b/i,
  /\bpayment (?:is )?(?:pending|overdue|outstanding)\b/i,
  /\bawaiting (?:your )?payment\b/i,
  /\bpayment (?:will|would|shall|should) (?:follow|be made|be sent)\b/i,
  /\b(?:wire )?payment.{0,80}\b(?:initiated|scheduled)\b/i,
  /\b(?:payment|funds?).{0,80}\bwill (?:be sent|leave|arrive|be deposited)\b/i,
  /\bpayment.{0,100}\bcan take.{0,40}\bdays?.{0,40}\b(?:deposit|credit|arrive)/i,
  /\bneed (?:a |the )?(?:pi|proforma invoice) (?:before|for) payment\b/i,
  /退款|退回|撤回汇款|付款失败|尚未付款|等待付款|待付款/i,
];

const DEAL_REJECTED = [
  /\b(?:cannot|can't|will not|won't|unable to) (?:move|go|proceed) forward\b/i,
  /\b(?:cancel|cancelled|canceled) (?:the )?(?:order|contract|project)\b/i,
  /\b(?:do not|don't) proceed\b/i,
  /\bproject (?:is |has been )?(?:cancelled|canceled|on hold)\b/i,
  /无法继续|不能继续|取消(?:订单|合同|项目)|项目暂停/i,
];

const PAYMENT_CONFIRMED = [
  /\b(?:we|i) (?:have )?(?:made|sent|completed) (?:the )?(?:full |down )?payment\b/i,
  /\bpayment (?:has been |was )?(?:made|sent|completed|received|credited)\b/i,
  /\bfunds? (?:has|have) been (?:received|credited)\b/i,
  /\b(?:bank|wire) transfer (?:has been |was )?(?:made|completed|sent)\b/i,
  /\battached (?:is |please find )?(?:the )?(?:payment|bank|wire).{0,30}(?:receipt|slip|copy|proof)\b/i,
  /\bpayment confirmation\b/i,
  /已付款|付款完成|款项已到账|已经汇款|汇款凭证|付款水单|银行水单/i,
];

const CONTRACT_CONFIRMED = [
  /\b(?:signed|executed) (?:sales )?(?:contract|agreement)\b/i,
  /\b(?:contract|agreement) (?:is |has been )?(?:signed|executed)\b/i,
  /\battached.{0,40}(?:signed contract|purchase order|\bpo\b)/i,
  /\bpurchase order\b/i,
  /\bnew order\b/i,
  /\bpo\d{4,}\b/i,
  /\bpo\s*(?:no\.?|number|#|:)\s*[a-z0-9-]{3,}/i,
  /\bofficial order\b/i,
  /\b(?:place|confirm|proceed with) (?:the |this )?order\b/i,
  /已签合同|合同已签|采购订单|正式订单|确认下单/i,
];

const QUOTE_ACKNOWLEDGED = [
  /\b(?:received|reviewed|thank(?:s| you) for) (?:your |the )?(?:quotation|quote|pi|proforma invoice)\b/i,
  /\b(?:your|the) (?:quotation|quote|price) (?:is|was|looks|seems)\b/i,
  /\bprice (?:is|was) (?:too |much )?(?:high|expensive|acceptable|competitive)\b/i,
  /\brevised (?:quotation|quote|pi)\b/i,
  /\bquotation\s*(?:no\.?|#)\s*[a-z0-9-]{3,}/i,
  /已收到.{0,10}(?:报价|形式发票|PI)|贵司报价|价格太高|修改报价/i,
];

const OUTBOUND_QUOTE = [
  /\b(?:please find|attached is|attached please find).{0,50}(?:quotation|quote|pi|proforma invoice)\b/i,
  /\bwe (?:are pleased to|would like to) (?:quote|offer)\b/i,
  /\bour (?:quotation|quote|commercial offer)\b/i,
  /随附.{0,20}(?:报价|形式发票)|请查收.{0,20}(?:报价|PI|形式发票)/i,
];

const OUTBOUND_CONTRACT = [
  /\b(?:sales )?(?:contract|agreement)\b/i,
  /\b(?:please find|attached is|attached please find).{0,50}(?:sales )?(?:contract|agreement)\b/i,
  /\b(?:contract|agreement).{0,40}(?:for signature|to sign)\b/i,
  /随附.{0,20}合同|请查收.{0,20}合同/i,
];

const INQUIRY_SIGNAL = [
  /\b(?:please|kindly|could you|can you) (?:send|provide|quote|advise)/i,
  /\b(?:request for quotation|rfq|inquiry|enquiry)\b/i,
  /\b(?:need|looking for|interested in).{0,80}(?:laser|rangefinder|lrf|module|product|sample)/i,
  /询盘|请报价|寻求报价|需要.{0,20}(?:测距|激光|模块|样品)/i,
];

export function analyzeSalesEmail(input: SalesEmailInput): SalesEmailAnalysis {
  const latestBody = stripQuotedHistory(String(input.textBody || ''));
  const subject = String(input.subject || '');
  const text = `${subject}\n${latestBody}`.replace(/\s+/g, ' ').trim();
  const isRefundOrFailure = REFUND_OR_FAILURE.some((pattern) => pattern.test(text));
  const isDealRejected = DEAL_REJECTED.some((pattern) => pattern.test(text));
  const amountInfo = extractAmount(text);
  const quantity = extractQuantity(text);
  const unitPrice = extractUnitPrice(text);
  const productName = extractProductName(`${subject}\n${latestBody}`);
  const paymentMethod = extractPaymentMethod(text);
  const paymentReference = extractPaymentReference(text);

  const base = {
    amount: amountInfo.amount,
    currency: amountInfo.currency,
    quantity,
    unitPrice,
    productName,
    paymentMethod,
    paymentReference,
    isRefundOrFailure,
  };

  if (isDealRejected) {
    return { ...base, stage: null, confidence: 95, reason: 'deal-rejected-or-cancelled' };
  }

  if (input.direction !== 'OUT' && !isRefundOrFailure && PAYMENT_CONFIRMED.some((pattern) => pattern.test(text))) {
    return { ...base, stage: 'DEAL_WON', confidence: 96, reason: 'confirmed-payment' };
  }
  if (input.direction === 'OUT' && OUTBOUND_CONTRACT.some((pattern) => pattern.test(text))) {
    return { ...base, stage: 'CONTRACT_SENT', confidence: 91, reason: 'outbound-contract-sent' };
  }
  if (CONTRACT_CONFIRMED.some((pattern) => pattern.test(text))) {
    return { ...base, stage: 'CONTRACT_SENT', confidence: 93, reason: 'signed-contract-or-order' };
  }
  const outboundQuoteSubject = /\b(?:quotation|quote|proforma invoice)\b|\bPI\s*[-#: ]?\s*[A-Z0-9-]{3,}/i.test(subject);
  if (input.direction === 'OUT' && (outboundQuoteSubject || OUTBOUND_QUOTE.some((pattern) => pattern.test(text)) || input.category === 'QUOTE_PI')) {
    return { ...base, stage: 'QUOTED', confidence: 91, reason: 'outbound-quote-sent' };
  }
  if (QUOTE_ACKNOWLEDGED.some((pattern) => pattern.test(text))) {
    return { ...base, stage: 'QUOTED', confidence: 88, reason: 'quote-acknowledged' };
  }
  if (INQUIRY_SIGNAL.some((pattern) => pattern.test(text)) || input.category === 'INQUIRY') {
    return { ...base, stage: 'INQUIRY', confidence: 84, reason: 'inquiry-request' };
  }

  return {
    ...base,
    stage: null,
    confidence: isRefundOrFailure ? 92 : 25,
    reason: isRefundOrFailure ? 'refund-or-unconfirmed-payment' : 'no-strong-sales-signal',
  };
}

export async function processEmailSalesAutomation(emailMessageId: string) {
  const email = await prisma.emailMessage.findUnique({ where: { id: emailMessageId } });
  if (!email) return { processed: false, reason: 'email-not-found' };
  if (email.salesProcessedAt) return { processed: false, reason: 'already-processed' };

  const analysis = analyzeSalesEmail(email);
  if (!analysis.stage) {
    await prisma.emailMessage.update({
      where: { id: email.id },
      data: { salesProcessedAt: new Date() },
    });
    return { processed: false, reason: analysis.reason, analysis };
  }

  const senderEmail = email.direction === 'OUT'
    ? extractEmailAddress(email.to)
    : extractCustomerEmail(email.from, email.textBody || '');
  if (!senderEmail) return { processed: false, reason: 'no-customer-email', analysis };

  const contact = await prisma.contact.findFirst({
    where: {
      OR: [
        { emailNormalized: senderEmail },
        { email: { equals: senderEmail, mode: 'insensitive' } },
      ],
    },
    include: { company: true },
  });
  if (!contact?.company) return { processed: false, reason: 'customer-not-found', analysis };

  const company = contact.company;
  const customerCode = company.customerCode || (await ensureCustomerCode());
  const opportunityCode = buildOpportunityCode(senderEmail, email.subject || '');
  const currentOpp = await prisma.opportunity.findUnique({ where: { opportunityCode } });
  const desiredOppStage = OPP_STAGE[analysis.stage];
  const amountUSD = analysis.currency === 'USD' ? analysis.amount : null;
  const amountCNY = analysis.currency === 'CNY' ? analysis.amount : null;
  const shouldAdvanceOpp = !currentOpp || oppStageRank(desiredOppStage) > oppStageRank(currentOpp.stage);

  const opportunity = await prisma.opportunity.upsert({
    where: { opportunityCode },
    update: {
      title: email.subject || currentOpp?.title || `邮件商机 - ${company.name}`,
      description: buildOpportunityDescription(email, analysis),
      amountUSD: amountUSD ?? currentOpp?.amountUSD,
      amountCNY: amountCNY ?? currentOpp?.amountCNY,
      stage: shouldAdvanceOpp ? desiredOppStage : currentOpp?.stage,
      stageChangedAt: shouldAdvanceOpp ? email.date : currentOpp?.stageChangedAt,
      nextStep: nextStepForStage(analysis.stage),
    },
    create: {
      opportunityCode,
      title: email.subject || `邮件商机 - ${company.name}`,
      description: buildOpportunityDescription(email, analysis),
      amountUSD,
      amountCNY,
      stage: desiredOppStage,
      stageChangedAt: email.date,
      nextStep: nextStepForStage(analysis.stage),
      companyId: company.id,
      ownerId: company.ownerId,
    },
  });

  if (shouldAdvanceOpp) {
    await prisma.opportunityStageHistory.create({
      data: {
        opportunityId: opportunity.id,
        fromStage: currentOpp?.stage,
        toStage: desiredOppStage,
        amountUSD,
        changedAt: email.date,
        note: `邮件自动识别: ${analysis.reason}; 置信度 ${analysis.confidence}`,
      },
    });
  }

  if (analysis.productName || analysis.quantity || analysis.unitPrice) {
    await upsertEmailLineItem(opportunity.id, email.id, analysis);
  }

  if (analysis.stage === 'DEAL_WON') {
    await upsertEmailPayment(company.id, opportunity.id, email.id, analysis, email.date, email.textBody || '');
  }

  const targetType = shouldUpgradeCustomer(company.type, analysis.stage) ? analysis.stage : company.type;
  await prisma.company.update({
    where: { id: company.id },
    data: {
      customerCode,
      type: targetType as any,
      mainProducts: mergeProduct(company.mainProducts, analysis.productName),
      nextAction: nextStepForStage(analysis.stage),
    },
  });
  await prisma.contact.update({
    where: { id: contact.id },
    data: { emailNormalized: senderEmail, email: senderEmail },
  }).catch(() => undefined);
  await prisma.emailMessage.update({ where: { id: email.id }, data: { salesProcessedAt: new Date() } });

  return { processed: true, companyId: company.id, opportunityId: opportunity.id, stage: analysis.stage, analysis };
}

export async function scanHistoricalSalesEmails(options: { apply: boolean; limit?: number; before?: Date }) {
  const limit = Math.max(1, Math.min(options.limit || 500, 5000));
  const emails = await prisma.emailMessage.findMany({
    where: {
      date: options.before ? { lte: options.before } : undefined,
      OR: [
        { direction: 'OUT' },
        { category: { in: ['INQUIRY', 'QUOTE_PI', 'ORDER_PO', 'PAYMENT_FINANCE', 'OTHER'] } },
      ],
    },
    orderBy: { date: 'asc' },
    take: limit,
  });

  const counts: Record<string, number> = { NONE: 0 };
  let confirmedWonAmountUSD = 0;
  const amountByStageUSD: Record<string, number> = {};
  const samples: Array<Record<string, unknown>> = [];
  let applied = 0;
  for (const email of emails) {
    const analysis = analyzeSalesEmail(email);
    const key = analysis.stage || 'NONE';
    counts[key] = (counts[key] || 0) + 1;
    if (analysis.stage && analysis.currency === 'USD' && analysis.amount) {
      amountByStageUSD[analysis.stage] = (amountByStageUSD[analysis.stage] || 0) + analysis.amount;
      if (analysis.stage === 'DEAL_WON') confirmedWonAmountUSD += analysis.amount;
    }
    if (analysis.stage && samples.length < 30) {
      samples.push({ id: email.id, date: email.date, subject: email.subject, stage: analysis.stage, confidence: analysis.confidence, amount: analysis.amount, currency: analysis.currency, reason: analysis.reason });
    }
    if (options.apply && analysis.stage) {
      const result = await processEmailSalesAutomation(email.id);
      if (result.processed) applied++;
    }
  }
  return { scanned: emails.length, counts, amountByStageUSD, confirmedWonAmountUSD, applied, dryRun: !options.apply, samples };
}

function extractCustomerEmail(from: string, body: string): string {
  const direct = extractEmailAddress(from);
  const domain = direct.split('@')[1] || '';
  const platformDomains = ['myshopline.com', 'made-in-china.com', 'alibaba.com'];
  if (direct && !platformDomains.some((d) => domain === d || domain.endsWith(`.${d}`))) return direct;

  const embedded = body.match(/(?:customer\s*)?(?:e-?mail|邮箱)\s*[:：]\s*([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i);
  return (embedded?.[1] || '').toLowerCase();
}

function buildOpportunityCode(email: string, subject: string): string {
  const hash = createHash('sha1').update(`${email}|${subjectKey(subject)}`).digest('hex').slice(0, 14).toUpperCase();
  return `EMAIL-${hash}`;
}

function shouldUpgradeCustomer(current: string, desired: CustomerSalesStage) {
  const normalized = current === 'NEW' || current === 'PROSPECT' ? 'INQUIRY' : current === 'EXISTING' || current === 'KEY_ACCOUNT' ? 'DEAL_WON' : current;
  const currentRank = STAGE_RANK[normalized as CustomerSalesStage] || 0;
  return STAGE_RANK[desired] > currentRank && current !== 'LOST';
}

function oppStageRank(stage: string) {
  return { UNPROCESSED: 1, REPLIED: 2, QUOTING: 3, NEGOTIATING: 4, SPEC_CONFIRMING: 5, CLOSED_WON: 6, CLOSED_LOST: 99 }[stage] || 0;
}

function nextStepForStage(stage: CustomerSalesStage) {
  if (stage === 'DEAL_WON') return '核对收款、备货和出运资料';
  if (stage === 'CONTRACT_SENT') return '核对合同/PO并跟进付款';
  if (stage === 'QUOTED') return '跟进报价反馈和成交条件';
  return '确认产品规格、数量和报价要求';
}

function buildOpportunityDescription(email: { id: string; date: Date; from: string }, analysis: SalesEmailAnalysis) {
  const fields = [
    `来源邮件: ${email.id}`,
    `邮件日期: ${email.date.toISOString()}`,
    `识别依据: ${analysis.reason} (${analysis.confidence})`,
    analysis.productName ? `产品: ${analysis.productName}` : null,
    analysis.quantity ? `数量: ${analysis.quantity}` : null,
  ].filter(Boolean);
  return fields.join('\n');
}

async function upsertEmailLineItem(opportunityId: string, emailId: string, analysis: SalesEmailAnalysis) {
  const sourceRef = `email:${emailId}`;
  const product = analysis.productName
    ? await prisma.product.findFirst({
        where: {
          OR: [
            { name: { contains: analysis.productName, mode: 'insensitive' } },
            { enName: { contains: analysis.productName, mode: 'insensitive' } },
            { sku: { equals: analysis.productName, mode: 'insensitive' } },
          ],
        },
        select: { id: true, name: true },
      })
    : null;
  const existing = await prisma.opportunityLineItem.findFirst({ where: { opportunityId, sourceRef } });
  const data = {
    productId: product?.id,
    productName: analysis.productName || product?.name || '邮件中未明确产品',
    quantity: analysis.quantity || 1,
    unitPrice: analysis.unitPrice,
    currency: analysis.currency || 'USD',
    totalAmount: analysis.amount || (analysis.unitPrice && analysis.quantity ? analysis.unitPrice * analysis.quantity : null),
    source: 'EMAIL',
    sourceRef,
  };
  if (existing) await prisma.opportunityLineItem.update({ where: { id: existing.id }, data });
  else await prisma.opportunityLineItem.create({ data: { opportunityId, ...data } });
}

async function upsertEmailPayment(companyId: string, opportunityId: string, emailId: string, analysis: SalesEmailAnalysis, paidAt: Date, body: string) {
  const bankAccountId = await matchBankAccount(body);
  await prisma.paymentRecord.upsert({
    where: { sourceRef: `email:${emailId}` },
    update: {
      amount: analysis.amount,
      currency: analysis.currency || 'USD',
      status: 'CONFIRMED',
      method: analysis.paymentMethod,
      reference: analysis.paymentReference,
      paidAt,
      bankAccountId,
    },
    create: {
      companyId,
      opportunityId,
      emailMessageId: emailId,
      bankAccountId,
      amount: analysis.amount,
      currency: analysis.currency || 'USD',
      status: 'CONFIRMED',
      method: analysis.paymentMethod,
      reference: analysis.paymentReference,
      paidAt,
      source: 'EMAIL',
      sourceRef: `email:${emailId}`,
      note: `邮件自动识别: ${analysis.reason}`,
    },
  });
}

async function matchBankAccount(text: string) {
  const accounts = await prisma.bankAccount.findMany({ where: { isActive: true } });
  const normalized = text.toLowerCase().replace(/\s+/g, '');
  for (const account of accounts) {
    const candidates = [account.bankName, account.swift, account.accountNo?.slice(-4)].filter(Boolean) as string[];
    if (candidates.some((value) => value.length >= 4 && normalized.includes(value.toLowerCase().replace(/\s+/g, '')))) return account.id;
  }
  return null;
}

function extractAmount(text: string) {
  const patterns = [
    /(?:grand\s+total|total\s+amount|amount\s+(?:paid|received)|payment\s+of)\s*[:：]?\s*(USD|US\$|\$|EUR|€|CNY|RMB|¥)\s*([\d,]+(?:\.\d{1,2})?)/i,
    /(USD|US\$|\$|EUR|€|CNY|RMB|¥)\s*([\d,]+(?:\.\d{1,2})?)/i,
    /([\d,]+(?:\.\d{1,2})?)\s*(USD|EUR|CNY|RMB)\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const currencyToken = /\d/.test(match[1]) ? match[2] : match[1];
    const amountToken = /\d/.test(match[1]) ? match[1] : match[2];
    const amount = Number(amountToken.replace(/,/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) continue;
    return { amount, currency: normalizeCurrency(currencyToken) };
  }
  return { amount: null, currency: null };
}

function extractUnitPrice(text: string) {
  const match = text.match(/(?:unit\s+price|price\s+per\s+(?:piece|unit)|单价)\s*[:：]?\s*(?:USD|US\$|\$|EUR|€|CNY|RMB|¥)?\s*([\d,]+(?:\.\d{1,2})?)/i);
  const value = match ? Number(match[1].replace(/,/g, '')) : NaN;
  return Number.isFinite(value) && value > 0 ? value : null;
}

function extractQuantity(text: string) {
  const match = text.match(/(?:qty|quantity|数量)\s*[:：]?\s*(\d+(?:\.\d+)?)|\b(\d+(?:\.\d+)?)\s*(?:pcs?|pieces?|units?|sets?|台|套|个)\b/i);
  const value = Number(match?.[1] || match?.[2]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function extractProductName(text: string) {
  const explicit = text.match(/(?:^|\n)\s*(?:product(?:\s+name)?|model|item|产品(?:名称)?|型号)\s*[:：#]\s*([^\n\r]{2,120})/im);
  if (explicit?.[1]) return explicit[1].trim().slice(0, 120);
  const known = text.match(/\b(?:ERDI[- ]?)?(?:LRF|ELRF|LRM)[- ]?[A-Z0-9-]{2,}\b|\b(?:905|1064|1535)\s*nm\s+(?:laser\s+)?(?:rangefinder|module|lrf)\b/i);
  return known?.[0]?.trim().slice(0, 120) || null;
}

function extractPaymentMethod(text: string) {
  if (/\b(?:wire|bank) transfer\b|电汇|银行转账/i.test(text)) return 'BANK_TRANSFER';
  if (/\bpaypal\b/i.test(text)) return 'PAYPAL';
  if (/\b(?:credit|debit) card\b|信用卡/i.test(text)) return 'CARD';
  if (/\b(?:letter of credit|l\/c)\b|信用证/i.test(text)) return 'LETTER_OF_CREDIT';
  return null;
}

function extractPaymentReference(text: string) {
  const match = text.match(/(?:payment|transaction|transfer|remittance)\s*(?:reference|ref\.?|no\.?|id|#)\s*[:：#]?\s*([a-z0-9-]{5,40})/i);
  return match?.[1] || null;
}

function normalizeCurrency(value: string) {
  const token = value.toUpperCase();
  if (token === '€' || token === 'EUR') return 'EUR';
  if (token === '¥' || token === 'RMB' || token === 'CNY') return 'CNY';
  return 'USD';
}

function mergeProduct(existing: string | null, product: string | null) {
  if (!product) return existing;
  if (!existing) return product;
  if (existing.toLowerCase().includes(product.toLowerCase())) return existing;
  return `${existing}\n${product}`;
}

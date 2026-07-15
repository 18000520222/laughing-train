import { Prisma, TradeDocumentType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { SessionPayload } from '@/lib/auth';
import { opportunityAccessWhere } from '@/lib/data-access';

type JsonRecord = Record<string, unknown>;

export type TradeDocumentItem = {
  sku: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  currency: string;
  hsCode: string;
  origin: string;
  unit: string;
  material: string;
  usage: string;
  customsCondition: string;
};

export type TradeDocumentSnapshot = {
  schemaVersion: 1;
  type: TradeDocumentType;
  documentNumber: string;
  issuedAt: string;
  version: number;
  opportunity: {
    id: string;
    code: string;
    title: string;
    stage: string;
  };
  seller: {
    companyName: string;
    email: string;
  };
  buyer: {
    companyName: string;
    customerCode: string;
    contactName: string;
    email: string;
    phone: string;
    country: string;
  };
  items: TradeDocumentItem[];
  currency: string;
  subtotal: number;
  shippingAmount: number;
  taxAmount: number;
  totalAmount: number;
  payment: {
    status: string;
    method: string;
    reference: string;
    paidAt: string;
  };
  bank: {
    label: string;
    bankName: string;
    accountNo: string;
    swift: string;
    beneficiary: string;
    bankAddress: string;
  };
  shipment: {
    carrier: string;
    trackingNumber: string;
    packages: number | null;
    grossWeightKg: number | null;
    netWeightKg: number | null;
    lengthCm: number | null;
    widthCm: number | null;
    heightCm: number | null;
    incoterm: string;
    originCountry: string;
    shippingAddress: unknown;
    notes: string;
  };
};

export const TRADE_DOCUMENT_LABELS: Record<TradeDocumentType, string> = {
  PI: 'PROFORMA INVOICE',
  CI: 'COMMERCIAL INVOICE',
  PL: 'PACKING LIST',
  CONTRACT: 'SALES CONTRACT',
  CUSTOMS: 'CUSTOMS DECLARATION ELEMENTS',
};

export const TRADE_DOCUMENT_ROUTES: Record<TradeDocumentType, string> = {
  PI: 'pi',
  CI: 'ci',
  PL: 'pl',
  CONTRACT: 'contract',
  CUSTOMS: 'customs',
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function legacyItems(value: unknown): TradeDocumentItem[] {
  const items = Array.isArray(value) ? value : [];
  return items.map((entry) => {
    const item = asRecord(entry);
    const quantity = Math.max(0, numberValue(item.quantity, 1));
    const unitPrice = numberValue(item.unitPrice ?? item.price);
    return {
      sku: text(item.sku),
      description: text(item.title || item.description),
      quantity,
      unitPrice,
      amount: numberValue(item.amount, quantity * unitPrice),
      currency: text(item.currency),
      hsCode: text(item.hsCode),
      origin: text(item.origin || item.originCountry),
      unit: text(item.unit),
      material: text(item.material),
      usage: text(item.usage),
      customsCondition: text(item.customsCondition),
    };
  }).filter((item) => item.description && item.quantity > 0);
}

function documentNumber(type: TradeDocumentType, opportunityCode: string, opportunityId: string, version: number, at: Date) {
  const date = at.toISOString().slice(0, 10).replaceAll('-', '');
  const code = (opportunityCode || opportunityId.slice(0, 8)).replace(/[^A-Za-z0-9]/g, '').slice(-16).toUpperCase();
  const prefix = type === 'CONTRACT' ? 'SC' : type === 'CUSTOMS' ? 'CD' : type;
  return `${prefix}-${date}-${code}-V${version}`;
}

export function canIssueTradeDocument(session: SessionPayload, type: TradeDocumentType): boolean {
  if (session.role === 'SUPER_ADMIN' || session.role === 'ADMIN') return true;
  if (type === 'PI' || type === 'CONTRACT') return session.role === 'SALES' || session.role === 'FINANCE' || session.role === 'DOCUMENT';
  return session.role === 'FINANCE' || session.role === 'DOCUMENT' || session.role === 'OPERATIONS';
}

export function validateTradeDocument(snapshot: TradeDocumentSnapshot): string[] {
  const errors: string[] = [];
  if (!snapshot.buyer.companyName) errors.push('客户公司名称不能为空');
  if (snapshot.items.length === 0) errors.push('至少需要一个订单产品');
  if (snapshot.items.some((item) => !item.description || item.quantity <= 0)) errors.push('产品名称和数量必须完整');
  if ((snapshot.type === 'CI' || snapshot.type === 'PL' || snapshot.type === 'CUSTOMS') && snapshot.opportunity.stage !== 'CLOSED_WON') {
    errors.push('CI、PL 和报关资料只能在商机已成交后正式签发');
  }
  if (snapshot.type === 'PI' && snapshot.totalAmount > 0 && snapshot.payment.status !== 'CONFIRMED') {
    if (!snapshot.bank.bankName || !snapshot.bank.accountNo || !snapshot.bank.beneficiary) errors.push('未收款 PI 必须先配置完整收款银行信息');
  }
  if (snapshot.type === 'PL') {
    if (!snapshot.shipment.packages) errors.push('装箱单签发前必须填写箱数');
    if (!snapshot.shipment.grossWeightKg || !snapshot.shipment.netWeightKg) errors.push('装箱单签发前必须填写毛重和净重');
  }
  if (snapshot.type === 'CUSTOMS') {
    if (snapshot.items.some((item) => !item.hsCode)) errors.push('报关资料的每个产品都必须有 HS Code');
    if (snapshot.items.some((item) => !item.origin && !snapshot.shipment.originCountry)) errors.push('报关资料的每个产品都必须有原产国');
  }
  return errors;
}

export async function buildTradeDocumentSnapshot(
  session: SessionPayload,
  opportunityId: string,
  type: TradeDocumentType,
  options?: { version?: number; documentNumber?: string; issuedAt?: Date },
): Promise<TradeDocumentSnapshot | null> {
  const opportunity = await prisma.opportunity.findFirst({
    where: { id: opportunityId, AND: [opportunityAccessWhere(session)] },
    include: {
      company: { include: { contacts: { orderBy: { createdAt: 'asc' }, take: 1 } } },
      product: true,
      lineItems: { include: { product: true }, orderBy: { createdAt: 'asc' } },
      payments: { include: { bankAccount: true }, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }] },
      shipments: { orderBy: { updatedAt: 'desc' }, take: 1 },
    },
  });
  if (!opportunity) return null;

  const [settings, defaultBank] = await Promise.all([
    prisma.systemSettings.findUnique({ where: { id: 'default' } }),
    prisma.bankAccount.findFirst({ where: { isActive: true }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] }),
  ]);
  const contact = opportunity.company.contacts[0];
  const legacy = asRecord(opportunity.lockedPiData);
  const legacyLineItems = legacyItems(legacy.items);
  const lineItems: TradeDocumentItem[] = opportunity.lineItems.length
    ? opportunity.lineItems.map((item) => ({
      sku: item.sku || item.product?.sku || '',
      description: item.productName || item.product?.enName || item.product?.name || '',
      quantity: item.quantity,
      unitPrice: item.unitPrice || 0,
      amount: item.totalAmount ?? roundMoney(item.quantity * (item.unitPrice || 0)),
      currency: item.currency || 'USD',
      hsCode: item.product?.hsCode || '',
      origin: item.product?.origin || '',
      unit: item.product?.unit || '',
      material: item.product?.material || '',
      usage: item.product?.usage || '',
      customsCondition: item.product?.customsCondition || '',
    }))
    : legacyLineItems.length
      ? legacyLineItems
      : [{
        sku: opportunity.product?.sku || '',
        description: opportunity.product?.enName || opportunity.product?.name || opportunity.title,
        quantity: 1,
        unitPrice: opportunity.amountUSD || opportunity.amountCNY || 0,
        amount: opportunity.amountUSD || opportunity.amountCNY || 0,
        currency: opportunity.amountCNY && !opportunity.amountUSD ? 'CNY' : 'USD',
        hsCode: opportunity.product?.hsCode || '',
        origin: opportunity.product?.origin || '',
        unit: opportunity.product?.unit || '',
        material: opportunity.product?.material || '',
        usage: opportunity.product?.usage || '',
        customsCondition: opportunity.product?.customsCondition || '',
      }];
  const currency = text(legacy.currency) || lineItems.find((item) => item.currency)?.currency || 'USD';
  const subtotal = numberValue(legacy.subtotal, lineItems.reduce((sum, item) => sum + item.amount, 0));
  const shippingAmount = numberValue(legacy.shippingAmount);
  const taxAmount = numberValue(legacy.taxAmount);
  const totalAmount = numberValue(
    legacy.totalAmount,
    subtotal + shippingAmount + taxAmount || opportunity.amountUSD || opportunity.amountCNY || 0,
  );
  const confirmedPayment = opportunity.payments.find((payment) => payment.status === 'CONFIRMED');
  const latestPayment = confirmedPayment || opportunity.payments[0];
  const bank = latestPayment?.bankAccount || defaultBank;
  const shipment = opportunity.shipments[0];
  const issuedAt = options?.issuedAt || new Date();
  const version = options?.version || 0;

  return {
    schemaVersion: 1,
    type,
    documentNumber: options?.documentNumber || documentNumber(type, opportunity.opportunityCode || '', opportunity.id, version || 1, issuedAt),
    issuedAt: issuedAt.toISOString(),
    version,
    opportunity: {
      id: opportunity.id,
      code: opportunity.opportunityCode || '',
      title: opportunity.title,
      stage: opportunity.stage,
    },
    seller: {
      companyName: settings?.companyName || 'ERDI TECH LTD',
      email: 'sales@erdicn.com',
    },
    buyer: {
      companyName: opportunity.company.name,
      customerCode: opportunity.company.customerCode || '',
      contactName: [contact?.firstName, contact?.lastName].filter(Boolean).join(' '),
      email: contact?.email || text(legacy.email),
      phone: contact?.phone || text(legacy.phone),
      country: opportunity.company.country || '',
    },
    items: lineItems,
    currency,
    subtotal: roundMoney(subtotal),
    shippingAmount: roundMoney(shippingAmount),
    taxAmount: roundMoney(taxAmount),
    totalAmount: roundMoney(totalAmount),
    payment: {
      status: latestPayment?.status || text(legacy.paymentStatus) || 'PENDING',
      method: latestPayment?.method || text(legacy.paymentMethod),
      reference: latestPayment?.reference || '',
      paidAt: latestPayment?.paidAt?.toISOString() || '',
    },
    bank: {
      label: bank?.label || '',
      bankName: bank?.bankName || settings?.bankName || '',
      accountNo: bank?.accountNo || settings?.bankAccountNo || '',
      swift: bank?.swift || settings?.bankSwift || '',
      beneficiary: bank?.beneficiary || settings?.bankBeneficiary || settings?.companyName || 'ERDI TECH LTD',
      bankAddress: bank?.bankAddress || settings?.bankAddress || '',
    },
    shipment: {
      carrier: shipment?.carrier || opportunity.carrier || '',
      trackingNumber: shipment?.trackingNumber || opportunity.trackingNumber || '',
      packages: shipment?.packages || null,
      grossWeightKg: shipment?.grossWeightKg || null,
      netWeightKg: shipment?.netWeightKg || null,
      lengthCm: shipment?.lengthCm || null,
      widthCm: shipment?.widthCm || null,
      heightCm: shipment?.heightCm || null,
      incoterm: shipment?.incoterm || '',
      originCountry: shipment?.originCountry || '',
      shippingAddress: shipment?.shippingAddress || legacy.shippingAddress || null,
      notes: shipment?.notes || '',
    },
  };
}

export async function latestTradeDocument(session: SessionPayload, opportunityId: string, type: TradeDocumentType) {
  const opportunity = await prisma.opportunity.findFirst({
    where: { id: opportunityId, AND: [opportunityAccessWhere(session)] },
    select: { id: true },
  });
  if (!opportunity) return null;
  return prisma.tradeDocument.findFirst({
    where: { opportunityId, type },
    orderBy: { version: 'desc' },
  });
}

export async function issueTradeDocumentSnapshot(session: SessionPayload, opportunityId: string, type: TradeDocumentType) {
  if (!canIssueTradeDocument(session, type)) throw new Error('当前岗位无权签发此类单据');
  const draft = await buildTradeDocumentSnapshot(session, opportunityId, type);
  if (!draft) throw new Error('商机不存在或无权访问');

  return prisma.$transaction(async (tx) => {
    const latest = await tx.tradeDocument.findFirst({
      where: { opportunityId, type },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = (latest?.version || 0) + 1;
    const issuedAt = new Date();
    const opportunity = await tx.opportunity.findUnique({
      where: { id: opportunityId },
      select: { opportunityCode: true },
    });
    if (!opportunity) throw new Error('商机不存在');
    const number = documentNumber(type, opportunity.opportunityCode || '', opportunityId, version, issuedAt);
    const snapshot: TradeDocumentSnapshot = {
      ...draft,
      version,
      documentNumber: number,
      issuedAt: issuedAt.toISOString(),
    };
    const errors = validateTradeDocument(snapshot);
    if (errors.length) throw new Error(errors.join('；'));

    await tx.tradeDocument.updateMany({
      where: { opportunityId, type, status: 'ISSUED' },
      data: { status: 'SUPERSEDED' },
    });

    return tx.tradeDocument.create({
      data: {
        type,
        documentNumber: number,
        version,
        data: JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue,
        opportunityId,
        issuedById: session.userId,
        issuedAt,
      },
    });
  });
}

export function parseTradeDocumentSnapshot(value: Prisma.JsonValue): TradeDocumentSnapshot | null {
  const record = asRecord(value);
  if (record.schemaVersion !== 1 || !record.opportunity || !Array.isArray(record.items)) return null;
  return record as unknown as TradeDocumentSnapshot;
}

export function parseTradeDocumentType(value: unknown): TradeDocumentType | null {
  const type = String(value || '').toUpperCase();
  return Object.values(TradeDocumentType).includes(type as TradeDocumentType) ? type as TradeDocumentType : null;
}

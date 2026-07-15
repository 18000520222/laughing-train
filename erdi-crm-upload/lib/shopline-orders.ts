import { createHmac, timingSafeEqual } from 'crypto';
import { Prisma } from '@prisma/client';
import { ensureCustomerCode } from '@/lib/customer-code';
import { prisma } from '@/lib/prisma';

type UnknownRecord = Record<string, unknown>;

export type ShoplineAddress = {
  name: string;
  company: string;
  address1: string;
  address2: string;
  city: string;
  province: string;
  provinceCode: string;
  postalCode: string;
  country: string;
  countryCode: string;
  phone: string;
};

export type ShoplineOrderItem = {
  externalId: string;
  productId: string;
  variantId: string;
  sku: string;
  title: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  weightGrams: number | null;
  hsCode?: string | null;
  origin?: string | null;
  unit?: string | null;
};

export type NormalizedShoplineOrder = {
  externalId: string;
  orderNumber: string;
  orderDate: string;
  updatedAt: string;
  customerId: string;
  customerName: string;
  email: string;
  phone: string;
  financialStatus: string;
  fulfillmentStatus: string;
  paymentMethod: string;
  currency: string;
  subtotal: number;
  shippingAmount: number;
  taxAmount: number;
  totalAmount: number;
  totalWeightGrams: number | null;
  shippingAddress: ShoplineAddress;
  billingAddress: ShoplineAddress | null;
  items: ShoplineOrderItem[];
};

export type ShoplineImportResult = {
  status: 'created' | 'duplicate' | 'ignored';
  orderNumber: string;
  opportunityId: string | null;
  piPath: string | null;
  reason?: string;
};

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function moneyValue(value: unknown): number | null {
  const direct = numberOrNull(value);
  if (direct !== null) return direct;
  const record = asRecord(value);
  const presentment = asRecord(record.presentment_money || record.presentmentMoney);
  const shop = asRecord(record.shop_money || record.shopMoney);
  return numberOrNull(presentment.amount) ?? numberOrNull(shop.amount) ?? numberOrNull(record.amount);
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = numberOrNull(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeAddress(value: unknown): ShoplineAddress | null {
  const address = asRecord(value);
  if (Object.keys(address).length === 0) return null;
  const firstName = firstString(address.first_name, address.firstName);
  const lastName = firstString(address.last_name, address.lastName);
  return {
    name: firstString(address.name, `${firstName} ${lastName}`.trim()),
    company: firstString(address.company),
    address1: firstString(address.address1),
    address2: firstString(address.address2),
    city: firstString(address.city),
    province: firstString(address.province, address.state),
    provinceCode: firstString(address.standard_province_code, address.province_code, address.provinceCode),
    postalCode: firstString(address.zip, address.postal_code, address.postalCode),
    country: firstString(address.country),
    countryCode: firstString(address.country_code, address.countryCode).toUpperCase(),
    phone: firstString(address.phone),
  };
}

function amountFromSet(value: unknown): number | null {
  return moneyValue(value);
}

function sumShippingLines(value: unknown): number | null {
  const lines = asArray(value);
  if (lines.length === 0) return null;
  return roundMoney(lines.reduce<number>((sum, lineValue) => {
    const line = asRecord(lineValue);
    return sum + (firstNumber(
      line.discounted_price,
      amountFromSet(line.discounted_price_set),
      line.price,
      amountFromSet(line.price_set),
    ) || 0);
  }, 0));
}

function normalizeItems(value: unknown): ShoplineOrderItem[] {
  return asArray(value).map((itemValue, index) => {
    const item = asRecord(itemValue);
    const quantity = Math.max(1, Math.trunc(firstNumber(item.quantity, item.fulfillable_quantity) || 1));
    const unitPrice = firstNumber(
      item.price,
      amountFromSet(item.price_set),
      amountFromSet(item.priceSet),
      item.unit_price,
    ) || 0;
    return {
      externalId: firstString(item.id, `${index + 1}`),
      productId: firstString(item.product_id, item.productId),
      variantId: firstString(item.variant_id, item.variantId),
      sku: firstString(item.sku),
      title: firstString(item.title, item.name, item.sku, `SHOPLINE item ${index + 1}`),
      quantity,
      unitPrice: roundMoney(unitPrice),
      amount: roundMoney(unitPrice * quantity),
      weightGrams: firstNumber(item.grams, item.weight_grams, item.weightGrams),
    };
  }).filter(item => item.title || item.sku);
}

function getPayloadOrder(payload: unknown): UnknownRecord {
  const root = asRecord(payload);
  const data = asRecord(root.data);
  return asRecord(root.order || data.order || payload);
}

export function normalizeShoplineOrder(payload: unknown): NormalizedShoplineOrder {
  const order = getPayloadOrder(payload);
  const customer = asRecord(order.customer || order.buyer);
  const payments = asArray(order.payment_details || order.paymentDetails).map(asRecord);
  const shippingAddress = normalizeAddress(order.shipping_address || order.shippingAddress)
    || normalizeAddress(customer.default_address || customer.defaultAddress)
    || normalizeAddress(order.billing_address || order.billingAddress)
    || {
      name: '', company: '', address1: '', address2: '', city: '', province: '',
      provinceCode: '', postalCode: '', country: '', countryCode: '', phone: '',
    };
  const billingAddress = normalizeAddress(order.billing_address || order.billingAddress);
  const items = normalizeItems(order.line_items || order.lineItems);
  const paidAmount = roundMoney(payments.reduce((sum, payment) => {
    const status = firstString(payment.pay_status, payment.status).toLowerCase();
    return status === 'paid' ? sum + (firstNumber(payment.pay_amount, payment.amount) || 0) : sum;
  }, 0));
  const subtotal = firstNumber(
    order.subtotal_price,
    amountFromSet(order.subtotal_price_set),
  ) ?? roundMoney(items.reduce((sum, item) => sum + item.amount, 0));
  const shippingAmount = firstNumber(
    amountFromSet(order.total_shipping_price_set),
    sumShippingLines(order.shipping_lines || order.shippingLines),
    order.shipping_price,
  ) || 0;
  const taxAmount = firstNumber(order.total_tax, amountFromSet(order.total_tax_set)) || 0;
  const calculatedTotal = roundMoney(subtotal + shippingAmount + taxAmount);
  const totalAmount = firstNumber(
    order.current_total_price,
    amountFromSet(order.current_total_price_set),
    order.total_price,
    amountFromSet(order.total_price_set),
    order.total_amount,
    paidAmount > 0 ? paidAmount : null,
  ) ?? calculatedTotal;
  const paymentGatewayNames = asArray(order.payment_gateway_names).map(firstString).filter(Boolean);
  const paymentMethod = firstString(
    paymentGatewayNames[0],
    payments[0]?.payment_method,
    payments[0]?.payment_channel,
    order.payment_method,
  );
  const customerFirstName = firstString(customer.first_name, customer.firstName);
  const customerLastName = firstString(customer.last_name, customer.lastName);
  const customerName = firstString(
    customer.name,
    `${customerFirstName} ${customerLastName}`.trim(),
    shippingAddress.name,
    order.email,
    'SHOPLINE customer',
  );
  const email = firstString(order.email, customer.email).toLowerCase();
  const paymentShowsPaid = payments.some(payment => firstString(payment.pay_status, payment.status).toLowerCase() === 'paid');
  const financialStatus = firstString(order.financial_status, order.financialStatus, paymentShowsPaid ? 'paid' : '').toLowerCase();

  return {
    externalId: firstString(order.id, order.order_id, order.orderId),
    orderNumber: firstString(order.name, order.order_number, order.orderNumber).replace(/^#/, ''),
    orderDate: firstString(order.order_at, order.processed_at, order.created_at, order.createdAt),
    updatedAt: firstString(order.updated_at, order.updatedAt),
    customerId: firstString(customer.id, order.user_id, order.buyer_id),
    customerName,
    email,
    phone: firstString(order.phone, customer.phone, shippingAddress.phone),
    financialStatus,
    fulfillmentStatus: firstString(order.fulfillment_status, order.fulfillmentStatus, 'unfulfilled').toLowerCase(),
    paymentMethod,
    currency: firstString(
      order.presentment_currency,
      order.currency,
      asRecord(asRecord(order.subtotal_price_set).presentment_money).currency_code,
      'USD',
    ).toUpperCase(),
    subtotal: roundMoney(subtotal),
    shippingAmount: roundMoney(shippingAmount),
    taxAmount: roundMoney(taxAmount),
    totalAmount: roundMoney(totalAmount),
    totalWeightGrams: firstNumber(order.total_weight, order.totalWeight),
    shippingAddress,
    billingAddress,
    items,
  };
}

function equalBuffers(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyShoplineWebhook(rawBody: string, signature: string, secret: string): boolean {
  if (!rawBody || !signature || !secret) return false;
  const supplied = signature.replace(/^sha256=/i, '').trim();
  const expectedHex = createHmac('sha256', secret).update(rawBody).digest('hex');
  const expectedBase64 = createHmac('sha256', secret).update(rawBody).digest('base64');
  return equalBuffers(supplied.toLowerCase(), expectedHex) || equalBuffers(supplied, expectedBase64);
}

function cleanOrderNumber(orderNumber: string): string {
  return orderNumber.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 80);
}

function splitName(name: string): { firstName: string; lastName: string | null } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts.shift() || 'SHOPLINE',
    lastName: parts.length ? parts.join(' ') : null,
  };
}

function dateOnly(value: string): string {
  const parsed = value ? new Date(value) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString().slice(0, 10) : parsed.toISOString().slice(0, 10);
}

function asDate(value: string): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function buildPiSnapshot(order: NormalizedShoplineOrder): Prisma.InputJsonObject {
  return {
    version: 2,
    source: 'SHOPLINE',
    externalOrderId: order.externalId,
    orderNumber: order.orderNumber,
    piNumber: `PI-${cleanOrderNumber(order.orderNumber)}`,
    date: dateOnly(order.orderDate),
    orderDate: order.orderDate,
    companyName: order.shippingAddress.company || order.customerName,
    customerName: order.customerName,
    email: order.email,
    phone: order.phone,
    shippingAddress: order.shippingAddress as unknown as Prisma.InputJsonObject,
    billingAddress: order.billingAddress as unknown as Prisma.InputJsonValue,
    items: order.items as unknown as Prisma.InputJsonArray,
    currency: order.currency,
    subtotal: order.subtotal,
    shippingAmount: order.shippingAmount,
    taxAmount: order.taxAmount,
    totalAmount: order.totalAmount,
    amountUSD: order.currency === 'USD' ? order.totalAmount : 0,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.financialStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    isFrozen: true,
  };
}

function buildDhlDraft(order: NormalizedShoplineOrder): Prisma.InputJsonObject {
  const itemWeight = order.items.reduce((sum, item) => sum + ((item.weightGrams || 0) * item.quantity), 0);
  const weightGrams = order.totalWeightGrams || (itemWeight > 0 ? itemWeight : null);
  const missingFields = ['dhlAccount', 'shipperAddress', 'packageDimensions', 'incoterm'];
  if (!weightGrams) missingFields.push('packageWeight');
  if (order.items.some(item => !item.hsCode)) missingFields.push('itemHsCode');
  if (order.items.some(item => !item.origin)) missingFields.push('itemOriginCountry');

  return {
    version: 1,
    provider: 'DHL_EXPRESS',
    status: 'NEEDS_INPUT',
    sourceOrderNumber: order.orderNumber,
    currency: order.currency,
    declaredValue: order.subtotal,
    consignee: order.shippingAddress as unknown as Prisma.InputJsonObject,
    packages: [{
      weightKg: weightGrams ? Math.round(weightGrams) / 1000 : null,
      lengthCm: null,
      widthCm: null,
      heightCm: null,
    }] as unknown as Prisma.InputJsonArray,
    customsItems: order.items.map(item => ({
      sku: item.sku,
      description: item.title,
      quantity: item.quantity,
      unitValue: item.unitPrice,
      hsCode: item.hsCode || null,
      originCountry: item.origin || null,
      weightKg: item.weightGrams ? item.weightGrams / 1000 : null,
    })) as unknown as Prisma.InputJsonArray,
    missingFields,
  };
}

async function findCompanyForOrder(order: NormalizedShoplineOrder) {
  const externalId = order.customerId ? `SHOPLINE-${order.customerId}` : '';
  const contactFilters: Prisma.ContactWhereInput[] = [];
  if (order.email) contactFilters.push({ email: { equals: order.email, mode: 'insensitive' } });
  if (externalId) contactFilters.push({ externalId });
  const contact = contactFilters.length
    ? await prisma.contact.findFirst({ where: { OR: contactFilters }, include: { company: true } })
    : null;
  if (contact) return { company: contact.company, contact, externalId };

  const companyName = order.shippingAddress.company || order.customerName;
  const company = await prisma.company.findFirst({
    where: { source: 'SHOPLINE', name: { equals: companyName, mode: 'insensitive' } },
  });
  return { company, contact: null, externalId };
}

function mergeProducts(existing: string | null, order: NormalizedShoplineOrder): string {
  const values = new Set((existing || '').split(/[,\n]/).map(value => value.trim()).filter(Boolean));
  for (const item of order.items) values.add(item.sku || item.title);
  return Array.from(values).join(', ');
}

export async function importShoplineOrder(payload: unknown): Promise<ShoplineImportResult> {
  let order = normalizeShoplineOrder(payload);
  if (!order.orderNumber || !order.externalId) throw new Error('SHOPLINE order is missing its ID or order number.');
  if (order.items.length === 0) throw new Error(`SHOPLINE order ${order.orderNumber} has no line items.`);
  if (order.financialStatus !== 'paid') {
    return {
      status: 'ignored',
      orderNumber: order.orderNumber,
      opportunityId: null,
      piPath: null,
      reason: `financial_status=${order.financialStatus || 'unknown'}`,
    };
  }

  const opportunityCode = `SHOPLINE-${cleanOrderNumber(order.orderNumber)}`;
  const existing = await prisma.opportunity.findUnique({
    where: { opportunityCode },
    select: { id: true, companyId: true },
  });
  if (existing) {
    await prisma.company.update({
      where: { id: existing.companyId },
      data: { type: 'DEAL_WON', nextAction: `Prepare DHL shipment for ${order.orderNumber}` },
    });
    return { status: 'duplicate', orderNumber: order.orderNumber, opportunityId: existing.id, piPath: `/pi/${existing.id}` };
  }

  const skus = order.items.map(item => item.sku).filter(Boolean);
  const products = skus.length
    ? await prisma.product.findMany({ where: { sku: { in: skus } } })
    : [];
  const productBySku = new Map(products.map(product => [product.sku, product]));
  order = {
    ...order,
    items: order.items.map(item => {
      const product = productBySku.get(item.sku);
      return {
        ...item,
        hsCode: product?.hsCode || null,
        origin: product?.origin || null,
        unit: product?.unit || null,
      };
    }),
  };

  const match = await findCompanyForOrder(order);
  let company = match.company;
  if (!company) {
    const customerCode = await ensureCustomerCode();
    company = await prisma.company.create({
      data: {
        customerCode,
        name: order.shippingAddress.company || order.customerName,
        country: order.shippingAddress.country || order.shippingAddress.countryCode || null,
        type: 'DEAL_WON',
        source: 'SHOPLINE',
        mainProducts: mergeProducts(null, order),
        customerProfile: `Paid SHOPLINE customer. First imported order: ${order.orderNumber}.`,
        nextAction: `Prepare DHL shipment for ${order.orderNumber}`,
      },
    });
  } else {
    company = await prisma.company.update({
      where: { id: company.id },
      data: {
        type: 'DEAL_WON',
        country: company.country || order.shippingAddress.country || order.shippingAddress.countryCode || undefined,
        mainProducts: mergeProducts(company.mainProducts, order),
        nextAction: `Prepare DHL shipment for ${order.orderNumber}`,
      },
    });
  }

  if (!match.contact && (order.email || order.phone || match.externalId)) {
    const name = splitName(order.customerName);
    await prisma.contact.create({
      data: {
        firstName: name.firstName,
        lastName: name.lastName,
        email: order.email || null,
        phone: order.phone || null,
        externalId: match.externalId || null,
        companyId: company.id,
      },
    });
  }

  const primaryProduct = order.items[0]?.sku ? productBySku.get(order.items[0].sku) : null;
  const orderCreatedAt = asDate(order.orderDate);
  const opportunity = await prisma.opportunity.create({
    data: {
      opportunityCode,
      title: `[SHOPLINE] ${order.orderNumber} - ${order.customerName}`,
      description: [
        `SHOPLINE paid order ${order.orderNumber}`,
        `Payment: ${order.paymentMethod || 'unknown'}`,
        `Items: ${order.items.map(item => `${item.sku || item.title} x${item.quantity}`).join(', ')}`,
        `Fulfillment: ${order.fulfillmentStatus}`,
      ].join('\n'),
      amountUSD: order.currency === 'USD' ? order.totalAmount : null,
      amountCNY: order.currency === 'CNY' ? order.totalAmount : null,
      productId: primaryProduct?.id || null,
      stage: 'CLOSED_WON',
      stageChangedAt: orderCreatedAt || new Date(),
      nextStep: 'Complete package details, review DHL rate, then create the shipment.',
      companyId: company.id,
      carrier: 'DHL Express',
      lockedPiData: buildPiSnapshot(order),
      customsData: buildDhlDraft(order),
      createdAt: orderCreatedAt,
      stageHistory: {
        create: {
          toStage: 'CLOSED_WON',
          amountUSD: order.currency === 'USD' ? order.totalAmount : null,
          note: `Imported from paid SHOPLINE order ${order.orderNumber}`,
          changedAt: orderCreatedAt || new Date(),
        },
      },
      shipments: {
        create: {
          carrier: 'DHL Express',
          status: 'PENDING',
        },
      },
    },
  });

  return {
    status: 'created',
    orderNumber: order.orderNumber,
    opportunityId: opportunity.id,
    piPath: `/pi/${opportunity.id}`,
  };
}

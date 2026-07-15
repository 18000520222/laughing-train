import { isAgentAuthorized } from '@/lib/agent-auth';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function cleanOrderNumber(value: string): string {
  return value.toUpperCase().replace(/^SHOPLINE-/, '').replace(/[^A-Z0-9_-]/g, '').slice(0, 80);
}

export async function GET(request: Request) {
  if (!isAgentAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const url = new URL(request.url);
  const orderNumber = cleanOrderNumber(url.searchParams.get('order') || '');
  const includeShipping = url.searchParams.get('include') === 'shipping';
  const requestedLimit = Number(url.searchParams.get('limit') || 20);
  const take = Number.isFinite(requestedLimit) ? Math.min(50, Math.max(1, Math.trunc(requestedLimit))) : 20;
  const origin = process.env.NEXT_PUBLIC_APP_URL || url.origin;

  const opportunities = await prisma.opportunity.findMany({
    where: orderNumber
      ? { opportunityCode: `SHOPLINE-${orderNumber}` }
      : { opportunityCode: { startsWith: 'SHOPLINE-' } },
    include: {
      company: { select: { id: true, customerCode: true, name: true, country: true, type: true, source: true } },
      shipments: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
    orderBy: { createdAt: 'desc' },
    take,
  });

  const orders = opportunities.map(opportunity => {
    const pi = asRecord(opportunity.lockedPiData);
    const dhl = asRecord(opportunity.customsData);
    const address = asRecord(pi.shippingAddress);
    const items = asArray(pi.items).map(itemValue => {
      const item = asRecord(itemValue);
      return {
        sku: text(item.sku),
        description: text(item.title || item.description),
        quantity: Number(item.quantity || 0),
        unitPrice: Number(item.unitPrice || 0),
        amount: Number(item.amount || 0),
        hsCode: text(item.hsCode) || null,
        origin: text(item.origin) || null,
      };
    });
    const relativePiPath = `/pi/${opportunity.id}`;
    const shipping = includeShipping ? {
      customerName: text(pi.customerName) || opportunity.company.name,
      email: text(pi.email),
      phone: text(pi.phone),
      address,
    } : undefined;

    return {
      id: opportunity.id,
      orderNumber: text(pi.orderNumber) || opportunity.opportunityCode?.replace(/^SHOPLINE-/, ''),
      opportunityCode: opportunity.opportunityCode,
      customer: {
        code: opportunity.company.customerCode,
        name: opportunity.company.name,
        country: opportunity.company.country,
        type: opportunity.company.type,
        source: opportunity.company.source,
      },
      stage: opportunity.stage,
      currency: text(pi.currency) || 'USD',
      amount: Number(pi.totalAmount || opportunity.amountUSD || 0),
      paymentMethod: text(pi.paymentMethod),
      paymentStatus: text(pi.paymentStatus),
      fulfillmentStatus: text(pi.fulfillmentStatus),
      items,
      pi: {
        number: text(pi.piNumber),
        path: relativePiPath,
        url: new URL(relativePiPath, origin).toString(),
        frozen: Boolean(pi.isFrozen),
      },
      dhl: {
        status: text(dhl.status) || 'NOT_PREPARED',
        missingFields: asArray(dhl.missingFields).map(text).filter(Boolean),
        shipmentId: opportunity.shipments[0]?.id || null,
        trackingNumber: opportunity.shipments[0]?.trackingNumber || null,
      },
      shipping,
      createdAt: opportunity.createdAt.toISOString(),
      updatedAt: opportunity.updatedAt.toISOString(),
    };
  });

  return NextResponse.json({ count: orders.length, orders }, {
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  });
}

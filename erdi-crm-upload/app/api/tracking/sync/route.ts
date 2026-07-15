import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { headers } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { writeAuditLog } from '@/lib/audit';

const DEFAULT_AFTERSHIP_BASE = 'https://api.aftership.com/tracking/2026-07';

export async function GET() {
  return handle();
}

export async function POST() {
  return handle();
}

function safeTokenMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle() {
  const session = await getSession();
  const requestHeaders = await headers();
  const authorization = requestHeaders.get('authorization') || '';
  const expectedCronToken = process.env.CRON_SECRET || '';
  const providedCronToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const cronAuthorized = Boolean(expectedCronToken && safeTokenMatch(providedCronToken, expectedCronToken));

  if ((!session || !can(session.role, 'logistics.manage')) && !cronAuthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const settings = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
  const apiKey = settings?.aftershipApiKey || process.env.AFTERSHIP_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: '请先在设置中配置 AFTERSHIP_API_KEY' }, { status: 400 });
  }

  const shipments = await prisma.shipment.findMany({
    where: { status: { not: 'DELIVERED' }, trackingNumber: { not: null } },
    take: 100,
  });
  const baseUrl = (process.env.AFTERSHIP_API_BASE_URL || DEFAULT_AFTERSHIP_BASE).replace(/\/$/, '');
  const trackingByNumber = new Map<string, AfterShipTracking>();
  const errors: Array<{ batch: number; status: number; message: string }> = [];
  const trackingNumbers = shipments.map((shipment) => shipment.trackingNumber).filter((value): value is string => Boolean(value));
  const batches = trackingNumbers.length ? chunk(trackingNumbers, 50) : [[]];

  for (let index = 0; index < batches.length; index++) {
    const url = new URL(`${baseUrl}/trackings`);
    url.searchParams.set('limit', '200');
    if (batches[index].length) url.searchParams.set('tracking_numbers', batches[index].join(','));
    try {
      const response = await fetch(url, {
        headers: { 'as-api-key': apiKey, accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        errors.push({ batch: index + 1, status: response.status, message: safeAfterShipError(payload, response.statusText) });
        continue;
      }
      for (const tracking of payload?.data?.trackings || []) {
        if (tracking?.tracking_number) trackingByNumber.set(String(tracking.tracking_number), tracking);
      }
    } catch (error) {
      errors.push({ batch: index + 1, status: 0, message: error instanceof Error ? error.message.slice(0, 300) : 'AfterShip request failed' });
    }
  }

  let updated = 0;
  let missing = 0;
  if (errors.length === 0) {
    for (const shipment of shipments) {
      if (!shipment.trackingNumber) continue;
      const tracking = trackingByNumber.get(shipment.trackingNumber);
      if (!tracking) {
        missing++;
        continue;
      }
      for (const checkpoint of tracking.checkpoints || []) {
        const occurredAt = parseCheckpointDate(checkpoint.checkpoint_time);
        const checkpointKey = checkpoint.id || checkpoint.checkpoint_time || `${checkpoint.tag || checkpoint.subtag || 'INFO'}-${checkpoint.message || ''}`;
        await prisma.trackingEvent.upsert({
          where: { id: `${shipment.id}-${checkpointKey}`.slice(0, 60) },
          update: {
            status: checkpoint.tag || checkpoint.subtag || 'INFO',
            location: checkpoint.location || checkpoint.city || null,
            description: checkpoint.message || '',
            occurredAt,
          },
          create: {
            id: `${shipment.id}-${checkpointKey}`.slice(0, 60),
            shipmentId: shipment.id,
            status: checkpoint.tag || checkpoint.subtag || 'INFO',
            location: checkpoint.location || checkpoint.city || null,
            description: checkpoint.message || '',
            occurredAt,
          },
        });
      }
      if (tracking.tag === 'Delivered' && shipment.status !== 'DELIVERED') {
        await prisma.shipment.update({ where: { id: shipment.id }, data: { status: 'DELIVERED' } });
        await notifyShipmentUpdate(shipment.id, '已签收');
      }
      updated++;
    }
  }

  const failed = errors.length > 0;
  await prisma.systemSettings.update({
    where: { id: 'default' },
    data: failed
      ? { aftershipLastError: errors.map((item) => `HTTP ${item.status || 'NETWORK'}: ${item.message}`).join('\n').slice(0, 2000) }
      : { aftershipLastSuccessAt: new Date(), aftershipLastError: null },
  });
  await writeAuditLog(session, {
    action: 'shipment.tracking_sync',
    entityType: 'Shipment',
    summary: failed ? `AfterShip 同步失败 ${errors.length} 批` : `同步 ${updated} 个活跃运单，AfterShip 未匹配 ${missing} 个`,
    metadata: { updated, missing, failedBatches: errors.length, source: cronAuthorized ? 'CRON' : 'MANUAL' },
  });

  return NextResponse.json(
    { ok: !failed, updated, missing, failedBatches: errors.length, errors },
    { status: failed ? 502 : 200 },
  );
}

type AfterShipTracking = {
  tracking_number?: string;
  tag?: string;
  checkpoints?: Array<{
    id?: string;
    tag?: string;
    subtag?: string;
    location?: string;
    city?: string;
    message?: string;
    checkpoint_time?: string;
  }>;
};

function chunk<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function safeAfterShipError(payload: any, fallback: string) {
  return String(payload?.meta?.message || payload?.message || fallback || 'AfterShip request failed').slice(0, 300);
}

function parseCheckpointDate(value?: string) {
  if (!value) return new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

async function notifyShipmentUpdate(shipmentId: string, status: string) {
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    include: { opportunity: { include: { owner: true } } },
  });
  if (!shipment) return;
  const targets = await prisma.user.findMany({
    where: { role: { in: ['SUPER_ADMIN', 'OPERATIONS', 'DOCUMENT'] }, isActive: true },
  });
  const userIds = new Set([shipment.opportunity?.owner?.id, ...targets.map((target) => target.id)].filter(Boolean) as string[]);
  for (const userId of Array.from(userIds)) {
    await prisma.notification.create({
      data: {
        userId,
        type: 'SHIPMENT',
        title: `运单状态更新: ${status}`,
        body: `${shipment.carrier} ${shipment.trackingNumber}`,
        link: '/shipments',
      },
    });
  }
}

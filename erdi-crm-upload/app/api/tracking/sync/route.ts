// app/api/tracking/sync/route.ts
// 每日定时同步全部活跃发货的物流信息 (AfterShip)
import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET() {
  return handle();
}
export async function POST() {
  return handle();
}

async function handle() {
  const settings = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
  const apiKey = settings?.aftershipApiKey || process.env.AFTERSHIP_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: '请先在设置中配置 AFTERSHIP_API_KEY' }, { status: 400 });
  }

  const shipments = await prisma.shipment.findMany({
    where: { status: { not: 'DELIVERED' }, trackingNumber: { not: null } },
    take: 100,
  });

  let updated = 0;
  for (const s of shipments) {
    if (!s.trackingNumber) continue;
    try {
      const carrierSlug = mapCarrier(s.carrier);
      const res = await fetch(`https://api.aftership.com/v4/trackings/${carrierSlug}/${s.trackingNumber}`, {
        headers: { 'aftership-api-key': apiKey },
      });
      const data = await res.json();
      const checkpoints = data?.data?.tracking?.checkpoints || [];
      const tag = data?.data?.tracking?.tag; // Pending / InTransit / Delivered ...

      for (const cp of checkpoints) {
        await prisma.trackingEvent.upsert({
          where: {
            id: `${s.id}-${cp.created_at}`.slice(0, 60),
          },
          update: {},
          create: {
            id: `${s.id}-${cp.created_at}`.slice(0, 60),
            shipmentId: s.id,
            status: cp.tag || cp.subtag || 'INFO',
            location: cp.location || cp.city || null,
            description: cp.message || '',
            occurredAt: cp.checkpoint_time ? new Date(cp.checkpoint_time) : new Date(),
          },
        });
      }

      if (tag === 'Delivered' && s.status !== 'DELIVERED') {
        await prisma.shipment.update({ where: { id: s.id }, data: { status: 'DELIVERED' } });
        await notifyShipmentUpdate(s.id, '已签收');
      }
      updated++;
    } catch (e) {
      console.error('[tracking-sync]', s.id, e);
    }
  }

  return NextResponse.json({ ok: true, updated });
}

function mapCarrier(c: string): string {
  const m: Record<string, string> = {
    DHL: 'dhl',
    UPS: 'ups',
    FEDEX: 'fedex',
    EMS: 'china-ems',
    SF: 'sf-express',
  };
  return m[c.toUpperCase()] || c.toLowerCase();
}

async function notifyShipmentUpdate(shipmentId: string, status: string) {
  const ship = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    include: { opportunity: { include: { owner: true } } },
  });
  if (!ship) return;
  const targets = await prisma.user.findMany({
    where: { role: { in: ['SUPER_ADMIN', 'OPERATIONS', 'DOCUMENT'] }, isActive: true },
  });
  const userIds = new Set([ship.opportunity?.owner?.id, ...targets.map(t => t.id)].filter(Boolean) as string[]);

  for (const uid of Array.from(userIds)) {
    await prisma.notification.create({
      data: {
        userId: uid,
        type: 'SHIPMENT',
        title: `运单状态更新: ${status}`,
        body: `${ship.carrier} ${ship.trackingNumber}`,
        link: '/shipments',
      },
    });
  }
}

// app/api/tracking/webhook/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isWebhookTokenAuthorized } from '@/lib/webhook-auth';



export async function POST(req: Request) {
  try {
    if (!isWebhookTokenAuthorized(req, [process.env.AFTERSHIP_WEBHOOK_TOKEN, process.env.CHANNEL_WEBHOOK_TOKEN])) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const payload = await req.json();
    const tracking = payload?.msg || payload?.tracking;
    if (!tracking) return NextResponse.json({ ok: true });

    const trackingNumber = tracking.tracking_number;
    const shipment = await prisma.shipment.findFirst({ where: { trackingNumber } });
    if (!shipment) return NextResponse.json({ ok: true });

    for (const cp of tracking.checkpoints || []) {
      await prisma.trackingEvent.create({
        data: {
          shipmentId: shipment.id,
          status: cp.tag || 'INFO',
          location: cp.location || null,
          description: cp.message || '',
          occurredAt: cp.checkpoint_time ? new Date(cp.checkpoint_time) : new Date(),
        },
      });
    }

    if (tracking.tag === 'Delivered' && shipment.status !== 'DELIVERED') {
      await prisma.shipment.update({ where: { id: shipment.id }, data: { status: 'DELIVERED' } });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ ok: true });
  }
}

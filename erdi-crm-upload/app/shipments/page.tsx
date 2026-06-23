import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

function optionalDate(value: FormDataEntryValue | null) {
  const raw = String(value || '').trim();
  return raw ? new Date(`${raw}T00:00:00`) : null;
}

async function createShipment(formData: FormData) {
  'use server';
  const session = await getSession();
  if (!session) redirect('/');

  const opportunityId = String(formData.get('opportunityId') || '');
  const carrier = String(formData.get('carrier') || '').trim();
  const trackingNumber = String(formData.get('trackingNumber') || '').trim();
  const freightCost = Number(formData.get('freightCost') || 0);
  const shippedAt = optionalDate(formData.get('shippedAt'));
  const estimatedArrival = optionalDate(formData.get('estimatedArrival'));

  if (!opportunityId || !carrier) return;

  await prisma.shipment.create({
    data: {
      opportunityId,
      carrier,
      trackingNumber: trackingNumber || null,
      freightCost: freightCost > 0 ? freightCost : null,
      status: shippedAt ? 'SHIPPED' : 'PENDING',
      shippedAt,
      estimatedArrival,
    },
  });
  revalidatePath('/shipments');
  revalidatePath('/logistics');
}

async function updateShipmentStatus(formData: FormData) {
  'use server';
  const session = await getSession();
  if (!session) redirect('/');

  const id = String(formData.get('id') || '');
  const status = String(formData.get('status') || 'PENDING') as 'PENDING' | 'SHIPPED' | 'DELIVERED';
  if (!id) return;

  await prisma.shipment.update({
    where: { id },
    data: {
      status,
      shippedAt: status === 'SHIPPED' ? new Date() : undefined,
    },
  });
  revalidatePath('/shipments');
  revalidatePath('/logistics');
}

async function addTrackingEvent(formData: FormData) {
  'use server';
  const session = await getSession();
  if (!session) redirect('/');

  const shipmentId = String(formData.get('shipmentId') || '');
  const status = String(formData.get('eventStatus') || 'INFO').trim();
  const location = String(formData.get('location') || '').trim();
  const description = String(formData.get('description') || '').trim();
  if (!shipmentId || !description) return;

  await prisma.trackingEvent.create({
    data: {
      shipmentId,
      status,
      location: location || null,
      description,
      occurredAt: new Date(),
    },
  });
  revalidatePath('/shipments');
}

const statusText: Record<string, string> = {
  PENDING: '待发货',
  SHIPPED: '运输中',
  DELIVERED: '已签收',
};

function statusClass(status: string) {
  if (status === 'DELIVERED') return 'bg-green-50 text-green-700 border-green-200';
  if (status === 'SHIPPED') return 'bg-blue-50 text-blue-700 border-blue-200';
  return 'bg-amber-50 text-amber-700 border-amber-200';
}

export default async function ShipmentsPage() {
  const session = await getSession();
  if (!session) redirect('/');

  const [shipments, opportunities, settings] = await Promise.all([
    prisma.shipment.findMany({
      include: {
        opportunity: { include: { company: true, owner: true } },
        trackingEvents: { orderBy: { occurredAt: 'desc' }, take: 3 },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    }),
    prisma.opportunity.findMany({
      include: { company: true },
      orderBy: { updatedAt: 'desc' },
      take: 120,
    }),
    prisma.systemSettings.findUnique({ where: { id: 'default' } }),
  ]);

  const pending = shipments.filter(s => s.status === 'PENDING').length;
  const shipped = shipments.filter(s => s.status === 'SHIPPED').length;
  const delivered = shipments.filter(s => s.status === 'DELIVERED').length;
  const aftershipReady = Boolean(settings?.aftershipApiKey || process.env.AFTERSHIP_API_KEY);

  return (
    <main className="min-h-screen bg-slate-50 p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-4 bg-white p-6 rounded-xl border border-slate-200 shadow-sm md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-500">物流执行</p>
            <h1 className="text-2xl font-bold text-slate-900">发货管理</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href="/api/tracking/sync" className={`rounded-lg px-4 py-2 text-sm font-semibold ${aftershipReady ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-slate-100 text-slate-500'}`}>
              同步物流
            </a>
            <Link href="/logistics" className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">物流中心</Link>
            <Link href="/dashboard" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">返回看板</Link>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          <Stat label="待发货" value={pending} tone="amber" />
          <Stat label="运输中" value={shipped} tone="blue" />
          <Stat label="已签收" value={delivered} tone="green" />
        </section>

        <section className="grid gap-6 lg:grid-cols-[380px_1fr]">
          <form action={createShipment} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900">新建发货</h2>
            <label className="block text-sm font-medium text-slate-700">
              关联商机
              <select required name="opportunityId" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
                <option value="">选择商机</option>
                {opportunities.map(o => <option key={o.id} value={o.id}>{o.title} / {o.company.name}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-medium text-slate-700">
                承运商
                <input required name="carrier" placeholder="DHL/UPS/FEDEX" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                运单号
                <input name="trackingNumber" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
              </label>
            </div>
            <label className="block text-sm font-medium text-slate-700">
              运费
              <input name="freightCost" type="number" min="0" step="0.01" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-medium text-slate-700">
                发货日期
                <input name="shippedAt" type="date" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                预计到达
                <input name="estimatedArrival" type="date" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
              </label>
            </div>
            {!aftershipReady && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">AfterShip API Key 未配置,可先人工维护运单。</p>}
            <button className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700">保存发货</button>
          </form>

          <div className="space-y-4">
            {shipments.length === 0 && <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-slate-400 shadow-sm">暂无发货记录</div>}
            {shipments.map(s => (
              <article key={s.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-bold text-slate-900">{s.opportunity.company.name}</h2>
                      <span className={`rounded-full border px-2 py-1 text-xs font-bold ${statusClass(s.status)}`}>{statusText[s.status] || s.status}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">{s.opportunity.title}</p>
                    <p className="mt-2 text-sm text-slate-500">
                      {s.carrier} {s.trackingNumber || '(未填运单号)'} · 运费 {s.freightCost ? s.freightCost.toLocaleString('zh-CN') : '-'}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      发货 {s.shippedAt ? s.shippedAt.toLocaleDateString('zh-CN') : '-'} · 预计到达 {s.estimatedArrival ? s.estimatedArrival.toLocaleDateString('zh-CN') : '-'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    {s.status === 'PENDING' && <ShipmentButton action={updateShipmentStatus} id={s.id} status="SHIPPED" label="标记发货" />}
                    {s.status !== 'DELIVERED' && <ShipmentButton action={updateShipmentStatus} id={s.id} status="DELIVERED" label="标记签收" />}
                    <Link href={`/opportunity/${s.opportunity.id}`} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100">查看商机</Link>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]">
                  <div className="rounded-lg bg-slate-50 p-3">
                    <p className="text-xs font-bold uppercase text-slate-500">最近轨迹</p>
                    <div className="mt-2 space-y-2">
                      {s.trackingEvents.length === 0 && <p className="text-sm text-slate-400">暂无轨迹</p>}
                      {s.trackingEvents.map(e => (
                        <div key={e.id} className="text-sm text-slate-700">
                          <span className="font-bold">{e.status}</span> · {e.description}
                          <span className="ml-2 text-xs text-slate-400">{e.location || ''} {e.occurredAt.toLocaleString('zh-CN')}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <form action={addTrackingEvent} className="space-y-2 rounded-lg border border-slate-200 p-3">
                    <input type="hidden" name="shipmentId" value={s.id} />
                    <div className="grid grid-cols-2 gap-2">
                      <input name="eventStatus" placeholder="状态" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                      <input name="location" placeholder="地点" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    </div>
                    <input required name="description" placeholder="轨迹说明" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    <button className="w-full rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-700">追加轨迹</button>
                  </form>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'amber' | 'blue' | 'green' }) {
  const colors = {
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    blue: 'border-blue-200 bg-blue-50 text-blue-700',
    green: 'border-green-200 bg-green-50 text-green-700',
  }[tone];
  return <div className={`rounded-xl border p-5 shadow-sm ${colors}`}><p className="text-sm font-semibold">{label}</p><p className="mt-2 text-3xl font-black">{value}</p></div>;
}

function ShipmentButton({ action, id, status, label }: { action: (formData: FormData) => Promise<void>; id: string; status: string; label: string }) {
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100">{label}</button>
    </form>
  );
}

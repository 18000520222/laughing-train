import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { requirePermission } from '@/lib/permissions';
import { opportunityAccessWhere } from '@/lib/data-access';

export const dynamic = 'force-dynamic';

export default async function LogisticsPage() {
  const session = await requirePermission('logistics.manage');

  const [shipments, settings] = await Promise.all([
    prisma.shipment.findMany({
      where: { opportunity: opportunityAccessWhere(session) },
      include: { opportunity: { include: { company: true } }, trackingEvents: { orderBy: { occurredAt: 'desc' }, take: 1 } },
      orderBy: { updatedAt: 'desc' },
      take: 80,
    }),
    prisma.systemSettings.findUnique({ where: { id: 'default' } }),
  ]);

  const pending = shipments.filter(s => s.status === 'PENDING');
  const shipped = shipments.filter(s => s.status === 'SHIPPED');
  const delivered = shipments.filter(s => s.status === 'DELIVERED');
  const aftershipReady = Boolean(settings?.aftershipApiKey || process.env.AFTERSHIP_API_KEY);

  return (
    <main className="min-h-screen bg-slate-50 p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-4 bg-white p-6 rounded-xl shadow-sm border border-slate-200 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-500">物流中心</p>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">订单物流状态与发货跟进</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/shipments" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">发货管理</Link>
            <Link href="/dashboard" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">返回看板</Link>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-4">
          <Stat label="全部运单" value={shipments.length} tone="slate" />
          <Stat label="待发货" value={pending.length} tone="amber" />
          <Stat label="运输中" value={shipped.length} tone="blue" />
          <Stat label="已签收" value={delivered.length} tone="green" />
        </section>

        <section className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 p-5">
              <h2 className="text-lg font-bold text-slate-900">近期发货</h2>
            </div>
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="p-4">客户</th>
                  <th className="p-4">承运商</th>
                  <th className="p-4">运单号</th>
                  <th className="p-4">状态</th>
                  <th className="p-4">最近轨迹</th>
                  <th className="p-4 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shipments.length === 0 && <tr><td colSpan={6} className="p-10 text-center text-slate-400">暂无发货记录</td></tr>}
                {shipments.map(s => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="p-4"><p className="font-bold text-slate-800">{s.opportunity.company.name}</p><p className="text-xs text-slate-500">{s.opportunity.title}</p></td>
                    <td className="p-4 text-slate-700">{s.carrier}</td>
                    <td className="p-4 font-mono text-xs text-slate-600">{s.trackingNumber || '-'}</td>
                    <td className="p-4"><Status status={s.status} /></td>
                    <td className="p-4 max-w-sm text-slate-600">{s.trackingEvents[0]?.description || '-'}</td>
                    <td className="p-4 text-right"><Link href="/shipments" className="text-blue-600 hover:underline">维护</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <aside className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold text-slate-900">AfterShip</h2>
              <p className="mt-2 text-sm text-slate-600">{aftershipReady ? 'API Key 已配置,可同步未签收运单。' : 'API Key 未配置,当前仅支持人工维护轨迹。'}</p>
              <a href="/api/tracking/sync" className={`mt-4 inline-flex rounded-lg px-4 py-2 text-sm font-semibold ${aftershipReady ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-slate-100 text-slate-500'}`}>立即同步</a>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold text-slate-900">待处理</h2>
              <div className="mt-3 space-y-3">
                {pending.slice(0, 6).map(s => (
                  <Link key={s.id} href="/shipments" className="block rounded-lg border border-amber-100 bg-amber-50 p-3 text-sm text-amber-800 hover:bg-amber-100">
                    {s.opportunity.company.name} · {s.carrier}
                  </Link>
                ))}
                {pending.length === 0 && <p className="text-sm text-slate-400">没有待发货运单</p>}
              </div>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'slate' | 'amber' | 'blue' | 'green' }) {
  const colors = {
    slate: 'border-slate-200 bg-white text-slate-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    blue: 'border-blue-200 bg-blue-50 text-blue-700',
    green: 'border-green-200 bg-green-50 text-green-700',
  }[tone];
  return <div className={`rounded-xl border p-5 shadow-sm ${colors}`}><p className="text-sm font-semibold">{label}</p><p className="mt-2 text-3xl font-black">{value}</p></div>;
}

function Status({ status }: { status: string }) {
  const text: Record<string, string> = { PENDING: '待发货', SHIPPED: '运输中', DELIVERED: '已签收' };
  const cls = status === 'DELIVERED' ? 'bg-green-50 text-green-700 border-green-200' : status === 'SHIPPED' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-amber-50 text-amber-700 border-amber-200';
  return <span className={`rounded-full border px-2 py-1 text-xs font-bold ${cls}`}>{text[status] || status}</span>;
}

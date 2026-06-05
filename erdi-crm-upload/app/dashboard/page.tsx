import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';


export default async function Dashboard() {
  const cookieStore = cookies();
  const role = cookieStore.get('auth_role')?.value;
  const currentUser = cookieStore.get('auth_email')?.value || '未知账号';
  const roleMap: Record<string, string> = {
    'SUPER_ADMIN': '超级管理员',
    'ADMIN': '管理员',
    'SALES': '业务主管',
    'FINANCE': '财务',
    'PURCHASING': '采购'
  };
  const currentTitle = roleMap[role || 'SALES'] || '业务人员';

  if (!role) redirect('/');

  const [opps, waUnread, pendingApprovals, activeShipments] = await Promise.all([
    prisma.opportunity.findMany({ orderBy: { createdAt: 'desc' } }),
    prisma.whatsAppMessage.count({ where: { direction: 'IN', createdAt: { gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) } } }),
    prisma.expenseClaim.count({ where: { status: 'PENDING' } }).catch(() => 0),
    prisma.shipment.count({ where: { status: { not: 'DELIVERED' } } }).catch(() => 0),
  ]);

  const totalAmount = opps.reduce((sum, opp) => sum + (opp.amountUSD || 0), 0);

  async function logout() {
    'use server';
    cookies().delete('auth_role');
    cookies().delete('auth_email');
    cookies().delete('auth_title');
    redirect('/');
  }

  const renderCard = (opp: any) => (
    <div key={opp.id} className="bg-white p-5 rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow group relative mb-4">
      <div className="flex justify-between items-start mb-2">
        <h3 className="font-bold text-gray-800 text-lg line-clamp-1" title={opp.title}>{opp.title}</h3>
        <span className="text-green-600 font-semibold">${opp.amountUSD || 0}</span>
      </div>
      <p className="text-sm text-gray-500 mb-4 line-clamp-2">客户: {opp.companyId || '未分配'}</p>
      <div className="flex justify-between items-center pt-3 border-t border-gray-100">
        <Link href={`/opportunity/${opp.id}`} className="text-sm text-blue-600 hover:text-blue-800 font-medium px-3 py-1.5 bg-blue-50 hover:bg-blue-100 rounded-md">
          处理邮件 & 详情
        </Link>
        <Link href={`/pi/${opp.id}`} className="text-sm text-gray-600 hover:text-gray-900 border border-gray-200 px-3 py-1.5 rounded-md hover:bg-gray-50">
          📄 生成 PI
        </Link>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <header className="mb-6 flex justify-between items-start bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 tracking-tight">ERDI 业务与商机看板</h1>
          <p className="text-sm text-gray-500 mt-1 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500"></span>
            当前登录: <span className="font-semibold text-gray-700">{currentUser}</span>
            <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-xs font-medium ml-1">{currentTitle}</span>
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end max-w-4xl">
          <NavBtn href="/whatsapp" color="green">💬 WhatsApp</NavBtn>
          <NavBtn href="/social" color="purple">🌐 社媒</NavBtn>
          <NavBtn href="/logistics" color="indigo">📦 物流</NavBtn>
          <NavBtn href="/customers" color="emerald">👥 客户</NavBtn>
          <NavBtn href="/users" color="indigo">🧑‍💼 员工</NavBtn>
          <NavBtn href="/products" color="amber">🛒 产品</NavBtn>
          <NavBtn href="/settings" color="gray">⚙️ 设置</NavBtn>
          <NavBtn href="/analytics" color="blue">📈 数据</NavBtn>
          <NavBtn href="/attendance" color="pink">📅 考勤</NavBtn>
          <NavBtn href="/expenses" color="orange">💰 报账</NavBtn>
          <NavBtn href="/shipments" color="teal">🚚 发货</NavBtn>
          <NavBtn href="/suppliers" color="purple">🏭 采购</NavBtn>
          <form action={logout}>
            <button type="submit" className="text-sm bg-gray-100 hover:bg-red-50 text-gray-600 hover:text-red-600 border border-gray-200 px-3 py-2 rounded-lg font-medium">退出</button>
          </form>
        </div>
      </header>

      {/* 数据概览卡 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="系统总漏斗" value={`$${totalAmount.toLocaleString()}`} color="text-green-600" />
        <StatCard label="本周 WhatsApp 新消息" value={`${waUnread}`} color="text-emerald-600" link="/whatsapp" />
        <StatCard label="待审批报销" value={`${pendingApprovals}`} color="text-orange-600" link="/expenses" />
        <StatCard label="在途运单" value={`${activeShipments}`} color="text-teal-600" link="/shipments" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Column title="新询盘确认" stage="SPEC_CONFIRMING" opps={opps} render={renderCard} />
        <Column title="样品测试" stage="NEGOTIATING" opps={opps} render={renderCard} />
        <Column title="已成单" stage="CLOSED_WON" opps={opps} render={renderCard} />
      </div>
    </div>
  );
}

function NavBtn({ href, color, children }: { href: string; color: string; children: React.ReactNode }) {
  const map: Record<string, string> = {
    green: 'bg-green-50 text-green-700 hover:bg-green-100 border-green-100',
    purple: 'bg-purple-50 text-purple-700 hover:bg-purple-100 border-purple-100',
    indigo: 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border-indigo-100',
    emerald: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border-emerald-100',
    amber: 'bg-amber-50 text-amber-700 hover:bg-amber-100 border-amber-100',
    gray: 'bg-gray-50 text-gray-700 hover:bg-gray-100 border-gray-200',
    blue: 'bg-blue-50 text-blue-700 hover:bg-blue-100 border-blue-100',
    pink: 'bg-pink-50 text-pink-700 hover:bg-pink-100 border-pink-100',
    orange: 'bg-orange-50 text-orange-700 hover:bg-orange-100 border-orange-100',
    teal: 'bg-teal-50 text-teal-700 hover:bg-teal-100 border-teal-100',
  };
  return (
    <Link href={href} className={`text-sm border px-3 py-2 rounded-lg font-medium transition-colors ${map[color]}`}>
      {children}
    </Link>
  );
}

function StatCard({ label, value, color, link }: { label: string; value: string; color: string; link?: string }) {
  const inner = (
    <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
    </div>
  );
  return link ? <Link href={link}>{inner}</Link> : inner;
}

function Column({ title, stage, opps, render }: { title: string; stage: string; opps: any[]; render: (o: any) => any }) {
  const list = opps.filter(o => o.stage === stage);
  return (
    <div className="bg-gray-100/50 rounded-xl p-4 border border-gray-200">
      <div className="flex justify-between items-center mb-4">
        <h2 className="font-semibold text-gray-700">{title}</h2>
        <span className="bg-gray-200 text-gray-600 text-xs px-2 py-1 rounded-full">{list.length}</span>
      </div>
      <div>
        {list.map(render)}
        {list.length === 0 && <div className="text-center py-10 text-gray-400 text-sm border-2 border-dashed border-gray-200 rounded-lg">暂无数据</div>}
      </div>
    </div>
  );
}

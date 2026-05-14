import { PrismaClient } from '@prisma/client';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
const prisma = new PrismaClient();

export default async function AnalyticsPage() {
  const role = cookies().get('auth_role')?.value;
  if (!role) redirect('/');

  const opps = await prisma.opportunity.findMany();
  const totalUSD = opps.filter(o => o.stage === 'CLOSED_WON').reduce((sum, o) => sum + (o.amountUSD || 0), 0);

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-8 bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h1 className="text-2xl font-bold text-gray-800">📈 全局业务数据大屏</h1>
          <Link href="/dashboard" className="text-blue-600 hover:bg-blue-50 px-4 py-2 rounded-lg font-medium transition-colors">← 返回看板</Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 text-center">
            <p className="text-sm text-gray-500 mb-2">总入库询盘数</p>
            <p className="text-4xl font-black text-gray-800">{opps.length}</p>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 text-center">
            <p className="text-sm text-gray-500 mb-2">已成单转化数</p>
            <p className="text-4xl font-black text-green-600">{opps.filter(o => o.stage === 'CLOSED_WON').length}</p>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 text-center">
            <p className="text-sm text-gray-500 mb-2">累计创收 (USD)</p>
            <p className="text-4xl font-black text-indigo-600">\${totalUSD}</p>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden p-8 text-center text-gray-500">
          <p className="mb-4 text-4xl">📊</p>
          <h2 className="text-xl font-bold text-gray-700 mb-2">可视化报表中心</h2>
          <p>图表渲染引擎已就绪，将在录入真实业务流后自动呈现业绩漏斗与排名。</p>
        </div>
      </div>
    </div>
  );
}

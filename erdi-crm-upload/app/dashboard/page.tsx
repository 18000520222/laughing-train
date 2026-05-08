import { PrismaClient } from '@prisma/client';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
const prisma = new PrismaClient();

export default async function Dashboard() {
  const cookieStore = cookies();
  const role = cookieStore.get('auth_role')?.value;
  // 动态读取当前登录者的邮箱和头衔！
  const currentUser = cookieStore.get('auth_email')?.value || '未知账号';
  const currentTitle = cookieStore.get('auth_title')?.value || '业务人员';

  if (role !== 'sales') {
    redirect('/');
  }

  const opps = await prisma.opportunity.findMany({
    orderBy: { createdAt: 'desc' }
  });

  const totalAmount = opps.reduce((sum, opp) => sum + (opp.amount || 0), 0);

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
        <span className="text-green-600 font-semibold">${opp.amount || 0}</span>
      </div>
      <p className="text-sm text-gray-500 mb-4 line-clamp-2">客户: {opp.companyId || '未分配'}</p>
      <div className="flex justify-between items-center pt-3 border-t border-gray-100">
        <Link href={`/opportunity/${opp.id}`} className="text-sm text-blue-600 hover:text-blue-800 font-medium px-3 py-1.5 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors">
          处理邮件 & 详情
        </Link>
        <Link href={`/pi/${opp.id}`} className="text-sm text-gray-600 hover:text-gray-900 border border-gray-200 px-3 py-1.5 rounded-md hover:bg-gray-50 transition-colors">
          📄 生成 PI
        </Link>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <header className="mb-8 flex justify-between items-center bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 tracking-tight">ERDI 业务与商机看板</h1>
          <p className="text-sm text-gray-500 mt-1 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500"></span>
            当前登录: <span className="font-semibold text-gray-700">{currentUser}</span> 
            <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-xs font-medium ml-1">{currentTitle}</span>
          </p>
        </div>
        
        {/* 👇 这里就是帮您改好的第四步：新增的物流中心入口按钮 👇 */}
        <div className="flex items-center gap-6">
          <Link href="/logistics" className="flex items-center gap-2 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 px-4 py-2 rounded-lg font-bold transition-colors border border-indigo-100 shadow-sm">
            📦 物流发货中心
          </Link>
          
          <div className="text-right border-l border-gray-200 pl-6">
            <p className="text-sm text-gray-500">系统总漏斗金额</p>
            <p className="text-3xl font-bold text-green-600">${totalAmount.toLocaleString()}</p>
          </div>
          <form action={logout}>
            <button type="submit" className="text-sm bg-gray-100 hover:bg-red-50 text-gray-600 hover:text-red-600 border border-gray-200 px-4 py-2 rounded-lg font-medium transition-colors">
              退出
            </button>
          </form>
        </div>
        {/* 👆 第四步修改结束 👆 */}

      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-gray-100/50 rounded-xl p-4 border border-gray-200">
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-semibold text-gray-700">新询盘确认</h2>
            <span className="bg-gray-200 text-gray-600 text-xs px-2 py-1 rounded-full">{opps.filter(o => o.stage === 'SPEC_CONFIRMING').length}</span>
          </div>
          <div>
            {opps.filter(o => o.stage === 'SPEC_CONFIRMING').map(renderCard)}
            {opps.filter(o => o.stage === 'SPEC_CONFIRMING').length === 0 && <div className="text-center py-10 text-gray-400 text-sm border-2 border-dashed border-gray-200 rounded-lg">暂无数据</div>}
          </div>
        </div>
        <div className="bg-gray-100/50 rounded-xl p-4 border border-gray-200">
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-semibold text-gray-700">样品测试</h2>
            <span className="bg-gray-200 text-gray-600 text-xs px-2 py-1 rounded-full">{opps.filter(o => o.stage === 'SAMPLE_TESTING').length}</span>
          </div>
          <div>
            {opps.filter(o => o.stage === 'SAMPLE_TESTING').map(renderCard)}
            {opps.filter(o => o.stage === 'SAMPLE_TESTING').length === 0 && <div className="text-center py-10 text-gray-400 text-sm border-2 border-dashed border-gray-200 rounded-lg">暂无数据</div>}
          </div>
        </div>
        <div className="bg-gray-100/50 rounded-xl p-4 border border-gray-200">
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-semibold text-gray-700">已成单</h2>
            <span className="bg-gray-200 text-gray-600 text-xs px-2 py-1 rounded-full">{opps.filter(o => o.stage === 'CLOSED_WON').length}</span>
          </div>
          <div>
            {opps.filter(o => o.stage === 'CLOSED_WON').map(renderCard)}
            {opps.filter(o => o.stage === 'CLOSED_WON').length === 0 && <div className="text-center py-10 text-gray-400 text-sm border-2 border-dashed border-gray-200 rounded-lg">暂无数据</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

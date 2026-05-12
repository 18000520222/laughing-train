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

 const totalAmount = opps.reduce((sum, opp) => sum + (opp.amountUSD || 0), 0);

 async function logout() {
 'use server';
 cookies().delete('auth_role');
 cookies().delete('auth_email');
 cookies().delete('auth_title');
 redirect('/');
 }

 const renderCard = (opp: any) => (
<Link
  key={opp.id}
  href={`/dashboard/${opp.id}`}
  className="block p-4 bg-white border border-gray-200 rounded-lg shadow hover:bg-gray-100 transition"
>
  <h3 className="text-lg font-bold text-gray-900 mb-2">{opp.title}</h3>
  <p className="text-2xl font-semibold text-blue-600 mb-2">${opp.amountUSD || 0}</p>
  <p className="text-sm text-gray-500">客户: {opp.companyId || '未分配'}</p>
  <div className="mt-4 flex gap-2">
    <button className="flex-1 py-2 px-3 text-sm font-medium text-center text-white bg-blue-700 rounded-lg hover:bg-blue-800 focus:ring-4 focus:outline-none focus:ring-blue-300">
      处理邮件 & 详情
    </button>
    <button className="py-2 px-3 text-sm font-medium text-center text-blue-700 bg-white border border-blue-700 rounded-lg hover:bg-blue-50 focus:ring-4 focus:outline-none focus:ring-blue-300">
      📄 生成 PI
    </button>
  </div>
</Link>
 );

 return (
<div className="min-h-screen bg-gray-50 p-6">
  <div className="max-w-7xl mx-auto">
    <div className="flex justify-between items-center mb-8">
      <div>
        <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">ERDI CRM 协作终端</h1>
        <p className="text-gray-500 mt-1">
          当前登录: <span className="font-semibold text-gray-700">{currentUser}</span> 
          ({currentTitle})
        </p>
      </div>
      <form action={logout}>
        <button type="submit" className="px-4 py-2 text-sm font-medium text-red-600 bg-white border border-red-200 rounded-md hover:bg-red-50 transition-colors">
          退出登录
        </button>
      </form>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div>
        <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
          <span className="w-3 h-3 bg-yellow-400 rounded-full"></span>
          新询盘确认
          <span className="ml-auto text-sm bg-gray-200 px-2 py-0.5 rounded-full">{opps.filter(o => o.stage === 'SPEC_CONFIRMING').length}</span>
        </h2>
        <div className="space-y-4">
          {opps.filter(o => o.stage === 'SPEC_CONFIRMING').map(renderCard)}
          {opps.filter(o => o.stage === 'SPEC_CONFIRMING').length === 0 && (
            <p className="text-gray-400 italic text-center py-8">暂无数据</p>
          )}
        </div>
      </div>

      <div>
        <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
          <span className="w-3 h-3 bg-blue-500 rounded-full"></span>
          样品测试
          <span className="ml-auto text-sm bg-gray-200 px-2 py-0.5 rounded-full">{opps.filter(o => o.stage === 'NEGOTIATING').length}</span>
        </h2>
        <div className="space-y-4">
          {opps.filter(o => o.stage === 'NEGOTIATING').map(renderCard)}
          {opps.filter(o => o.stage === 'NEGOTIATING').length === 0 && (
            <p className="text-gray-400 italic text-center py-8">暂无数据</p>
          )}
        </div>
      </div>

      <div>
        <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
          <span className="w-3 h-3 bg-green-500 rounded-full"></span>
          已成单
          <span className="ml-auto text-sm bg-gray-200 px-2 py-0.5 rounded-full">{opps.filter(o => o.stage === 'CLOSED_WON').length}</span>
        </h2>
        <div className="space-y-4">
          {opps.filter(o => o.stage === 'CLOSED_WON').map(renderCard)}
          {opps.filter(o => o.stage === 'CLOSED_WON').length === 0 && (
            <p className="text-gray-400 italic text-center py-8">暂无数据</p>
          )}
        </div>
      </div>
    </div>
  </div>
</div>
 );
}

import { PrismaClient } from '@prisma/client';
import Link from 'next/link';

const prisma = new PrismaClient();

// 强制动态渲染
export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  const opps = await prisma.opportunity.findMany({
    orderBy: { createdAt: 'desc' }
  });

  const totalAmount = opps.reduce((sum, opp) => sum + (opp.amount || 0), 0);

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      {/* 顶部导航 */}
      <header className="mb-8 flex justify-between items-center bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 tracking-tight">ERDI 业务与商机看板</h1>
          <p className="text-sm text-gray-500 mt-1 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500"></span>
            当前登录: sales@erdicn.com <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-xs font-medium">主理人</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm text-gray-500">系统总漏斗金额</p>
          <p className="text-3xl font-bold text-green-600">${totalAmount.toLocaleString()}</p>
        </div>
      </header>

      {/* 看板区域 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* 第一列：新询盘 / SPEC_CONFIRMING */}
        <div className="bg-gray-100/50 rounded-xl p-4 border border-gray-200">
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-semibold text-gray-700">新询盘确认 (Spec Confirming)</h2>
            <span className="bg-gray-200 text-gray-600 text-xs px-2 py-1 rounded-full">{opps.filter(o => o.stage === 'SPEC_CONFIRMING').length}</span>
          </div>
          
          <div className="space-y-4">
            {opps.filter(o => o.stage === 'SPEC_CONFIRMING').map(opp => (
              <div key={opp.id} className="bg-white p-5 rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow group relative">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-bold text-gray-800 text-lg">{opp.title}</h3>
                  <span className="text-green-600 font-semibold">${opp.amount || 0}</span>
                </div>
                <p className="text-sm text-gray-500 mb-4 line-clamp-2">客户: {opp.companyId || '未匹配公司'}</p>
                
                <div className="flex justify-between items-center pt-3 border-t border-gray-100">
                  <Link 
                    href={`/opportunity/${opp.id}`}
                    className="text-sm text-blue-600 hover:text-blue-800 font-medium px-3 py-1.5 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors"
                  >
                    处理邮件 & 详情
                  </Link>
                  <Link 
                    href={`/pi/${opp.id}`}
                    className="text-sm text-gray-600 hover:text-gray-900 border border-gray-200 px-3 py-1.5 rounded-md hover:bg-gray-50 transition-colors"
                  >
                    📄 生成 PI
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 预留第二列：样品测试 */}
        <div className="bg-gray-100/50 rounded-xl p-4 border border-gray-200">
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-semibold text-gray-700">样品测试 (Sample Testing)</h2>
            <span className="bg-gray-200 text-gray-600 text-xs px-2 py-1 rounded-full">0</span>
          </div>
          <div className="text-center py-10 text-gray-400 text-sm border-2 border-dashed border-gray-200 rounded-lg">
            暂无商机拖拽至此
          </div>
        </div>

        {/* 预留第三列：已赢单 */}
        <div className="bg-gray-100/50 rounded-xl p-4 border border-gray-200">
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-semibold text-gray-700">已成单 (Closed Won)</h2>
            <span className="bg-gray-200 text-gray-600 text-xs px-2 py-1 rounded-full">0</span>
          </div>
          <div className="text-center py-10 text-gray-400 text-sm border-2 border-dashed border-gray-200 rounded-lg">
            暂无成交记录
          </div>
        </div>

      </div>
    </div>
  );
}

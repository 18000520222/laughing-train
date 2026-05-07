import React from 'react';
import { PrismaClient } from '@prisma/client';
import { LogOut, FileText } from 'lucide-react';

const prisma = new PrismaClient();

// 去 Supabase 拉取真实数据
async function getOpportunities() {
  return await prisma.opportunity.findMany({
    include: { company: true },
    orderBy: { updatedAt: 'desc' }
  });
}

// 接收登录用户的邮箱参数
export default async function DashboardPage({ searchParams }: { searchParams: { user?: string } }) {
  const opps = await getOpportunities();
  
  // 识别身份
  const currentUser = searchParams.user || 'sales@erdicn.com';
  const isFinance = currentUser === '18628970297@163.com';

  const totalAmount = opps.reduce((sum, opp) => sum + (opp.amount || 0), 0);

  return (
    <div className="min-h-screen bg-slate-50 p-8 font-sans">
      <header className="mb-8 flex justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-gray-100">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">ERDI {isFinance ? '财务审核看板' : '业务与商机看板'}</h1>
          <p className="text-sm text-blue-600 mt-1 flex items-center">
            当前登录: <b>{currentUser}</b> 
            <span className="ml-2 px-2 py-0.5 bg-blue-100 rounded text-xs">{isFinance ? '财务专员' : '主理人'}</span>
          </p>
        </div>
        <div className="flex items-center space-x-6 text-slate-600">
          <div className="text-right">
            <p className="text-xs text-slate-400">系统总漏斗金额</p>
            <p className="text-lg font-bold text-emerald-600">${totalAmount.toLocaleString()}</p>
          </div>
          <a href="/login" className="p-2 hover:bg-red-50 rounded-lg text-red-500 transition-colors" title="退出">
            <LogOut className="w-5 h-5" />
          </a>
        </div>
      </header>

      {isFinance ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-gray-200 text-slate-500">
              <tr>
                <th className="p-4">客户公司</th>
                <th className="p-4">项目名称</th>
                <th className="p-4">预计金额</th>
                <th className="p-4">当前阶段</th>
              </tr>
            </thead>
            <tbody>
              {opps.map(opp => (
                <tr key={opp.id} className="border-b border-gray-100 hover:bg-slate-50">
                  <td className="p-4 font-semibold text-slate-800">{opp.company?.name || '未知公司'}</td>
                  <td className="p-4">{opp.title}</td>
                  <td className="p-4 font-bold text-emerald-600">${opp.amount?.toLocaleString()}</td>
                  <td className="p-4"><span className="px-2 py-1 bg-gray-100 rounded-full text-xs">{opp.stage}</span></td>
                </tr>
              ))}
              {opps.length === 0 && (
                <tr><td colSpan={4} className="p-8 text-center text-gray-400">数据库暂无真实商机，等待邮件抓取</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
            <h3 className="font-bold text-slate-800 mb-4">全部真实商机 (来自 Supabase)</h3>
            <div className="space-y-3">
              {opps.map(opp => (
                <div key={opp.id} className="flex justify-between items-center p-4 border border-gray-100 rounded-lg hover:border-blue-300">
                  <div>
                    <h4 className="font-bold text-slate-900">{opp.title}</h4>
                    <p className="text-xs text-gray-500 mt-1">客户: {opp.company?.name || '未知公司'} | 阶段: {opp.stage}</p>
                  </div>
                  <div className="flex items-center space-x-4">
                    <div className="font-bold text-emerald-600">${opp.amount?.toLocaleString()}</div>
                    {/* 一键生成 PI 的按钮 */}
                    <a href={`/pi/${opp.id}`} target="_blank" className="flex items-center text-xs bg-blue-50 text-blue-600 px-3 py-1.5 rounded hover:bg-blue-100 transition-colors">
                      <FileText className="w-3 h-3 mr-1" /> 生成 PI
                    </a>
                  </div>
                </div>
              ))}
              {opps.length === 0 && (
                <div className="text-center py-10 bg-blue-50 rounded-lg border border-blue-100">
                  <p className="text-blue-600 font-medium">✨ 系统连接成功！</p>
                  <p className="text-sm text-blue-400 mt-1">数据库已准备就绪，目前为空。等待邮件自动抓取...</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

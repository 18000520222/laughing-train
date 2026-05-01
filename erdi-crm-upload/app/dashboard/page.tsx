import React from 'react';
import { MoreHorizontal, Plus, Calendar, Search, Filter } from 'lucide-react';
const mockOpps = [
  { id: '1', title: '法国客户 3km 模块测试', company: 'AeroTech FR', amount: 12000, stage: 'SAMPLE_TESTING', tag: '1535nm', time: '2026-06-15' },
  { id: '2', title: '德国代理 批量采购谈判', company: 'Rhein Defense', amount: 85000, stage: 'NEGOTIATION', tag: '1064nm', time: '2026-05-30' },
  { id: '3', title: '美国测绘 新款选型', company: 'TopoSurvey USA', amount: 6000, stage: 'QUOTING', tag: '905nm', time: '2026-05-10' }
];
const STAGES = [
  { id: 'SPEC_CONFIRMING', name: '需求与规格确认', bg: 'bg-blue-50', border: 'border-blue-400' },
  { id: 'QUOTING', name: '报价 (PI Sent)', bg: 'bg-yellow-50', border: 'border-yellow-400' },
  { id: 'SAMPLE_TESTING', name: '样品测试中 (关键)', bg: 'bg-purple-50', border: 'border-purple-400' },
  { id: 'NEGOTIATION', name: '商务谈判 (批量)', bg: 'bg-orange-50', border: 'border-orange-400' },
];
export default function DashboardPage() {
  return (
    <div className="min-h-screen bg-gray-50 p-6 font-sans text-slate-800">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">ERDI 商机漏斗</h1>
          <p className="text-sm text-slate-500 mt-1">管理从规格确认到批量订单的完整生命周期</p>
        </div>
        <div className="flex space-x-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input type="text" placeholder="搜索公司、型号..." className="pl-9 pr-4 py-2 border rounded-lg text-sm outline-none w-64" />
          </div>
          <button className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
            <Plus className="h-4 w-4 mr-2" /> 新建商机
          </button>
        </div>
      </header>
      <div className="flex space-x-4 overflow-x-auto pb-6">
        {STAGES.map(stage => {
          const stageOpps = mockOpps.filter(opp => opp.stage === stage.id);
          return (
            <div key={stage.id} className="min-w-[320px] max-w-[320px] flex flex-col">
              <div className={`p-3 rounded-t-xl border-t-4 ${stage.border} ${stage.bg} flex justify-between items-center shadow-sm`}>
                <h3 className="font-semibold text-slate-800 flex items-center">
                  {stage.name} <span className="ml-2 bg-white text-xs px-2 py-0.5 rounded-full">{stageOpps.length}</span>
                </h3>
              </div>
              <div className="bg-gray-100/50 p-3 rounded-b-xl flex-1 border-x border-b border-gray-200 min-h-[500px] space-y-3">
                {stageOpps.map(opp => (
                  <div key={opp.id} className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 hover:shadow-md cursor-pointer">
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-xs font-semibold text-gray-500 uppercase">{opp.company}</span>
                      <MoreHorizontal className="h-4 w-4 text-gray-400" />
                    </div>
                    <h4 className="text-sm font-bold text-slate-900 mb-2">{opp.title}</h4>
                    <span className="inline-block bg-blue-50 text-blue-700 text-[11px] font-medium px-2 py-0.5 rounded border border-blue-100 mb-3">
                      {opp.tag}
                    </span>
                    <div className="flex items-center justify-between text-xs text-gray-500 pt-3 border-t border-gray-50">
                      <div className="font-medium text-slate-700">${opp.amount.toLocaleString()}</div>
                      <div className="flex items-center"><Calendar className="h-3 w-3 mr-1" />{opp.time}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

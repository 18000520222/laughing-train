import Link from 'next/link';

export default function LogisticsPage() {
  return (
    <div className="min-h-screen bg-slate-50 p-8 font-sans">
      <header className="mb-8 flex justify-between items-center bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 tracking-tight">物流发货中心</h1>
          <p className="text-sm text-gray-500 mt-1">管理订单物流状态与发货跟进</p>
        </div>
        <Link href="/dashboard" className="px-5 py-2.5 bg-gray-100 text-gray-700 font-medium rounded-lg hover:bg-gray-200 transition-colors">
          返回看板
        </Link>
      </header>
      <div className="bg-white p-12 rounded-xl shadow-sm border border-gray-100 text-center">
        <span className="text-4xl">🚚</span>
        <h2 className="text-xl font-bold text-gray-800 mt-4">物流模块准备就绪</h2>
        <p className="text-gray-500 mt-2">支持对接第三方物流 API，当前单据已支持手动录入物流单号归档至商机附件库。</p>
      </div>
    </div>
  );
}

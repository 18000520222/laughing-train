"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell
} from 'recharts';

export default function AnalyticsPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/analytics')
      .then(res => res.json())
      .then(d => {
        if (d.error) throw new Error(d.error);
        setData(d);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="min-h-screen bg-slate-50 p-8 flex items-center justify-center font-sans"><div className="text-gray-500 font-medium">数据加载中...</div></div>;
  if (error) return <div className="min-h-screen bg-slate-50 p-8 flex items-center justify-center font-sans"><div className="text-red-500 font-medium">错误: {error}</div></div>;

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'];

  return (
    <div className="min-h-screen bg-slate-50 p-8 font-sans">
      <header className="mb-8 flex justify-between items-center bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 tracking-tight">全景业绩与漏斗分析</h1>
          <p className="text-sm text-gray-500 mt-1">
            {data.role === 'SUPER_ADMIN' || data.role === 'ADMIN' || data.role === 'FINANCE' 
              ? "公司全局业务数据分析 (高管视角)" 
              : "我的个人业绩与漏斗情况 (业务视角)"}
          </p>
        </div>
        <div className="flex gap-4">
          <Link href="/dashboard" className="px-5 py-2.5 bg-gray-100 text-gray-700 font-medium rounded-lg hover:bg-gray-200 transition-colors">
            返回看板
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 border-l-4 border-l-blue-500">
          <h3 className="text-gray-500 text-sm font-medium">总客户数</h3>
          <p className="text-3xl font-bold text-gray-800 mt-2">{data.totalCustomers}</p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 border-l-4 border-l-amber-500">
          <h3 className="text-gray-500 text-sm font-medium">进行中商机金额</h3>
          <p className="text-3xl font-bold text-gray-800 mt-2">${data.pipelineAmount.toLocaleString()}</p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 border-l-4 border-l-green-500">
          <h3 className="text-gray-500 text-sm font-medium">累计成交金额 (回款)</h3>
          <p className="text-3xl font-bold text-gray-800 mt-2">${data.wonAmount.toLocaleString()}</p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 border-l-4 border-l-purple-500">
          <h3 className="text-gray-500 text-sm font-medium">商机赢单率</h3>
          <p className="text-3xl font-bold text-gray-800 mt-2">{data.winRate}%</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h2 className="text-lg font-bold text-gray-800 mb-6">销售漏斗分布 (金额)</h2>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.funnelData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip formatter={(value) => `${value}`} />
                <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h2 className="text-lg font-bold text-gray-800 mb-6">近期业绩走势 (美元)</h2>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.trendData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip formatter={(value) => `${value}`} />
                <Line type="monotone" dataKey="amount" stroke="#10b981" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 8 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {(data.role === 'SUPER_ADMIN' || data.role === 'ADMIN' || data.role === 'FINANCE') && data.employeeData && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-8">
          <div className="p-6 border-b border-gray-100 bg-gray-50/50">
            <h2 className="text-lg font-bold text-gray-800">业务员战报排行 (高管视角)</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-sm border-b border-gray-100">
                  <th className="p-4 font-medium">业务员</th>
                  <th className="p-4 font-medium">负责客户数</th>
                  <th className="p-4 font-medium">进行中商机数</th>
                  <th className="p-4 font-medium">赢单数 (已成交)</th>
                  <th className="p-4 font-medium text-right">总业绩贡献 (USD)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.employeeData.map((emp: any, i: number) => (
                  <tr key={i} className="hover:bg-gray-50/50 transition-colors">
                    <td className="p-4 font-bold text-gray-800">{emp.name}</td>
                    <td className="p-4">{emp.customers}</td>
                    <td className="p-4">{emp.pipelineCount}</td>
                    <td className="p-4">{emp.wonCount}</td>
                    <td className="p-4 text-right font-bold text-green-600">${emp.wonAmount.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

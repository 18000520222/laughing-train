import { PrismaClient } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
const prisma = new PrismaClient();

export default async function LogisticsPage() {
  // 检查是否登录
  const role = cookies().get('auth_role')?.value;
  if (!role) redirect('/');

  // 查出所有“已成单”等待发货或已发货的订单
  const opps = await prisma.opportunity.findMany({
    where: { stage: 'CLOSED_WON' },
    orderBy: { updatedAt: 'desc' }
  });

  // 保存运单号的后台指令
  async function saveTracking(formData: FormData) {
    'use server';
    const id = String(formData.get('id'));
    const carrier = String(formData.get('carrier'));
    const trackingNumber = String(formData.get('trackingNumber')).trim();

    await prisma.opportunity.update({
      where: { id },
      data: { carrier, trackingNumber }
    });
    revalidatePath('/logistics');
  }

  // 自动生成官方追踪链接
  const getTrackingLink = (carrier: string, num: string) => {
    if (!num) return '#';
    if (carrier === 'DHL') return `https://www.dhl.com/global-en/home/tracking/tracking-express.html?submit=1&tracking-id=${num}`;
    if (carrier === 'UPS') return `https://www.ups.com/track?track=yes&trackNums=${num}`;
    if (carrier === 'FedEx') return `https://www.fedex.com/fedextrack/?trknbr=${num}`; // 顺手帮您把联邦快递也接了！
    return '#';
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <header className="mb-8 flex justify-between items-center bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 tracking-tight">📦 国际发货与物流中心</h1>
          <p className="text-sm text-gray-500 mt-1">仅显示已成单 (CLOSED_WON) 的订单</p>
        </div>
        <Link href="/dashboard" className="text-blue-600 bg-blue-50 px-4 py-2 rounded-lg font-medium hover:bg-blue-100 transition-colors">
          ← 返回业务看板
        </Link>
      </header>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-100 text-gray-700 text-sm font-semibold">
              <th className="p-4 border-b">成单项目</th>
              <th className="p-4 border-b">承运商 (Carrier) & 运单号</th>
              <th className="p-4 border-b text-right">追踪状态</th>
            </tr>
          </thead>
          <tbody>
            {opps.map(opp => (
              <tr key={opp.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                <td className="p-4">
                  <p className="font-bold text-gray-800 text-base">{opp.title}</p>
                  <p className="text-sm text-gray-500">{opp.companyId || '未分配客户'}</p>
                </td>
                <td className="p-4">
                  <form action={saveTracking} className="flex gap-2 items-center">
                    <input type="hidden" name="id" value={opp.id} />
                    <select name="carrier" defaultValue={opp.carrier || ''} className="border border-gray-300 p-2 rounded-md text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none">
                      <option value="">未发货</option>
                      <option value="DHL">DHL Express</option>
                      <option value="UPS">UPS</option>
                      <option value="FedEx">FedEx</option>
                    </select>
                    <input 
                      type="text" 
                      name="trackingNumber" 
                      defaultValue={opp.trackingNumber || ''} 
                      placeholder="输入单号 (例: 1Z999...)" 
                      className="border border-gray-300 p-2 rounded-md text-sm w-56 font-mono focus:ring-2 focus:ring-blue-500 outline-none" 
                    />
                    <button type="submit" className="bg-gray-800 text-white px-3 py-2 rounded-md text-sm font-bold hover:bg-black transition-colors">
                      保存
                    </button>
                  </form>
                </td>
                <td className="p-4 text-right">
                  {opp.carrier && opp.trackingNumber ? (
                    <a 
                      href={getTrackingLink(opp.carrier, opp.trackingNumber)} 
                      target="_blank" 
                      rel="noreferrer" 
                      className="inline-flex items-center gap-2 text-white bg-green-600 px-4 py-2 rounded-lg text-sm font-bold shadow-md hover:bg-green-700 hover:shadow-lg transition-all"
                    >
                      🌍 官网轨迹追踪
                    </a>
                  ) : (
                    <span className="text-gray-400 text-sm font-medium flex items-center justify-end gap-1">
                      <span className="w-2 h-2 rounded-full bg-gray-300"></span> 等待录入
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {opps.length === 0 && (
          <div className="p-16 text-center text-gray-400 font-medium">
            目前还没有已成单的订单需要发货哦
          </div>
        )}
      </div>
    </div>
  );
}

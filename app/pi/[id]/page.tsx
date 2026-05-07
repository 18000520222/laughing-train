import { PrismaClient } from '@prisma/client';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

const prisma = new PrismaClient();

// Next.js 最新版要求 params 必须是 Promise 结构
export default async function PIDocument({ params }: { params: Promise<{ id: string }> }) {
  // 正确解析 ID 的方式
  const resolvedParams = await params;
  const oppId = resolvedParams.id;

  if (!oppId) {
    notFound();
  }

  // 去数据库查询真实的商机数据
  const opp = await prisma.opportunity.findUnique({
    where: { id: oppId }
  });

  if (!opp) {
    notFound();
  }

  // 计算一个过期时间 (30天后)
  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + 30);

  return (
    <div className="min-h-screen bg-gray-100 p-8 print:p-0 print:bg-white flex justify-center">
      {/* A4 纸张容器 */}
      <div className="bg-white w-[210mm] min-h-[297mm] shadow-2xl print:shadow-none p-12 relative">
        
        {/* 顶部：公司抬头 */}
        <header className="border-b-2 border-gray-800 pb-6 mb-8 flex justify-between items-end">
          <div>
            <h1 className="text-4xl font-black text-gray-900 tracking-tighter">ERDI TECH LTD</h1>
            <p className="text-gray-500 text-sm mt-2">Laser & Optical Technology OEM/ODM</p>
          </div>
          <div className="text-right">
            <h2 className="text-3xl font-light text-blue-800 tracking-widest">PROFORMA INVOICE</h2>
            <p className="text-gray-600 mt-2 font-mono">No. PI-{new Date().getFullYear()}{new Date().getMonth()+1}-{oppId.substring(0,4).toUpperCase()}</p>
            <p className="text-gray-500 text-sm">Date: {new Date().toLocaleDateString()}</p>
          </div>
        </header>

        {/* 客户与卖方信息 */}
        <div className="flex justify-between mb-10 text-sm">
          <div className="w-1/2 pr-4">
            <h3 className="font-bold text-gray-800 mb-2 border-b border-gray-200 pb-1">BILL TO:</h3>
            <p className="font-bold text-gray-700">{opp.companyId || 'Client Company Name'}</p>
            <p className="text-gray-600 mt-1">Email: {opp.title.replace('New Inquiry from ', '')}</p>
          </div>
          <div className="w-1/2 pl-4">
            <h3 className="font-bold text-gray-800 mb-2 border-b border-gray-200 pb-1">FROM:</h3>
            <p className="font-bold text-gray-700">ERDI TECH LTD</p>
            <p className="text-gray-600 mt-1">Chengdu, China</p>
            <p className="text-gray-600">Email: sales@erdicn.com</p>
          </div>
        </div>

        {/* 商品列表 (占位演示，后续可从数据库读 Product) */}
        <table className="w-full mb-10 border-collapse">
          <thead>
            <tr className="bg-gray-100 text-gray-800 text-sm">
              <th className="py-2 px-3 text-left border border-gray-300 w-12">No.</th>
              <th className="py-2 px-3 text-left border border-gray-300">Description / Specifications</th>
              <th className="py-2 px-3 text-center border border-gray-300 w-20">Qty</th>
              <th className="py-2 px-3 text-right border border-gray-300 w-32">Unit Price (USD)</th>
              <th className="py-2 px-3 text-right border border-gray-300 w-32">Amount (USD)</th>
            </tr>
          </thead>
          <tbody>
            <tr className="text-sm">
              <td className="py-3 px-3 border-b border-gray-200 text-center text-gray-500">1</td>
              <td className="py-3 px-3 border-b border-gray-200">
                <p className="font-bold text-gray-800">Laser Rangefinder Module</p>
                <p className="text-gray-500 text-xs mt-1">Custom specifications as discussed via email.</p>
              </td>
              <td className="py-3 px-3 border-b border-gray-200 text-center">1</td>
              <td className="py-3 px-3 border-b border-gray-200 text-right">${opp.amount || 0}</td>
              <td className="py-3 px-3 border-b border-gray-200 text-right font-semibold">${opp.amount || 0}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="border-t-2 border-gray-800"></td>
              <td className="py-3 px-3 text-right font-bold text-gray-700">TOTAL:</td>
              <td className="py-3 px-3 text-right font-bold text-xl text-blue-800 border-t-2 border-gray-800">${opp.amount || 0}</td>
            </tr>
          </tfoot>
        </table>

        {/* 银行信息与条款 */}
        <div className="text-sm text-gray-600 bg-gray-50 p-4 rounded border border-gray-200 mb-8">
          <h3 className="font-bold text-gray-800 mb-2">BANKING DETAILS (T/T in Advance)</h3>
          <p>Bank Name: [Your Bank Name]</p>
          <p>Swift Code: [Your Swift Code]</p>
          <p>A/C No.: [Your Account Number]</p>
          <p>Beneficiary: ERDI TECH LTD</p>
        </div>

        {/* 底部盖章签名区 */}
        <div className="absolute bottom-12 right-12 w-48 text-center">
          <p className="mb-16 text-sm text-gray-500">Authorized Signature</p>
          <div className="border-t border-gray-800 pt-2">
            <p className="font-bold text-gray-800 text-sm">ERDI TECH LTD</p>
          </div>
        </div>

        {/* 悬浮打印按钮 (打印时自动隐藏) */}
        <button 
          onClick={() => window.print()}
          className="fixed bottom-8 right-8 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-full shadow-lg print:hidden transition-transform transform hover:scale-105 flex items-center gap-2"
        >
          🖨️ 打印 / 存为 PDF
        </button>

      </div>
    </div>
  );
}

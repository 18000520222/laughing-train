import { PrismaClient } from '@prisma/client';

export const dynamic = 'force-dynamic';
const prisma = new PrismaClient();

export default async function SalesContract({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  const oppId = resolvedParams?.id;
  if (!oppId) return <div className="p-10 text-red-500 font-bold">❌ 错误：缺少商机 ID</div>;

  const opp = await prisma.opportunity.findUnique({
    where: { id: String(oppId) },
    include: { product: true }
  });

  if (!opp) return <div className="p-10 text-red-500 font-bold">❌ 错误：找不到该商机。</div>;

  let contractData = null;
  const isClosedWon = opp.stage === 'CLOSED_WON';
  const hasLockedData = opp.lockedContract && typeof opp.lockedContract === 'object';

  if (isClosedWon && hasLockedData) {
    contractData = opp.lockedContract as any;
  } else {
    const safeTitle = opp.title || '';
    const email = safeTitle.replace('New Inquiry from ', '');
    const shortId = String(oppId).substring(0, 4).toUpperCase();
    
    contractData = {
      contractNumber: `SC-${new Date().getFullYear()}${new Date().getMonth()+1}-${shortId}`,
      date: new Date().toLocaleDateString(),
      companyName: opp.companyId || 'Client Company Name',
      email: email,
      amountUSD: opp.amountUSD || 0,
      description: opp.product?.enName || opp.product?.name || "Laser Rangefinder Module",
      hsCode: opp.product?.hsCode || "",
      isFrozen: false
    };

    if (isClosedWon && !hasLockedData) {
      contractData.isFrozen = true;
      await prisma.opportunity.update({
        where: { id: opp.id },
        data: { lockedContract: contractData }
      });
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 p-8 print:p-0 print:bg-white flex justify-center">
      <div className="bg-white w-[210mm] min-h-[297mm] shadow-2xl print:shadow-none p-12 relative">
        {contractData.isFrozen && (
          <div className="absolute top-10 right-10 border-4 border-red-500 text-red-500 font-black text-2xl px-4 py-2 transform rotate-12 opacity-80 print:opacity-100 print:text-gray-500 print:border-gray-500 z-10">
            OFFICIAL ARCHIVED
          </div>
        )}

        <header className="border-b-2 border-gray-800 pb-6 mb-8 flex justify-between items-end relative z-0">
          <div>
            <h1 className="text-4xl font-black text-gray-900 tracking-tighter">ERDI TECH LTD</h1>
            <p className="text-gray-500 text-sm mt-2">Laser & Optical Technology OEM/ODM</p>
          </div>
          <div className="text-right">
            <h2 className="text-3xl font-light text-indigo-800 tracking-widest">SALES CONTRACT</h2>
            <p className="text-gray-600 mt-2 font-mono">No. {contractData.contractNumber}</p>
            <p className="text-gray-500 text-sm">Date: {contractData.date}</p>
          </div>
        </header>

        <div className="flex justify-between mb-10 text-sm relative z-0">
          <div className="w-1/2 pr-4">
            <h3 className="font-bold text-gray-800 mb-2 border-b border-gray-200 pb-1">BILL TO:</h3>
            <p className="font-bold text-gray-700">{contractData.companyName}</p>
            <p className="text-gray-600 mt-1">Email: {contractData.email}</p>
          </div>
          <div className="w-1/2 pl-4">
            <h3 className="font-bold text-gray-800 mb-2 border-b border-gray-200 pb-1">FROM:</h3>
            <p className="font-bold text-gray-700">ERDI TECH LTD</p>
            <p className="text-gray-600 mt-1">Chengdu, China</p>
            <p className="text-gray-600">Email: sales@erdicn.com</p>
          </div>
        </div>

        <table className="w-full mb-10 border-collapse relative z-0">
          <thead>
            <tr className="bg-gray-100 text-gray-800 text-sm">
              <th className="py-2 px-3 text-left border border-gray-300 w-12">No.</th>
              <th className="py-2 px-3 text-left border border-gray-300">Description</th>
              <th className="py-2 px-3 text-left border border-gray-300">HS Code</th>
              <th className="py-2 px-3 text-center border border-gray-300 w-16">Qty</th>
              <th className="py-2 px-3 text-right border border-gray-300 w-24">Unit Price</th>
              <th className="py-2 px-3 text-right border border-gray-300 w-24">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr className="text-sm">
              <td className="py-3 px-3 border-b border-gray-200 text-center text-gray-500">1</td>
              <td className="py-3 px-3 border-b border-gray-200 font-bold text-gray-800">{contractData.description}</td>
              <td className="py-3 px-3 border-b border-gray-200 text-gray-600">{contractData.hsCode || '-'}</td>
              <td className="py-3 px-3 border-b border-gray-200 text-center">1</td>
              <td className="py-3 px-3 border-b border-gray-200 text-right">${contractData.amountUSD}</td>
              <td className="py-3 px-3 border-b border-gray-200 text-right font-semibold">${contractData.amountUSD}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="border-t-2 border-gray-800"></td>
              <td className="py-3 px-3 text-right font-bold text-gray-700">TOTAL:</td>
              <td className="py-3 px-3 text-right font-bold text-xl text-indigo-800 border-t-2 border-gray-800">${contractData.amountUSD}</td>
            </tr>
          </tfoot>
        </table>

        <div className="absolute bottom-12 right-12 w-48 text-center z-0">
          <p className="mb-16 text-sm text-gray-500">Authorized Signature</p>
          <div className="border-t border-gray-800 pt-2">
            <p className="font-bold text-gray-800 text-sm">ERDI TECH LTD</p>
          </div>
        </div>

        <div className="fixed bottom-8 right-8 bg-gray-800 text-white py-3 px-6 rounded shadow-lg print:hidden flex items-center gap-2 z-50">
          🖨️ 打印或导出 PDF：请按 <kbd className="bg-gray-600 px-2 py-1 rounded mx-1">⌘ + P</kbd>
        </div>
      </div>
    </div>
  );
}

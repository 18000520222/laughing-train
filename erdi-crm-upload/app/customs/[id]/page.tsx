import { PrismaClient } from '@prisma/client';

export const dynamic = 'force-dynamic';
const prisma = new PrismaClient();

export default async function CustomsDeclaration({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  const oppId = resolvedParams?.id;
  if (!oppId) return <div className="p-10 text-red-500 font-bold">❌ 错误：缺少商机 ID</div>;

  const opp = await prisma.opportunity.findUnique({
    where: { id: String(oppId) },
    include: { product: true }
  });

  if (!opp) return <div className="p-10 text-red-500 font-bold">❌ 错误：找不  到该商机。</div>;

  let customsData = null;
  const isClosedWon = opp.stage === 'CLOSED_WON';
  const hasLockedData = opp.lockedCustomsData && typeof opp.lockedCustomsData === 'object';

  if (isClosedWon && hasLockedData) {
    customsData = opp.lockedCustomsData as any;
  } else {
    const shortId = String(oppId).substring(0, 4).toUpperCase();
    customsData = {
      customsNumber: `CD-${new Date().getFullYear()}${new Date().getMonth()+1}-${shortId}`,
      date: new Date().toLocaleDateString(),
      companyName: opp.companyId || 'Client Company Name',
      amountUSD: opp.amountUSD || 0,
      description: opp.product?.enName || opp.product?.name || "Laser Rangefinder Module",
      hsCode: opp.product?.hsCode || "",
      isFrozen: false
    };

    if (isClosedWon && !hasLockedData) {
      customsData.isFrozen = true;
      await prisma.opportunity.update({
        where: { id: opp.id },
        data: { lockedCustomsData: customsData }
      });
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 p-8 print:p-0 print:bg-white flex justify-center">
      <div className="bg-white w-[210mm] min-h-[297mm] p-12">
        <h2 className="text-3xl font-light text-indigo-800">CUSTOMS DECLARATION ELEMENTS</h2>
        <p className="text-gray-600 mt-2 font-mono">No. {customsData.customsNumber}</p>
        <p className="text-gray-500 text-sm">HS Code: {customsData.hsCode}</p>
        <p className="text-gray-500 text-sm">Product: {customsData.description}</p>
      </div>
    </div>
  );
}

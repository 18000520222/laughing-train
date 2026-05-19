import { PrismaClient } from '@prisma/client';


export const dynamic = 'force-dynamic';
const prisma = new PrismaClient();


export default async function CustomsDeclaration({ params }: { params: { id: string } }) {
  
  const oppId = params?.id;
  if (!oppId) return <div className="p-10 text-red-500 font-bold">❌ 错误：缺少商机 ID</div>;


  const opp = await prisma.opportunity.findUnique({
    where: { id: String(oppId) },
    include: { product: true }
  });


  if (!opp) return <div className="p-10 text-red-500 font-bold">❌ 错误：找不  到该商机。</div>;


  let customsData = null;
  const isClosedWon = opp.stage === 'CLOSED_WON';
  const hasLockedData = opp.customsData && typeof opp.customsData === 'object';


  if (isClosedWon && hasLockedData) {
    customsData = opp.customsData as any;
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

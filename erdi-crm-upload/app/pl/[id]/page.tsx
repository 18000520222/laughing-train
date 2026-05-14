import { PrismaClient } from '@prisma/client';


export const dynamic = 'force-dynamic';
const prisma = new PrismaClient();


export default async function PackingList({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  const oppId = resolvedParams?.id;
  if (!oppId) return <div className="p-10 text-red-500 font-bold">❌ 错误：缺少商机 ID</div>;


  const opp = await prisma.opportunity.findUnique({
    where: { id: String(oppId) },
    include: { product: true }
  });


  if (!opp) return <div className="p-10 text-red-500 font-bold">❌ 错误：找不到该商机。</div>;


  let plData = null;
  const isClosedWon = opp.stage === 'CLOSED_WON';
  const hasLockedData = opp.lockedPlData && typeof opp.lockedPlData === 'object';


  if (isClosedWon && hasLockedData) {
    plData = opp.lockedPlData as any;
  } else {
    const safeTitle = opp.title || '';
    const email = safeTitle.replace('New Inquiry from ', '');
    const shortId = String(oppId).substring(0, 4).toUpperCase();
    
    plData = {
      plNumber: `PL-${new Date().getFullYear()}${new Date().getMonth()+1}-${shortId}`,
      date: new Date().toLocaleDateString(),
      companyName: opp.companyId || 'Client Company Name',
      email: email,
      amountUSD: opp.amountUSD || 0,
      description: opp.product?.enName || opp.product?.name || "Laser Rangefinder Module",
      hsCode: opp.product?.hsCode || "",

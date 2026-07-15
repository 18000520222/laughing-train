// app/api/search/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { companyAccessWhere, opportunityAccessWhere } from '@/lib/data-access';



export async function GET(req: Request) {
  const session = await getSession();
  if (!session || !can(session.role, 'dashboard.read')) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const q = new URL(req.url).searchParams.get('q')?.trim();
  if (!q || q.length < 1) return NextResponse.json({ results: [] });

  const [companies, opps, products, shipments] = await Promise.all([
    prisma.company.findMany({
      where: { ...companyAccessWhere(session), AND: [{ OR: [{ name: { contains: q, mode: 'insensitive' } }, { country: { contains: q, mode: 'insensitive' } }] }] },
      take: 5,
    }),
    prisma.opportunity.findMany({
      where: { ...opportunityAccessWhere(session), AND: [{ OR: [{ title: { contains: q, mode: 'insensitive' } }, { opportunityCode: { contains: q, mode: 'insensitive' } }] }] },
      take: 5,
    }),
    prisma.product.findMany({
      where: { OR: [{ name: { contains: q, mode: 'insensitive' } }, { sku: { contains: q, mode: 'insensitive' } }, { enName: { contains: q, mode: 'insensitive' } }] },
      take: 5,
    }),
    prisma.shipment.findMany({
      where: { trackingNumber: { contains: q, mode: 'insensitive' } },
      include: { opportunity: { select: { title: true } } },
      take: 5,
    }),
  ]);

  const results = [
    ...companies.map(c => ({ type: 'customer', id: c.id, title: c.name, subtitle: c.country, link: `/customers/${c.id}` })),
    ...opps.map(o => ({ type: 'opportunity', id: o.id, title: o.title, subtitle: o.opportunityCode, link: `/opportunity/${o.id}` })),
    ...products.map(p => ({ type: 'product', id: p.id, title: `${p.sku} · ${p.name}`, subtitle: p.enName, link: `/products` })),
    ...shipments.map(s => ({ type: 'shipment', id: s.id, title: s.trackingNumber || '(无运单号)', subtitle: s.opportunity?.title, link: `/shipments` })),
  ];

  return NextResponse.json({ results });
}

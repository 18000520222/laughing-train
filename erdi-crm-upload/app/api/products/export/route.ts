import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';
import { toCsv } from '@/lib/csv';

export const dynamic = 'force-dynamic';

export async function GET() {
  const role = (cookies().get('auth_role')?.value || '').toUpperCase();
  if (!role) return new Response('unauthorized', { status: 401 });

  const products = await prisma.product.findMany({ orderBy: { id: 'desc' } });

  const headers = ['SKU', '中文品名', '英文品名', '分类', '售价USD', 'HS编码', '规格型号', '波长', '材质', '用途', '品牌', '产地', '单位'];
  const rows = products.map((p: any) => [
    p.sku, p.name, p.enName || '', p.category, p.basePriceUSD ?? '', p.hsCode || '', p.specifications || '',
    p.wavelength || '', p.material || '', p.usage || '', p.brand || '', p.origin || '', p.unit || '',
  ]);

  const csv = toCsv(headers, rows);
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="products-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}

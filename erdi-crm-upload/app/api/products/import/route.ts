import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { parseCsv, rowsToObjects } from '@/lib/csv';
import { getSession } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { writeAuditLog } from '@/lib/audit';

export const dynamic = 'force-dynamic';

function pick(o: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) if (o[k] != null && o[k] !== '') return o[k].trim();
  return '';
}
function toNum(v: string): number | null {
  if (!v) return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !can(session.role, 'products.write')) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const form = await req.formData();
  const file = form.get('file') as File | null;
  const mode = String(form.get('mode') || 'skip'); // skip | update
  if (!file) return NextResponse.json({ error: '未上传文件' }, { status: 400 });

  const text = await file.text();
  const objs = rowsToObjects(parseCsv(text));

  let created = 0, updated = 0, skipped = 0;
  const errors: { row: number; reason: string }[] = [];

  for (let i = 0; i < objs.length; i++) {
    const o = objs[i];
    const rowNo = i + 2;
    try {
      const sku = pick(o, 'SKU', 'sku', '编号').toUpperCase();
      const name = pick(o, '中文品名', '品名', 'name');
      const category = pick(o, '分类', 'category') || '未分类';
      if (!sku) { errors.push({ row: rowNo, reason: '缺少 SKU' }); continue; }
      if (!name) { errors.push({ row: rowNo, reason: '缺少品名' }); continue; }

      const data: any = {
        name,
        enName: pick(o, '英文品名', 'enName') || null,
        category,
        basePriceUSD: toNum(pick(o, '售价USD', 'basePriceUSD', '售价')),
        hsCode: pick(o, 'HS编码', 'hsCode') || null,
        specifications: pick(o, '规格型号', '规格', 'specifications') || null,
        wavelength: pick(o, '波长', 'wavelength') || null,
        material: pick(o, '材质', 'material') || null,
        usage: pick(o, '用途', 'usage') || null,
        brand: pick(o, '品牌', 'brand') || null,
        origin: pick(o, '产地', 'origin') || null,
        unit: pick(o, '单位', 'unit') || null,
      };

      const existing = await prisma.product.findUnique({ where: { sku } });
      if (existing) {
        if (mode === 'update') {
          await prisma.product.update({ where: { sku }, data });
          updated++;
        } else skipped++;
      } else {
        await prisma.product.create({ data: { sku, ...data } });
        created++;
      }
    } catch (e: any) {
      errors.push({ row: rowNo, reason: String(e?.message || e).slice(0, 120) });
    }
  }

  await writeAuditLog(session, {
    action: 'PRODUCTS_IMPORTED', entityType: 'Product', summary: '批量导入产品',
    metadata: { total: objs.length, created, updated, skipped, errorCount: errors.length },
  });

  return NextResponse.json({ ok: true, total: objs.length, created, updated, skipped, errorCount: errors.length, errors });
}

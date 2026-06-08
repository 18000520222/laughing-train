import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { parseCsv, rowsToObjects } from '@/lib/csv';
import { ensureCustomerCode } from '@/lib/customer-code';

export const dynamic = 'force-dynamic';

const TYPE_MAP: Record<string, string> = {
  '新客户': 'NEW', '老客户': 'EXISTING', '潜在客户': 'PROSPECT', '重点客户': 'KEY_ACCOUNT', '流失客户': 'LOST',
  'NEW': 'NEW', 'EXISTING': 'EXISTING', 'PROSPECT': 'PROSPECT', 'KEY_ACCOUNT': 'KEY_ACCOUNT', 'LOST': 'LOST',
};

// 表头别名 → 标准字段
function pick(o: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) if (o[k] != null && o[k] !== '') return o[k].trim();
  return '';
}

export async function POST(req: Request) {
  const role = (cookies().get('auth_role')?.value || '').toUpperCase();
  if (role !== 'SALES' && role !== 'SUPER_ADMIN' && role !== 'ADMIN') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

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
    const rowNo = i + 2; // 含表头
    try {
      const name = pick(o, '公司名称', '公司名', 'name', 'Company');
      if (!name) { errors.push({ row: rowNo, reason: '缺少公司名称' }); continue; }

      const codeIn = pick(o, '客户编号', 'customerCode', 'code');
      const typeRaw = pick(o, '客户类型', 'type');
      const type = TYPE_MAP[typeRaw] || 'PROSPECT';
      const country = pick(o, '国家', 'country');
      const industry = pick(o, '行业', 'industry');
      const website = pick(o, '官网', 'website');

      const email = pick(o, '邮箱', 'email', 'Email');
      const firstName = pick(o, '联系人名', 'firstName');
      const lastName = pick(o, '联系人姓', 'lastName');
      const title = pick(o, '职位', 'title');
      const phone = pick(o, '电话', 'phone');

      // 去重：优先按客户编号，其次按公司名
      let existing = null as any;
      if (codeIn) existing = await prisma.company.findUnique({ where: { customerCode: codeIn } });
      if (!existing) existing = await prisma.company.findFirst({ where: { name } });

      let companyId: string;
      if (existing) {
        if (mode === 'update') {
          await prisma.company.update({
            where: { id: existing.id },
            data: {
              name,
              type: type as any,
              country: country || existing.country,
              industry: industry || existing.industry,
              website: website || existing.website,
            },
          });
          updated++;
        } else {
          skipped++;
        }
        companyId = existing.id;
      } else {
        const customerCode = await ensureCustomerCode(codeIn);
        const c = await prisma.company.create({
          data: { name, customerCode, type: type as any, country: country || null, industry: industry || null, website: website || null, source: 'IMPORT' },
        });
        companyId = c.id;
        created++;
      }

      // 联系人（有邮箱才建，按邮箱去重）
      if (email && firstName) {
        const ce = await prisma.contact.findUnique({ where: { email } });
        if (!ce) {
          await prisma.contact.create({
            data: { firstName, lastName: lastName || null, email, phone: phone || null, title: title || null, companyId },
          });
        }
      }
    } catch (e: any) {
      errors.push({ row: rowNo, reason: String(e?.message || e).slice(0, 120) });
    }
  }

  return NextResponse.json({ ok: true, total: objs.length, created, updated, skipped, errorCount: errors.length, errors });
}

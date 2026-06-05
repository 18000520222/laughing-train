import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const KEY = 'erdi-sl-2026';

type Cust = {
  email: string;
  name: string;
  company: string;
  country: string;
  phone: string;
  orders: number;
  paid: number;
};

// 7 个真实 SHOPLINE 下单客户(已剔除自家/测试/刷单)
const CUSTOMERS: Cust[] = [
  { email: '1540nm@gmail.com', name: '', company: '', country: '', phone: '', orders: 1, paid: 0 },
  { email: 'tprice@xcimer.net', name: '', company: 'Xcimer', country: '', phone: '', orders: 1, paid: 0 },
  { email: 'sylvain.champagne@drdc-rddc.gc.ca', name: '', company: 'DRDC-RDDC', country: '', phone: '', orders: 1, paid: 0 },
  { email: 'mithun@slipstream.co.site', name: '', company: 'Slipstream', country: '', phone: '', orders: 2, paid: 0 },
  { email: 'selim.yonet@ynttech.com', name: '', company: 'YNT Tech', country: '', phone: '', orders: 1, paid: 0 },
  { email: 'claes@emt.uni-paderborn.de', name: 'Leander Claes', company: 'EMT', country: 'Germany', phone: '+495251604950', orders: 1, paid: 1 },
  { email: 'tom@odinworks.com', name: 'Thomas hines', company: 'Odinworks', country: 'United States', phone: '2089061405', orders: 1, paid: 1 },
];

const FREE = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'qq.com', '163.com', '126.com', 'icloud.com'];

function splitName(name: string, email: string): { firstName: string; lastName: string | null } {
  const dn = (name || '').trim();
  if (dn) {
    const parts = dn.split(/\s+/);
    if (parts.length >= 2) return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
    return { firstName: dn, lastName: null };
  }
  return { firstName: email.split('@')[0], lastName: null };
}

function companyName(c: Cust): string {
  if (c.company) return c.company;
  const domain = (c.email.split('@')[1] || '').toLowerCase();
  if (domain && !FREE.includes(domain)) {
    const first = domain.split('.')[0];
    return first.charAt(0).toUpperCase() + first.slice(1);
  }
  // 个人邮箱兜底:用显示名,否则用邮箱本地段
  return c.name || c.email.split('@')[0];
}

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('key') !== KEY) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = await prisma.user.findFirst({
    where: { role: 'SUPER_ADMIN', isActive: true },
    select: { id: true },
  });

  const result: any[] = [];

  for (const c of CUSTOMERS) {
    const email = c.email.toLowerCase().trim();
    const existing = await prisma.contact.findUnique({
      where: { email },
      include: { company: true },
    });

    if (existing?.company) {
      // 已存在:补全 country/phone,记录 merged
      const patch: any = {};
      if (c.country && !existing.company.country) patch.country = c.country;
      if (Object.keys(patch).length) {
        await prisma.company.update({ where: { id: existing.company.id }, data: patch });
      }
      if (c.phone) {
        await prisma.contact.update({ where: { id: existing.id }, data: { phone: existing.phone || c.phone } });
      }
      result.push({ email, action: 'merged', company: existing.company.name });
      continue;
    }

    const cname = companyName(c);
    let company = await prisma.company.findFirst({ where: { name: cname } });
    if (!company) {
      company = await prisma.company.create({
        data: {
          name: cname,
          source: 'SHOPLINE',
          type: c.paid > 0 ? 'EXISTING' : 'PROSPECT',
          country: c.country || undefined,
          isPublic: false,
          ownerId: admin?.id ?? undefined,
        },
      });
    } else if (c.country && !company.country) {
      await prisma.company.update({ where: { id: company.id }, data: { country: c.country } });
    }

    const { firstName, lastName } = splitName(c.name, email);
    if (existing && !existing.companyId) {
      await prisma.contact.update({ where: { id: existing.id }, data: { companyId: company.id, phone: existing.phone || c.phone || undefined } });
      result.push({ email, action: 'linked', company: cname });
    } else {
      await prisma.contact.create({
        data: { firstName, lastName: lastName ?? undefined, email, phone: c.phone || undefined, companyId: company.id },
      });
      result.push({ email, action: 'created', company: cname });
    }
  }

  const summary = result.reduce((a: any, r) => { a[r.action] = (a[r.action] || 0) + 1; return a; }, {});
  return NextResponse.json({ ok: true, total: CUSTOMERS.length, summary, result });
}

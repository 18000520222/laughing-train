import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const KEY = 'erdi-inbox-2026';

type Cust = { email: string; name: string; company: string };

// 63 个从 Gmail 收件箱(sales@erdicn.com)清洗出的真实询盘/客户(已剔除营销/通知/物流/SaaS/供应商)
const CUSTOMERS: Cust[] = [
  { email: 'raphael.moreno@optosd.com.br', name: 'Raphael Pereira Moreno', company: 'Optosd' },
  { email: 'prashant.setty@maztechindustries.com', name: 'Prashant Setty', company: 'Maztechindustries' },
  { email: 'thanh.nt@atekvietnam.com', name: 'Thanh NT', company: 'Atekvietnam' },
  { email: 'austin.grendel@bcm.edu', name: 'Grendel', company: 'BCM' },
  { email: 'revans@cffr.org', name: 'Robert Evans Jr', company: 'CFFR' },
  { email: 'caspar.wasle@dlr.de', name: '', company: 'DLR' },
  { email: 'ys_teng@memsorcorp.com', name: '', company: 'Memsorcorp' },
  { email: 'mithun@slipstream.co.site', name: 'Mithun', company: 'Slipstream' },
  { email: 'v.metelsky@seltok-inst.com', name: '', company: 'Seltok-inst' },
  { email: 'daniel.junior@optosd.com.br', name: 'Daniel dos Santos Junior', company: 'Optosd' },
  { email: 'mwalsh@laserdyne.com.au', name: 'Mic Walsh', company: 'Laserdyne' },
  { email: 'alofconsult75@gmail.com', name: 'ALOF', company: '' },
  { email: 'wojnarwaldek@gmail.com', name: 'Waldemar Wojnar', company: '' },
  { email: 'ariel.l@nextvision-sys.com', name: 'Ariel Lotzov', company: 'Nextvision-sys' },
  { email: 'p.omelchenko@lenlasers.ru', name: 'Омельченко Павел', company: 'Lenlasers' },
  { email: 'bdrventures@yahoo.com', name: 'BDR Ventures LLC', company: '' },
  { email: 'eugene@zeykan.com', name: 'Eugene Zeykan', company: 'Zeykan' },
  { email: 'o.korniienko@seltok-inst.com', name: '', company: 'Seltok-inst' },
  { email: 'vijay.sathya@adtl.co.in', name: 'Vijay Sathya S', company: 'ADTL' },
  { email: 'marie.hellwig@dlr.de', name: 'Marie Hellwig', company: 'DLR' },
  { email: 'purchasing@brolis-defence.com', name: 'BROLIS Purchasing', company: 'Brolis-defence' },
  { email: 'ashraf@ariegsa.com', name: 'Ashraf Fadel', company: 'Ariegsa' },
  { email: 'alex19581959@yandex.by', name: 'Levadny Aleks', company: '' },
  { email: 'sl.tire.b.v@gmail.com', name: 'Dmytro', company: 'SL Tire BV' },
  { email: 'bodko82@gmail.com', name: 'Богдан Вишневський', company: '' },
  { email: 'maccallister.higgins@gmail.com', name: 'MacCallister Higgins', company: '' },
  { email: 'claes@emt.uni-paderborn.de', name: 'Leander Claes', company: 'EMT' },
  { email: 'prakhar@newagein.com', name: 'prakhar', company: 'Newagein' },
  { email: 'whseo@basolutions.co.kr', name: '서운호', company: 'Basolutions' },
  { email: 'jskim@panoptics.net', name: '', company: 'Panoptics' },
  { email: 'marcjg@mail.uni-paderborn.de', name: 'marcjg', company: 'Uni Paderborn' },
  { email: 'pichardodolcerw@gmail.com', name: 'Neha', company: '' },
  { email: 'zyue52134@gmail.com', name: 'yue zhou', company: '' },
  { email: 'tom@odinworks.com', name: 'Tom Hines', company: 'Odinworks' },
  { email: 'irem.gencer@cezerirobot.com', name: '', company: 'Cezerirobot' },
  { email: 'bruna.silva@akaer.com.br', name: 'Bruna de Fatima Ribeiro Silva', company: 'Akaer' },
  { email: 'infobyvortek@gmail.com', name: 'Vortek Info', company: '' },
  { email: 'damla.ocak@transvaro.com', name: 'Damla OCAK', company: 'Transvaro' },
  { email: 'johan.axelsson@axis.com', name: 'Johan Axelsson', company: 'AXIS' },
  { email: 'eosystem.sam@gmail.com', name: 'EO System', company: '' },
  { email: 'hihwan93@eost.kr', name: '안영환', company: 'EOST' },
  { email: 'william.n.potter4.civ@us.navy.mil', name: 'William N Potter', company: 'US Navy' },
  { email: 'sylee@topins.co.kr', name: '이세영', company: 'Topins' },
  { email: 'taoer0947@gmail.com', name: 'TsungJun', company: '' },
  { email: 'o.keraidy@itechs-group.com', name: 'Omar Keraidy', company: 'Itechs-group' },
  { email: 'rno.omc@mod.gov.om', name: 'RNO OMC', company: 'Oman MOD' },
  { email: 'thkim@lightron.co.kr', name: '김택형', company: 'Lightron' },
  { email: 'k.hryniuk@skyeton.com', name: 'Khrystyna Hryniuk', company: 'Skyeton' },
  { email: 'james.johnson@bcm.edu', name: 'James Johnson', company: 'BCM' },
  { email: 'scott.jenney@bcm.edu', name: 'Scott Jenney', company: 'BCM' },
  { email: 'fatih.alemdar@baykartech.com', name: 'Fatih Alemdar', company: 'Baykartech' },
  { email: 'selim.yonet@ynttech.com', name: 'selim yönet', company: 'Ynttech' },
  { email: 'hamdm@spg.co.kr', name: '함동명', company: 'SPG' },
  { email: 'thomas.milner@bcm.edu', name: 'Thomas Milner', company: 'BCM' },
  { email: '66mam66mam@gmail.com', name: 'Asad Asadi', company: '' },
  { email: 'viv@sea.com.ua', name: 'Волевач Іван', company: 'SEA' },
  { email: 'tmm@sea.com.ua', name: 'Mykola Tymchuk', company: 'SEA' },
  { email: 'ed@brolis-defence.com', name: 'Edgaras Dvinelis', company: 'Brolis-defence' },
  { email: 'shelemanov@inscience.ru', name: 'Andrey Shelemanov', company: 'Inscience' },
  { email: 'vashu.kashyp@navyuginfo.com', name: 'Vashu Kashyap', company: 'Navyuginfo' },
  { email: 'oleksandr.korniienko@seltokphotonics.com', name: 'Oleksandr Korniienko', company: 'Seltokphotonics' },
  { email: 'purchase1@peterlimited.hk', name: '', company: 'Peterlimited' },
  { email: 'cong.gihan@gmail.com', name: 'Thanhcong Nguyen', company: '' },
];

const FREE = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'qq.com', '163.com', '126.com', 'icloud.com', 'yandex.by', 'aol.com'];

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
  return c.name || c.email.split('@')[0];
}

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('key') !== KEY) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const start = parseInt(req.nextUrl.searchParams.get('start') || '0', 10);
  const count = parseInt(req.nextUrl.searchParams.get('count') || '100', 10);
  const batch = CUSTOMERS.slice(start, start + count);

  const admin = await prisma.user.findFirst({
    where: { role: 'SUPER_ADMIN', isActive: true },
    select: { id: true },
  });

  const result: any[] = [];

  for (const c of batch) {
    const email = c.email.toLowerCase().trim();
    const existing = await prisma.contact.findUnique({ where: { email }, include: { company: true } });

    if (existing?.company) {
      result.push({ email, action: 'merged', company: existing.company.name });
      continue;
    }

    const cname = companyName(c);
    let company = await prisma.company.findFirst({ where: { name: cname } });
    if (!company) {
      company = await prisma.company.create({
        data: { name: cname, source: 'GMAIL_INBOX', type: 'PROSPECT', isPublic: false, ownerId: admin?.id ?? undefined },
      });
    }

    const { firstName, lastName } = splitName(c.name, email);
    if (existing && !existing.companyId) {
      await prisma.contact.update({ where: { id: existing.id }, data: { companyId: company.id } });
      result.push({ email, action: 'linked', company: cname });
    } else {
      await prisma.contact.create({
        data: { firstName, lastName: lastName ?? undefined, email, companyId: company.id },
      });
      result.push({ email, action: 'created', company: cname });
    }
  }

  const summary = result.reduce((a: any, r) => { a[r.action] = (a[r.action] || 0) + 1; return a; }, {});
  return NextResponse.json({ ok: true, total: CUSTOMERS.length, start, count: batch.length, summary, result });
}

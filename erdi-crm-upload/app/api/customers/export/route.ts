import { prisma } from '@/lib/prisma';
import { toCsv } from '@/lib/csv';
import { getSession } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { companyAccessWhere } from '@/lib/data-access';

export const dynamic = 'force-dynamic';

const TYPE_LABEL: Record<string, string> = {
  INQUIRY: '询盘客户', QUOTED: '已报价客户', CONTRACT_SENT: '已发合同客户', DEAL_WON: '已成交客户',
  NEW: '新客户', EXISTING: '已成交/老客户', PROSPECT: '潜在客户', KEY_ACCOUNT: '老客户/大客户', LOST: '流失客户',
};

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || !can(session.role, 'customers.export')) return new Response('forbidden', { status: 403 });

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get('q') || '').trim();

  const where: any = companyAccessWhere(session);
  if (q) where.AND = [{ OR: [{ name: { contains: q, mode: 'insensitive' } }, { customerCode: { contains: q, mode: 'insensitive' } }, { country: { contains: q, mode: 'insensitive' } }] }];

  const companies = await prisma.company.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: { contacts: { take: 1, orderBy: { createdAt: 'asc' } } },
  });

  const headers = ['客户编号', '公司名称', '客户类型', '优先级评分', '主营/关注产品', '客户画像', '痛点', '竞品/竞争对手', '下一步动作', '国家', '行业', '官网', '联系人名', '联系人姓', '职位', '邮箱', '电话', '创建时间'];
  const rows = companies.map((c: any) => {
    const ct = c.contacts?.[0];
    return [
      c.customerCode || '', c.name, TYPE_LABEL[c.type] || c.type, c.priorityScore || 0, c.mainProducts || '', c.customerProfile || '', c.painPoints || '', c.competitors || '', c.nextAction || '', c.country || '', c.industry || '', c.website || '',
      ct?.firstName || '', ct?.lastName || '', ct?.title || '', ct?.email || '', ct?.phone || '',
      new Date(c.createdAt).toISOString().slice(0, 10),
    ];
  });

  const csv = toCsv(headers, rows);
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="customers-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}

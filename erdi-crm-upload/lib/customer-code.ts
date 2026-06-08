import { prisma } from '@/lib/prisma';

// 生成下一个客户编号：CUST-{年}-{4位序号}
// 取当年已有编号的最大序号 +1。允许人工编号与自动编号共存。
export async function nextCustomerCode(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `CUST-${year}-`;
  const rows = await prisma.company.findMany({
    where: { customerCode: { startsWith: prefix } },
    select: { customerCode: true },
  });
  let max = 0;
  for (const r of rows) {
    const tail = (r.customerCode || '').slice(prefix.length);
    const n = parseInt(tail, 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

// 确保编号唯一：若给定编号已存在或为空，自动生成一个未占用的编号
export async function ensureCustomerCode(input?: string | null): Promise<string> {
  const wanted = (input || '').trim();
  if (wanted) {
    const exists = await prisma.company.findUnique({ where: { customerCode: wanted } });
    if (!exists) return wanted;
  }
  // 自动生成，循环避免极端并发碰撞
  for (let i = 0; i < 20; i++) {
    const code = await nextCustomerCode();
    const exists = await prisma.company.findUnique({ where: { customerCode: code } });
    if (!exists) return code;
  }
  // 兜底：加时间戳
  return `CUST-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;
}

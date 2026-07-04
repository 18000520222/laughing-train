import { prisma } from '@/lib/prisma';

export async function createDefaultSalesAssignmentRules(createdById?: string | null) {
  const owners = await prisma.user.findMany({
    where: { role: { in: ['SUPER_ADMIN', 'ADMIN', 'SALES'] as any }, isActive: true },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    select: { id: true },
  });
  const ownerIds = owners.map((u) => u.id);
  if (ownerIds.length === 0) return { created: 0 };

  const templates = [
    {
      name: '高优先级询盘优先分配',
      description: '优先级评分 >= 70 的新询盘先分给当前客户负载最少的业务员。',
      priority: 10,
      customerTypes: ['INQUIRY', 'QUOTED', 'PROSPECT', 'NEW'],
      minPriorityScore: 70,
      sources: [] as string[],
      distribution: 'LOWEST_LOAD',
    },
    {
      name: '邮件/Gmail 询盘轮流分配',
      description: '来自邮箱聚合的新询盘按轮流方式分配,避免客户无人跟。',
      priority: 20,
      customerTypes: ['INQUIRY', 'PROSPECT', 'NEW'],
      minPriorityScore: 0,
      sources: ['EMAIL', 'GMAIL_INBOX'],
      distribution: 'ROUND_ROBIN',
    },
    {
      name: '重点渠道线索轮流分配',
      description: '阿里、WhatsApp、LinkedIn、Facebook 等渠道线索进入销售队列。',
      priority: 30,
      customerTypes: ['INQUIRY', 'PROSPECT', 'NEW'],
      minPriorityScore: 0,
      sources: ['ALIBABA', 'WHATSAPP', 'LINKEDIN', 'FACEBOOK'],
      distribution: 'ROUND_ROBIN',
    },
  ];

  let created = 0;
  for (const tpl of templates) {
    const exists = await prisma.salesAssignmentRule.findFirst({ where: { name: tpl.name } });
    if (exists) continue;
    await prisma.salesAssignmentRule.create({
      data: {
        ...tpl,
        customerTypes: tpl.customerTypes as any,
        countries: [],
        ownerIds,
        distribution: tpl.distribution as any,
        createdById: createdById || null,
      },
    });
    created++;
  }
  return { created };
}

export async function executeSalesAssignmentRules() {
  const [rules, candidates, salesUsers] = await Promise.all([
    prisma.salesAssignmentRule.findMany({ where: { isActive: true }, orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] }),
    prisma.company.findMany({
      where: { ownerId: null },
      orderBy: [{ priorityScore: 'desc' }, { createdAt: 'desc' }],
      take: 200,
      include: { _count: { select: { inboxMessages: true, opportunities: true } } },
    }),
    prisma.user.findMany({ where: { role: { in: ['SUPER_ADMIN', 'ADMIN', 'SALES'] as any }, isActive: true }, select: { id: true, name: true, email: true } }),
  ]);

  const ownerLoad = new Map(
    await Promise.all(
      salesUsers.map(async (u) => [u.id, await prisma.company.count({ where: { ownerId: u.id } })] as const)
    )
  );
  const usersById = new Map(salesUsers.map((u) => [u.id, u]));
  const runStats = new Map<string, { scannedCount: number; assignedCount: number; customers: string[] }>();

  const matches = (rule: any, company: any) => {
    if (company.priorityScore < rule.minPriorityScore) return false;
    if (rule.customerTypes.length > 0 && !rule.customerTypes.includes(company.type)) return false;
    if (rule.countries.length > 0) {
      const country = String(company.country || '').toLowerCase();
      if (!rule.countries.some((c: string) => country.includes(c.toLowerCase()))) return false;
    }
    if (rule.sources.length > 0) {
      const source = String(company.source || '').toLowerCase();
      if (!rule.sources.some((s: string) => source.includes(s.toLowerCase()))) return false;
    }
    return true;
  };

  const pickOwner = (rule: any) => {
    const ownerIds = rule.ownerIds.filter((id: string) => usersById.has(id));
    if (ownerIds.length === 0) return null;
    if (rule.distribution === 'FIXED_OWNER') return ownerIds[0];
    if (rule.distribution === 'LOWEST_LOAD') {
      return ownerIds.sort((a: string, b: string) => (ownerLoad.get(a) || 0) - (ownerLoad.get(b) || 0))[0];
    }
    const lastIndex = ownerIds.indexOf(rule.lastAssignedOwnerId || '');
    return ownerIds[(lastIndex + 1) % ownerIds.length];
  };

  for (const company of candidates) {
    for (const rule of rules) {
      const stat = runStats.get(rule.id) || { scannedCount: 0, assignedCount: 0, customers: [] };
      stat.scannedCount++;
      runStats.set(rule.id, stat);
      if (!matches(rule, company)) continue;

      const ownerId = pickOwner(rule);
      if (!ownerId) continue;
      const nextAction = company.nextAction || (company.priorityScore >= 70 ? '高优先级询盘:今天内完成首轮跟进' : '新线索:24小时内完成首轮跟进');

      await prisma.company.update({
        where: { id: company.id },
        data: {
          ownerId,
          nextAction,
          priorityScore: Math.max(company.priorityScore || 0, company._count.inboxMessages > 0 ? 60 : 0),
        },
      });
      await prisma.notification.create({
        data: {
          userId: ownerId,
          type: 'SYSTEM',
          title: '新客户已分配',
          body: `${company.name} 已按规则「${rule.name}」分配给你。下一步:${nextAction}`,
          link: `/customers/${company.id}`,
        },
      });
      await prisma.salesAssignmentRule.update({ where: { id: rule.id }, data: { lastAssignedOwnerId: ownerId } });

      ownerLoad.set(ownerId, (ownerLoad.get(ownerId) || 0) + 1);
      stat.assignedCount++;
      stat.customers.push(company.name);
      break;
    }
  }

  let assignedCount = 0;
  for (const rule of rules) {
    const stat = runStats.get(rule.id) || { scannedCount: 0, assignedCount: 0, customers: [] };
    assignedCount += stat.assignedCount;
    await prisma.salesAssignmentRun.create({
      data: {
        ruleId: rule.id,
        scannedCount: stat.scannedCount,
        assignedCount: stat.assignedCount,
        summary: { customers: stat.customers.slice(0, 20) },
      },
    });
  }

  return { scannedRules: rules.length, candidateCount: candidates.length, assignedCount };
}

import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { canReadAllSalesData, companyAccessWhere, opportunityAccessWhere } from '@/lib/data-access';



export async function GET() {
  try {
    const session = await getSession();
    if (!session || !can(session.role, 'analytics.read')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const role = session.role;
    const isGlobal = canReadAllSalesData(session);
    
    // Build query filters based on role
    const oppFilter = opportunityAccessWhere(session);
    const custFilter = companyAccessWhere(session);

    const opportunities = await prisma.opportunity.findMany({ where: oppFilter, include: { owner: true } });
    const totalCustomers = await prisma.company.count({ where: custFilter });

    let pipelineAmount = 0;
    let wonAmount = 0;
    let wonCount = 0;
    let lostCount = 0;

    const funnelMap: Record<string, number> = {
      'UNPROCESSED': 0,
      'QUOTING': 0,
      'NEGOTIATING': 0,
      'CLOSED_WON': 0,
      'CLOSED_LOST': 0
    };

    opportunities.forEach(opp => {
      const amt = opp.amountUSD || 0;
      if (opp.stage !== 'CLOSED_LOST') {
        funnelMap[opp.stage] = (funnelMap[opp.stage] || 0) + amt;
      }
      
      if (opp.stage === 'CLOSED_WON') {
        wonAmount += amt;
        wonCount++;
      } else if (opp.stage === 'CLOSED_LOST') {
        lostCount++;
      } else {
        pipelineAmount += amt;
      }
    });

    const winRate = (wonCount + lostCount) > 0 ? Math.round((wonCount / (wonCount + lostCount)) * 100) : 0;

    const funnelData = [
      { name: '新询盘', value: funnelMap['UNPROCESSED'] },
      { name: '已报价', value: funnelMap['QUOTING'] },
      { name: '洽谈中', value: funnelMap['NEGOTIATING'] },
      { name: '已成交', value: wonAmount },
    ];

    const monthStarts = Array.from({ length: 6 }, (_, index) => {
      const date = new Date();
      date.setDate(1);
      date.setHours(0, 0, 0, 0);
      date.setMonth(date.getMonth() - (5 - index));
      return date;
    });
    const trendData = monthStarts.map((start, index) => {
      const end = index === monthStarts.length - 1
        ? new Date(start.getFullYear(), start.getMonth() + 1, 1)
        : monthStarts[index + 1];
      return {
        date: `${start.getMonth() + 1}月`,
        amount: opportunities
          .filter((opportunity) => opportunity.stage === 'CLOSED_WON' && opportunity.updatedAt >= start && opportunity.updatedAt < end)
          .reduce((sum, opportunity) => sum + (opportunity.amountUSD || 0), 0),
      };
    });

    let employeeData = null;
    if (isGlobal) {
      const users = await prisma.user.findMany({
        where: { isActive: true, role: { in: ['SALES', 'ADMIN', 'SUPER_ADMIN'] } },
        include: { _count: { select: { customers: true } } },
      });
      employeeData = users.map(u => {
        const uOpps = opportunities.filter(o => o.ownerId === u.id);
        const uWon = uOpps.filter(o => o.stage === 'CLOSED_WON');
        return {
          name: u.name,
          customers: u._count.customers,
          pipelineCount: uOpps.filter(o => o.stage !== 'CLOSED_WON' && o.stage !== 'CLOSED_LOST').length,
          wonCount: uWon.length,
          wonAmount: uWon.reduce((sum, o) => sum + (o.amountUSD || 0), 0)
        };
      }).sort((a, b) => b.wonAmount - a.wonAmount);
    }

    return NextResponse.json({
      role,
      totalCustomers,
      pipelineAmount,
      wonAmount,
      winRate,
      funnelData,
      trendData,
      employeeData
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

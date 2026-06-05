import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';



export async function GET() {
  try {
    const cookieStore = cookies();
    const role = cookieStore.get('auth_role')?.value;
    const userId = cookieStore.get('auth_userId')?.value;

    if (!role || !userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isGlobal = ['SUPER_ADMIN', 'ADMIN', 'FINANCE'].includes(role);
    
    // Build query filters based on role
    const oppFilter = isGlobal ? {} : { ownerId: userId };
    const custFilter = isGlobal ? {} : { ownerId: userId };

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

    // Simple trend data (group by month/day of creation) - simplified for demo
    const trendData = [
      { date: '1月', amount: 0 },
      { date: '2月', amount: 0 },
      { date: '3月', amount: 0 },
      { date: '4月', amount: 0 },
      { date: '5月', amount: wonAmount }, // Just assigning current won to May for visual
    ];

    let employeeData = null;
    if (isGlobal) {
      const users = await prisma.user.findMany();
      employeeData = users.map(u => {
        const uOpps = opportunities.filter(o => o.ownerId === u.id);
        const uWon = uOpps.filter(o => o.stage === 'CLOSED_WON');
        return {
          name: u.name,
          customers: 0, // Simplified
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

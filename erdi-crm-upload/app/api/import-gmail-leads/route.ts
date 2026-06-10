import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const adminUser = await prisma.user.findUnique({
      where: { email: 'sales@erdicn.com' }
    });

    if (!adminUser) return NextResponse.json({ error: 'Admin user not found' }, { status: 404 });

    const leads = [
      { code: 'ED1127', name: 'Ariel Lotzov', email: 'Ariel.l@nextvision-sys.com', company: 'NextVision Stabilized Systems LTD', summary: 'Refund and follow-up for Diode Pump module' },
      { code: 'ED1128', name: 'Prakhar Sharda', email: 'prakhar@newagein.com', company: 'New Age Instruments & Materials Pvt. Ltd.', summary: 'LRF software, SDK and troubleshooting' },
      { code: 'ED1129', name: 'Pavel Omelchenko', email: 'p.omelchenko@lenlasers.ru', company: 'SC LLS', summary: 'Inquiry for 1064nm laser modules (10mJ/20mJ)' },
      { code: 'ED1130', name: 'Tom Hines', email: 'tom@odinworks.com', company: 'ODIN Works', summary: 'LRF2000A sample and UART protocol request' },
      { code: 'ED1131', name: 'Info LLS', email: 'info@lenlasers.ru', company: 'SC LLS', summary: 'General inquiry for laser components' },
      { code: 'ED1132', name: 'Ariel Lotzov', email: 'Ariel.l@nextvision-sys.com', company: 'NextVision', summary: 'Bank coordination for refund transfer' },
      { code: 'ED1133', name: 'Boris Kipnis', email: 'borisk@nextvision-sys.com', company: 'NextVision Stabilized Systems LTD', summary: 'Cold outreach: SWaP reduction (20-25% lighter modules), mechanical stability, and UART/SDK integration.' },
      { code: 'ED1134', name: 'Miri Levinsky', email: 'miri.l@nextvision-sys.com', company: 'NextVision Stabilized Systems LTD', summary: 'Cold outreach: ITAR-Free supply, international compliance, and finance logs.' },
      { code: 'ED1135', name: 'Idan Fridman', email: 'idan.fridman@elbitsystems.com', company: 'Elbit Systems', summary: 'Cold outreach: Micro-gimbal weight optimization (14g modules).' },
      { code: 'ED1136', name: 'Michal Grossberg', email: 'michal.grossberg@elbitsystems.com', company: 'Elbit Systems', summary: 'Cold outreach: High-precision laser sensor SDK and environmental stability.' },
      { code: 'ED1137', name: 'Aselsan Marketing', email: 'marketing@aselsan.com.tr', company: 'Aselsan', summary: 'Cold outreach: Long-range (5km+) eye-safe laser modules for stabilized EO/IR turrets.' },
      { code: 'ED1138', name: 'Baykar Technologies', email: 'info@baykartech.com', company: 'Baykar Technologies', summary: 'Cold outreach: ITAR-Free procurement advantage for UAV platforms.' },
      { code: 'ED1139', name: 'EDGE Group / ADASI', email: 'info@edgegroup.ae', company: 'EDGE Group / ADASI', summary: 'Cold outreach: SWaP-C optimization and GCC desert-tested high-temperature stability (+60°C).' }
    ];

    let count = 0;
    for (const lead of leads) {
      // Find or create Company
      let company = await prisma.company.findFirst({
        where: {
          OR: [
            { customerCode: lead.code },
            { name: lead.company }
          ]
        }
      });

      if (!company) {
        company = await prisma.company.create({
          data: {
            customerCode: lead.code,
            name: lead.company,
            ownerId: adminUser.id,
            source: 'EMAIL'
          }
        });
      }

      // Find or create Contact
      let contact = await prisma.contact.findUnique({
        where: { email: lead.email }
      });

      if (!contact) {
        contact = await prisma.contact.create({
          data: {
            firstName: lead.name,
            email: lead.email,
            companyId: company.id
          }
        });
      }

      // Check if opportunity already exists under this company
      const oppTitle = `Imported Lead: ${lead.summary}`;
      const existingOpp = await prisma.opportunity.findFirst({
        where: {
          companyId: company.id,
          title: oppTitle
        }
      });

      if (!existingOpp) {
        await prisma.opportunity.create({
          data: {
            title: oppTitle,
            amountUSD: 0,
            stage: 'UNPROCESSED',
            ownerId: adminUser.id,
            companyId: company.id
          }
        });
        count++;
      }
    }

    return NextResponse.json({ message: `✅ 成功同步 \${count} 个新客户及开发线索到 CRM！`, totalProcessed: leads.length });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

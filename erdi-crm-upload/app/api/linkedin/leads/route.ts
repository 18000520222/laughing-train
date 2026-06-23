// app/api/linkedin/leads/route.ts
// 拉取所有 LinkedIn 账号下的 Lead Gen Forms 提交记录
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ingestInbound } from '@/lib/inbox';



export async function POST(req: Request) {
  const accounts = await prisma.socialAccount.findMany({ where: { platform: 'LINKEDIN' } });
  let imported = 0;

  for (const acc of accounts) {
    try {
      // 真实接入需要 organization URN 与 Lead Gen Form Asset ID
      // 这里调用 leadFormResponses endpoint 拉取最近的提交
      const res = await fetch('https://api.linkedin.com/rest/leadFormResponses?q=owner&owner.type=ORGANIZATION', {
        headers: {
          Authorization: `Bearer ${acc.accessToken}`,
          'LinkedIn-Version': '202401',
          'X-Restli-Protocol-Version': '2.0.0',
        },
      });
      const data = await res.json();

      for (const lead of data.elements || []) {
        const answers: Record<string, string> = {};
        for (const a of lead.answers || []) {
          answers[a.questionId || a.name] = a.answer?.value || a.value;
        }
        const email = answers['EMAIL'] || answers['email'] || answers['Email Address'];
        const name = answers['FULL_NAME'] || answers['Name'] || 'LinkedIn Lead';
        const company = answers['COMPANY_NAME'] || answers['Company'] || name;
        await ingestInbound({
          channel: 'LINKEDIN',
          direction: 'IN',
          externalId: String(lead.id || lead.leadGenFormResponse || `${acc.id}-${email || name}`),
          threadId: String(lead.form || lead.leadGenForm || acc.externalId),
          senderId: String(email || lead.id || name),
          senderName: name,
          text: `LinkedIn Lead Gen 表单提交\n姓名: ${name}\n公司: ${company}\n邮箱: ${email || '-'}\n电话: ${answers['PHONE_NUMBER'] || '-'}\n国家: ${answers['COUNTRY'] || '-'}\n原始字段: ${JSON.stringify(answers)}`,
          sentAt: lead.submittedAt ? new Date(lead.submittedAt) : undefined,
        });
        if (!email) continue;

        const existing = await prisma.contact.findUnique({ where: { email } });
        if (existing) continue;

        const newCompany = await prisma.company.create({
          data: {
            name: company,
            country: answers['COUNTRY'] || null,
            source: 'LINKEDIN',
            type: 'PROSPECT',
          },
        });
        await prisma.contact.create({
          data: {
            firstName: name.split(' ')[0],
            lastName: name.split(' ').slice(1).join(' ') || null,
            email,
            phone: answers['PHONE_NUMBER'] || null,
            companyId: newCompany.id,
          },
        });
        imported++;
      }
    } catch (e) {
      console.error('[li-leads]', acc.id, e);
    }
  }

  return NextResponse.json({ ok: true, imported });
}

// app/api/linkedin/leads/route.ts
// 拉取所有 LinkedIn 账号下的 Lead Gen Forms 提交记录
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ingestInbound } from '@/lib/inbox';
import { getSession } from '@/lib/auth';
import { can } from '@/lib/permissions';



export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !can(session.role, 'channels.use')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const accounts = await prisma.socialAccount.findMany({ where: { platform: 'LINKEDIN' } });
  let imported = 0;
  const errors: Array<{ accountId: string; status?: number; message: string }> = [];
  const apiVersion = process.env.LINKEDIN_API_VERSION || '202606';

  for (const acc of accounts) {
    try {
      // 真实接入需要 organization URN 与 Lead Gen Form Asset ID
      // 这里调用 leadFormResponses endpoint 拉取最近的提交
      const res = await fetch('https://api.linkedin.com/rest/leadFormResponses?q=owner&owner.type=ORGANIZATION', {
        headers: {
          Authorization: `Bearer ${acc.accessToken}`,
          'LinkedIn-Version': apiVersion,
          'X-Restli-Protocol-Version': '2.0.0',
        },
      });
      const data = await res.json();
      if (!res.ok) {
        errors.push({
          accountId: acc.id,
          status: res.status,
          message: data?.message || data?.code || 'LinkedIn API request failed',
        });
        continue;
      }

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
        imported++;
      }
    } catch (e) {
      console.error('[li-leads]', acc.id, e);
      errors.push({
        accountId: acc.id,
        message: e instanceof Error ? e.message : 'Unknown LinkedIn sync error',
      });
    }
  }

  return NextResponse.json({ ok: errors.length === 0, imported, errors }, { status: errors.length ? 502 : 200 });
}

// app/whatsapp/page.tsx — Server component shell
import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import WhatsAppChat from './WhatsAppChat';

export const dynamic = 'force-dynamic';


export default async function WhatsAppPage() {
  const role = cookies().get('auth_role')?.value;
  if (!role) redirect('/');

  // 按手机号分组找出所有对话
  const messages = await prisma.whatsAppMessage.findMany({
    orderBy: { createdAt: 'desc' },
    take: 500,
    include: { company: true },
  });

  const conversationsMap = new Map<string, any>();
  for (const m of messages) {
    if (!conversationsMap.has(m.phoneNumber)) {
      conversationsMap.set(m.phoneNumber, {
        phoneNumber: m.phoneNumber,
        contactName: m.contactName || m.company?.name || m.phoneNumber,
        companyId: m.companyId,
        companyName: m.company?.name,
        lastMessage: m.body,
        lastAt: m.createdAt,
        unread: 0,
      });
    }
  }
  const conversations = Array.from(conversationsMap.values());

  return <WhatsAppChat conversations={conversations} allMessages={JSON.parse(JSON.stringify(messages))} />;
}

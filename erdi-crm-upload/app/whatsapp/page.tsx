// app/whatsapp/page.tsx — Server component shell
import { prisma } from '@/lib/prisma';
import WhatsAppChat from './WhatsAppChat';
import { requirePermission } from '@/lib/permissions';

export const dynamic = 'force-dynamic';


export default async function WhatsAppPage() {
  const session = await requirePermission('channels.use');

  // 按手机号分组找出所有对话
  const messages = await prisma.whatsAppMessage.findMany({
    where: session.role === 'SALES' ? { OR: [{ companyId: null }, { company: { ownerId: session.userId } }, { company: { isPublic: true } }] } : {},
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

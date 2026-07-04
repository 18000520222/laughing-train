import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import OmniboxClient from './OmniboxClient';

export const dynamic = 'force-dynamic';

export default async function OmniboxPage() {
  const role = cookies().get('auth_role')?.value;
  if (!role || !['SUPER_ADMIN', 'ADMIN', 'SALES'].includes(role)) {
    redirect('/dashboard?error=unauthorized');
  }

  const messages = await prisma.inboxMessage.findMany({
    where: { direction: 'IN' },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { company: { select: { id: true, name: true, country: true, customerCode: true, owner: { select: { name: true, email: true } } } } },
  });

  const settings = await prisma.systemSettings.findUnique({ where: { id: 'default' } });

  const counts = {
    all: messages.length,
    NEW: messages.filter((m) => m.status === 'NEW').length,
    AI_DRAFTED: messages.filter((m) => m.status === 'AI_DRAFTED').length,
    REPLIED: messages.filter((m) => m.status === 'REPLIED').length,
  };

  return (
    <div className="min-h-screen bg-slate-50 p-8 font-sans">
      <header className="mb-6 flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 tracking-tight">全渠道自动化收件箱</h1>
          <p className="text-sm text-gray-500 mt-1">
            WhatsApp / 阿里国际站 / 亚马逊 / 虾皮 统一汇聚 · 自动翻译 · AI 回复草稿
          </p>
        </div>
        <div className="flex flex-wrap gap-3 items-center">
          <span className="text-xs text-gray-500">
            自动回复模式:
            <span className="ml-1 font-bold text-gray-700">
              {settings?.autoReplyMode === 'AUTO'
                ? '全自动发送'
                : settings?.autoReplyMode === 'OFF'
                ? '仅翻译'
                : 'AI草稿+人工确认'}
            </span>
          </span>
          <Link
            href="/settings"
            className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200"
          >
            ⚙️ 自动化设置
          </Link>
        </div>
      </header>

      <OmniboxClient initialMessages={JSON.parse(JSON.stringify(messages))} counts={counts} />
    </div>
  );
}

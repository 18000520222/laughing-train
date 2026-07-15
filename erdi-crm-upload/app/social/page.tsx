import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/permissions';

export const dynamic = 'force-dynamic';


export default async function SocialPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requirePermission('channels.use');
  const query = await searchParams;

  const accounts = await prisma.socialAccount.findMany();
  const fbAccounts = accounts.filter(a => a.platform === 'FACEBOOK');
  const liAccounts = accounts.filter(a => a.platform === 'LINKEDIN');

  const fbMessages = await prisma.socialMessage.findMany({
    where: { platform: 'FACEBOOK' },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });

  return (
    <div className="min-h-screen bg-slate-50 p-8 font-sans">
      <header className="mb-8 flex justify-between items-center bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 tracking-tight">社媒与通信聚合工作台</h1>
          <p className="text-sm text-gray-500 mt-1">WhatsApp / Facebook / LinkedIn 一站式管理</p>
        </div>
        <Link href="/dashboard" className="px-5 py-2.5 bg-gray-100 text-gray-700 font-medium rounded-lg hover:bg-gray-200">返回看板</Link>
      </header>

      {query.connected && (
        <div className="bg-green-50 border border-green-200 text-green-700 p-3 rounded-lg mb-6">
          ✅ {query.connected.toUpperCase()} 授权成功！
        </div>
      )}
      {query.error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg mb-6 text-xs break-all">
          ❌ 错误：{query.error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* WhatsApp */}
        <Card title="📱 WhatsApp" color="green" cta="进入对话" href="/whatsapp">
          <p className="text-sm text-gray-600 mb-2">通过 Meta Cloud API 实时收发客户消息，每条入站消息自动翻译为中文。</p>
          <p className="text-xs text-gray-500">在 <Link href="/settings" className="text-blue-600 underline">设置</Link> 中填入 Phone ID 与 Token 即可。</p>
        </Card>

        {/* Facebook */}
        <Card title="📘 Facebook Page" color="blue" cta={fbAccounts.length > 0 ? '重新授权' : '立即授权'} href="/api/auth/facebook/start">
          <p className="text-sm text-gray-600 mb-2">绑定公司 FB 主页，自动接收 Page Messenger 对话。</p>
          {fbAccounts.length > 0 ? (
            <div className="text-xs space-y-1">
              {fbAccounts.map(a => <div key={a.id} className="text-green-700">✅ {a.name}</div>)}
              <div className="text-gray-500 mt-2">最近 {fbMessages.length} 条消息</div>
            </div>
          ) : (
            <p className="text-xs text-amber-600">尚未授权任何 Page</p>
          )}
        </Card>

        {/* LinkedIn */}
        <Card title="👔 LinkedIn" color="indigo" cta={liAccounts.length > 0 ? '同步线索' : '立即授权'} href={liAccounts.length > 0 ? '#sync-li' : '/api/auth/linkedin/start'}>
          <p className="text-sm text-gray-600 mb-2">OAuth 授权后自动拉取 Lead Gen Forms 提交记录到客户库。</p>
          {liAccounts.length > 0 ? (
            <div className="text-xs space-y-1">
              {liAccounts.map(a => <div key={a.id} className="text-green-700">✅ {a.name}</div>)}
              <form action="/api/linkedin/leads" method="post" className="mt-2">
                <button className="text-xs text-blue-600 underline">立即拉取线索</button>
              </form>
            </div>
          ) : (
            <p className="text-xs text-amber-600">尚未授权</p>
          )}
        </Card>
      </div>

      {/* Facebook 消息流 */}
      {fbMessages.length > 0 && (
        <div className="mt-8 bg-white rounded-xl border p-6">
          <h2 className="text-lg font-bold mb-4">📘 Facebook 最近消息</h2>
          <div className="space-y-2">
            {fbMessages.map(m => (
              <div key={m.id} className="border-b py-2 text-sm">
                <div className="flex justify-between text-xs text-gray-500">
                  <span>{m.senderName || m.senderId} · {m.direction === 'IN' ? '收' : '发'}</span>
                  <span>{new Date(m.createdAt).toLocaleString('zh-CN')}</span>
                </div>
                <div className="text-gray-800 mt-1">{m.body}</div>
                {m.translated && m.translated !== m.body && (
                  <div className="text-xs text-gray-500 italic mt-1">译: {m.translated}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Card({ title, color, cta, href, children }: { title: string; color: string; cta: string; href: string; children: React.ReactNode }) {
  const colorMap: Record<string, string> = {
    green: 'bg-green-50 border-green-200 text-green-700',
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    indigo: 'bg-indigo-50 border-indigo-200 text-indigo-700',
  };
  const btnMap: Record<string, string> = {
    green: 'bg-green-600 hover:bg-green-700',
    blue: 'bg-blue-600 hover:bg-blue-700',
    indigo: 'bg-indigo-600 hover:bg-indigo-700',
  };
  return (
    <div className={`rounded-xl border p-6 ${colorMap[color]}`}>
      <h3 className="text-lg font-bold text-gray-900 mb-3">{title}</h3>
      <div className="text-gray-700 mb-4">{children}</div>
      <Link href={href} className={`inline-block text-white text-sm px-4 py-2 rounded-lg font-medium ${btnMap[color]}`}>
        {cta}
      </Link>
    </div>
  );
}

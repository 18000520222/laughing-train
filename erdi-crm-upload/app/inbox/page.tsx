import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';


export default async function InboxPage() {
  const cookieStore = cookies();
  const role = cookieStore.get('auth_role')?.value;

  if (!role || (role !== 'SUPER_ADMIN' && role !== 'ADMIN' && role !== 'SALES')) {
    redirect('/dashboard?error=unauthorized');
  }

  // 聚合查询两个邮箱的邮件
  const emails = await prisma.emailMessage.findMany({
    orderBy: { date: 'desc' },
    include: { account: true },
    take: 100
  });

  const accounts = await prisma.emailAccount.findMany();

  return (
    <div className="min-h-screen bg-slate-50 p-8 font-sans">
      <header className="mb-8 flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 tracking-tight">全渠道聚合收件箱</h1>
          <p className="text-sm text-gray-500 mt-1">当前聚合抓取: sales@erdicn.com 和 yilin@erdimail.com 的所有客户邮件</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/social" className="px-5 py-2.5 bg-gray-100 text-gray-700 font-medium rounded-lg hover:bg-gray-200 transition-colors">
            返回社媒中心
          </Link>
          <button className="px-5 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
            
            id="syncBtn"
          >
            🔄 立即抓取新邮件
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* 左边：配置信息 */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 h-fit">
          <h2 className="text-lg font-bold text-gray-800 mb-6 flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">⚙️</span>
            抓取账号状态
          </h2>
          <div className="space-y-4">
            {accounts.map(acc => (
              <div key={acc.id} className="p-3 border border-gray-100 rounded-lg bg-gray-50">
                <div className="flex justify-between items-center mb-1">
                  <span className="font-bold text-gray-700">{acc.email}</span>
                  <span className={`w-2 h-2 rounded-full ${acc.password ? 'bg-green-500' : 'bg-red-500'}`}></span>
                </div>
                <div className="text-xs text-gray-500">{acc.imapHost}:{acc.imapPort}</div>
                {!acc.password && (
                  <div className="text-xs text-red-500 mt-2 font-medium">⚠️ 请配置 IMAP 授权码</div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-6 pt-4 border-t border-gray-100">
             <Link href="/settings" className="text-blue-600 text-sm hover:underline font-medium">
               前往设置配置授权码 &rarr;
             </Link>
          </div>
        </div>

        {/* 右边：邮件列表 */}
        <div className="lg:col-span-3 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-6 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
            <h2 className="text-lg font-bold text-gray-800">最新收件箱 ({emails.length})</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {emails.length === 0 ? (
              <div className="p-12 text-center text-gray-500">
                <span className="text-4xl mb-4 block">📭</span>
                收件箱为空，点击右上角「立即抓取新邮件」同步。
              </div>
            ) : (
              emails.map(email => (
                <div key={email.id} className={`p-4 hover:bg-blue-50/30 transition-colors cursor-pointer ${!email.isRead ? 'bg-blue-50/10' : ''}`}>
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold px-2 py-1 bg-gray-100 text-gray-600 rounded">
                        接收: {email.account.email.split('@')[0]}
                      </span>
                      <span className={`font-bold ${!email.isRead ? 'text-gray-900' : 'text-gray-600'}`}>
                        {email.from}
                      </span>
                    </div>
                    <span className="text-xs text-gray-400">
                      {new Date(email.date).toLocaleString()}
                    </span>
                  </div>
                  <h3 className={`text-sm ${!email.isRead ? 'font-bold text-gray-800' : 'font-medium text-gray-600'}`}>
                    {email.subject || '无主题'}
                  </h3>
                  <p className="text-sm text-gray-500 mt-2 line-clamp-2">
                    {email.textBody || email.htmlBody?.replace(/<[^>]*>?/gm, '') || '无预览内容'}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button className="text-xs font-medium text-green-600 bg-green-50 px-3 py-1.5 rounded hover:bg-green-100 transition-colors">
                      + 一键转为商机
                    </button>
                    <button className="text-xs font-medium text-blue-600 bg-blue-50 px-3 py-1.5 rounded hover:bg-blue-100 transition-colors">
                      回复
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      
      {/* 客户端同步脚本 */}
      <script dangerouslySetInnerHTML={{__html: `
        document.getElementById('syncBtn')?.addEventListener('click', async (e) => {
          e.preventDefault();
          const btn = e.target;
          btn.innerText = '🔄 抓取中...';
          btn.disabled = true;
          try {
            const res = await fetch('/api/emails/sync', {method: 'POST'});
            const data = await res.json();
            if(data.error) alert('抓取失败: ' + data.error);
            else alert('成功抓取 ' + data.count + ' 封新邮件！');
            window.location.reload();
          } catch(err) {
            alert('网络错误');
          }
        });
      `}} />
    </div>
  );
}

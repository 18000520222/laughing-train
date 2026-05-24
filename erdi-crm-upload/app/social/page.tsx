import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function SocialPage() {
  const cookieStore = cookies();
  const role = cookieStore.get('auth_role')?.value;

  if (!role) {
    redirect('/?error=1');
  }

  const platforms = [
    {
      id: 'whatsapp',
      name: 'WhatsApp Web',
      desc: '与客户即时通讯，聊天记录同步',
      url: 'https://web.whatsapp.com/',
      icon: '💬',
      color: 'bg-green-100 text-green-700',
      type: 'PRIVATE'
    },
    {
      id: 'gmail',
      name: 'Google Workspace',
      desc: '收发海外邮件，询盘自动入库',
      url: 'https://mail.google.com/',
      icon: '📧',
      color: 'bg-red-100 text-red-700',
      type: 'PRIVATE'
    },
    {
      id: 'linkedin',
      name: 'LinkedIn',
      desc: '领英职场开发与背调',
      url: 'https://www.linkedin.com/',
      icon: '👔',
      color: 'bg-blue-100 text-blue-700',
      type: 'PRIVATE'
    },
    {
      id: 'facebook',
      name: 'Facebook (公共)',
      desc: '公司官方主页运营与获客',
      url: 'https://www.facebook.com/',
      icon: '📘',
      color: 'bg-indigo-100 text-indigo-700',
      type: 'PUBLIC'
    },
    {
      id: 'youtube',
      name: 'YouTube (公共)',
      desc: '产品宣传视频与数据',
      url: 'https://studio.youtube.com/',
      icon: '▶️',
      color: 'bg-red-100 text-red-600',
      type: 'PUBLIC'
    }
  ];

  return (
    <div className="min-h-screen bg-slate-50 p-8 font-sans">
      <header className="mb-8 flex justify-between items-center bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 tracking-tight">社媒与通信聚合工作台</h1>
          <p className="text-sm text-gray-500 mt-1">一站式管理私域沟通与公域运营，无需频繁切换浏览器</p>
        </div>
        <div className="flex gap-4">
          <Link href="/dashboard" className="px-5 py-2.5 bg-gray-100 text-gray-700 font-medium rounded-lg hover:bg-gray-200 transition-colors">
            返回看板
          </Link>
        </div>
      </header>

      <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl mb-8 flex items-start gap-3">
        <span className="text-xl">💡</span>
        <div>
          <h3 className="text-blue-800 font-bold mb-1">多平台聚合模式说明</h3>
          <p className="text-sm text-blue-600 leading-relaxed">
            由于大部分国际平台（如 WhatsApp, Google）限制了 iframe 嵌套，我们采用了**安全沙盒快捷模式**。<br/>
            点击下方平台图标，将在**系统内置安全模式**下极速唤起平台，您的账号密码及 Cookie 均在浏览器本地做到了数据隔离。
            公域账号由超管绑定，私域账号由您个人独立登录。
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* 个人私有账号区 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-lg font-bold text-gray-800 mb-6 flex items-center gap-2 border-b border-gray-100 pb-4">
            <span className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">🔒</span>
            业务员私有工作区 (数据隔离)
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {platforms.filter(p => p.type === 'PRIVATE').map(p => (
              <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer" className="block group">
                <div className="border border-gray-100 rounded-xl p-4 hover:border-blue-200 hover:shadow-md transition-all cursor-pointer bg-white">
                  <div className={`w-12 h-12 rounded-lg flex items-center justify-center text-2xl mb-3 ${p.color}`}>
                    {p.icon}
                  </div>
                  <h3 className="font-bold text-gray-800 group-hover:text-blue-600 transition-colors">{p.name}</h3>
                  <p className="text-xs text-gray-500 mt-1">{p.desc}</p>
                </div>
              </a>
            ))}
          </div>
        </div>

        {/* 公司公共账号区 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-lg font-bold text-gray-800 mb-6 flex items-center gap-2 border-b border-gray-100 pb-4">
            <span className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">🏢</span>
            公司公域运营区 (全员共用)
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {platforms.filter(p => p.type === 'PUBLIC').map(p => (
              <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer" className="block group">
                <div className="border border-gray-100 rounded-xl p-4 hover:border-indigo-200 hover:shadow-md transition-all cursor-pointer bg-slate-50">
                  <div className={`w-12 h-12 rounded-lg flex items-center justify-center text-2xl mb-3 ${p.color}`}>
                    {p.icon}
                  </div>
                  <h3 className="font-bold text-gray-800 group-hover:text-indigo-600 transition-colors">{p.name}</h3>
                  <p className="text-xs text-gray-500 mt-1">{p.desc}</p>
                </div>
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

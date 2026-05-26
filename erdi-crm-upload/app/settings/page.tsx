import { PrismaClient } from '@prisma/client';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
const prisma = new PrismaClient();

export default async function SettingsPage() {
  const role = cookies().get('auth_role')?.value;
  if (role !== 'SUPER_ADMIN' && role !== 'ADMIN' && role !== 'SALES') {
    redirect('/');
  }

  let settings = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
  if (!settings) {
    settings = { id: 'default', usdToCnyRate: 7.2, companyName: 'ERDI TECH LTD', updatedAt: new Date() } as any;
  }

  const emailAccounts = await prisma.emailAccount.findMany();

  async function saveSettings(formData: FormData) {
    'use server';
    const r = cookies().get('auth_role')?.value;
    if (r !== 'SUPER_ADMIN' && r !== 'ADMIN' && r !== 'SALES') return;
    const rate = parseFloat(formData.get('usdToCnyRate') as string);
    const companyName = formData.get('companyName') as string;
    if (rate && companyName) {
      await prisma.systemSettings.upsert({
        where: { id: 'default' },
        update: { usdToCnyRate: rate, companyName: companyName },
        create: { id: 'default', usdToCnyRate: rate, companyName: companyName }
      });
    }
    redirect('/settings');
  }

  async function updateEmailConfig(formData: FormData) {
    'use server';
    const r = cookies().get('auth_role')?.value;
    if (r !== 'SUPER_ADMIN' && r !== 'ADMIN') return;
    
    const id = formData.get('id') as string;
    const pwd = formData.get('password') as string;
    const host = formData.get('imapHost') as string;
    
    if (id && pwd && host) {
      await prisma.emailAccount.update({
        where: { id },
        data: { password: pwd, imapHost: host }
      });
    }
    redirect('/settings');
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* 基本设置 */}
        <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200">
          <div className="flex justify-between items-center mb-8 pb-4 border-b border-gray-100">
            <h1 className="text-2xl font-bold text-gray-800">⚙️ 系统基础配置</h1>
            <Link href="/dashboard" className="text-blue-600 hover:underline font-medium">返回看板</Link>
          </div>
          <form action={saveSettings} className="space-y-6">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">美元兑人民币汇率 (USD to CNY)</label>
                <input 
                  type="number" step="0.0001" name="usdToCnyRate" defaultValue={settings?.usdToCnyRate} required
                  className="w-full border border-gray-300 rounded-lg p-3 outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">公司主体名称</label>
                <input 
                  type="text" name="companyName" defaultValue={settings?.companyName} required
                  className="w-full border border-gray-300 rounded-lg p-3 outline-none focus:border-blue-500"
                />
              </div>
            </div>
            <button type="submit" className="bg-gray-900 text-white px-6 py-3 rounded-lg font-bold hover:bg-gray-800 transition-colors">
              保存系统设置
            </button>
          </form>
        </div>

        {/* 邮箱配置 */}
        <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200">
          <div className="mb-6 pb-4 border-b border-gray-100">
            <h2 className="text-xl font-bold text-gray-800">🔐 聚合邮箱安全配置 (IMAP)</h2>
            <p className="text-sm text-gray-500 mt-1">
              为了抓取邮件，您需要在此填入对应邮箱的**应用专用密码 / IMAP授权码**（并非登录密码）。
              填入后将加密存储至您的专属数据库。
            </p>
          </div>
          
          <div className="space-y-6">
            {emailAccounts.map(acc => (
              <form key={acc.id} action={updateEmailConfig} className="bg-gray-50 p-6 rounded-lg border border-gray-100">
                <input type="hidden" name="id" value={acc.id} />
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-gray-800 text-lg">{acc.email}</h3>
                  <span className={`text-xs px-2 py-1 rounded ${acc.password ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {acc.password ? '✅ 已配置授权码' : '❌ 未配置授权码'}
                  </span>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">IMAP 服务器地址</label>
                    <input 
                      type="text" name="imapHost" defaultValue={acc.imapHost} required
                      className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500"
                    />
                    <p className="text-[10px] text-gray-400 mt-1">例如: imap.gmail.com 或 imap.qiye.aliyun.com</p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">IMAP 独立授权码</label>
                    <input 
                      type="password" name="password" placeholder={acc.password ? "******** (已保存，填入可覆盖)" : "请输入授权码 / 应用专用密码"} required
                      className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500"
                    />
                    <p className="text-[10px] text-gray-400 mt-1">Google: 管理账号-&gt;安全性-&gt;应用专用密码</p>
                  </div>
                </div>
                <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium text-sm hover:bg-blue-700 transition-colors">
                  更新 {acc.email.split('@')[0]} 授权码
                </button>
              </form>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

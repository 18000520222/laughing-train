import { PrismaClient } from '@prisma/client';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
const prisma = new PrismaClient();

async function saveSettings(formData: FormData) {
  'use server';
  const role = cookies().get('auth_role')?.value;
  if (role !== 'SUPER_ADMIN' && role !== 'ADMIN' && role !== 'SALES') return;

  const rate = parseFloat(formData.get('usdToCnyRate') as string);
  const companyName = formData.get('companyName') as string;
 
  if (rate && companyName) {
    await prisma.systemSettings.upsert({
      where: { id: 'default' },
      update: { usdToCnyRate: rate, companyName: companyName },
      create: { id: 'default', usdToCnyRate: rate, companyName: companyName }
    });
  }
  redirect('/settings');
}

export default async function SettingsPage() {
  const role = cookies().get('auth_role')?.value;
  if (role !== 'SUPER_ADMIN' && role !== 'ADMIN' && role !== 'SALES') {
    redirect('/');
  }

  let settings = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
  if (!settings) {
    settings = { id: 'default', usdToCnyRate: 7.2, companyName: 'ERDI TECH LTD', updatedAt: new Date() };
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-3xl mx-auto bg-white p-8 rounded-xl shadow-sm border border-gray-200">
        <div className="flex justify-between items-center mb-8 pb-4 border-b border-gray-100">
          <h1 className="text-2xl font-bold text-gray-800">⚙️ 系统基础配置</h1>
          <Link href="/dashboard" className="text-blue-600 hover:underline">返回看板</Link>
        </div>

        <form action={saveSettings} className="space-y-6">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">美元兑人民币汇率 (USD to CNY)</label>
            <input 
              type="number" step="0.0001" name="usdToCnyRate" defaultValue={settings.usdToCnyRate} required
              className="w-full border border-gray-300 rounded-lg p-3"
            />
            <p className="text-xs text-gray-500 mt-1">系统所有涉及双币种转换的页面均以此汇率为准计算。</p>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">公司主体名称</label>
            <input 
              type="text" name="companyName" defaultValue={settings.companyName} required
              className="w-full border border-gray-300 rounded-lg p-3"
            />
          </div>
          <button type="submit" className="bg-gray-900 text-white px-6 py-3 rounded-lg font-bold hover:bg-gray-800">
            保存设置
          </button>
        </form>
      </div>
    </div>
  );
}

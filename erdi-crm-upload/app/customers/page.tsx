import { PrismaClient } from '@prisma/client';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { revalidatePath } from 'next/cache';

export const dynamic = 'force-dynamic';
const prisma = new PrismaClient();

export default async function CustomersPage() {
  const cookieStore = cookies();
  const role = cookieStore.get('auth_role')?.value;
  const userId = cookieStore.get('auth_userId')?.value;

  if (!role || !userId) {
    redirect('/?error=1');
  }

  // 默认查看: 如果是超级管理员，查看所有客户；如果是业务员，只看自己的客户或公海池客户
  const isSuper = role === 'SUPER_ADMIN' || role === 'ADMIN';

  // 读取所有公司信息
  const allCustomers = await prisma.company.findMany({
    orderBy: { updatedAt: 'desc' },
    include: {
      owner: true,
      contacts: true
    }
  });

  // 私海 (自己的客户)
  const myCustomers = allCustomers.filter(c => c.ownerId === userId);
  // 公海 (没有归属人，或者被明确标记为公海的客户)
  const publicCustomers = allCustomers.filter(c => !c.ownerId || c.isPublic);
  // 部门全部 (仅超管)
  const otherCustomers = allCustomers.filter(c => c.ownerId !== userId && c.ownerId !== null && !c.isPublic);

  async function addCustomer(formData: FormData) {
    'use server';
    const name = formData.get('name') as string;
    const country = formData.get('country') as string;
    const website = formData.get('website') as string;
    const type = formData.get('type') as any;
    const uId = cookies().get('auth_userId')?.value;

    if (name && uId) {
      await prisma.company.create({
        data: {
          name, country, website, type,
          ownerId: uId, // 默认进入自己的私海
          isPublic: false
        }
      });
      revalidatePath('/customers');
    }
  }

  async function moveToPublic(formData: FormData) {
    'use server';
    const id = formData.get('id') as string;
    if (id) {
      await prisma.company.update({
        where: { id },
        data: { ownerId: null, isPublic: true }
      });
      revalidatePath('/customers');
    }
  }

  async function claimCustomer(formData: FormData) {
    'use server';
    const id = formData.get('id') as string;
    const uId = cookies().get('auth_userId')?.value;
    if (id && uId) {
      await prisma.company.update({
        where: { id },
        data: { ownerId: uId, isPublic: false }
      });
      revalidatePath('/customers');
    }
  }

  const typeMap: Record<string, string> = {
    'NEW': '新客户',
    'EXISTING': '老客户',
    'PROSPECT': '潜在客户',
    'KEY_ACCOUNT': '重点大客',
    'LOST': '流失客户'
  };

  const renderCustomerRow = (c: any, mode: 'my' | 'public' | 'all') => (
    <tr key={c.id} className="hover:bg-gray-50/50 transition-colors">
      <td className="p-4">
        <div className="font-bold text-gray-800">{c.name}</div>
        <div className="text-sm text-gray-500">{c.country || '未填写国家'} {c.website && `| ${c.website}`}</div>
      </td>
      <td className="p-4">
        <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-blue-50 text-blue-700">
          {typeMap[c.type] || c.type}
        </span>
      </td>
      <td className="p-4 text-sm text-gray-500">
        {c.source}
      </td>
      <td className="p-4">
        {mode === 'all' && c.owner && (
          <span className="text-sm text-gray-600 bg-gray-100 px-2 py-1 rounded-md">{c.owner.name}</span>
        )}
        {mode === 'public' && (
          <span className="text-sm text-amber-600 bg-amber-50 px-2 py-1 rounded-md">公海池资源</span>
        )}
        {mode === 'my' && (
          <span className="text-sm text-green-600 bg-green-50 px-2 py-1 rounded-md">我的私海</span>
        )}
      </td>
      <td className="p-4 text-right">
        {mode === 'my' && (
          <form action={moveToPublic}>
            <input type="hidden" name="id" value={c.id} />
            <button type="submit" className="text-sm font-medium text-amber-600 hover:text-amber-800">
              退入公海
            </button>
          </form>
        )}
        {mode === 'public' && (
          <form action={claimCustomer}>
            <input type="hidden" name="id" value={c.id} />
            <button type="submit" className="text-sm font-medium text-green-600 hover:text-green-800">
              认领客户
            </button>
          </form>
        )}
      </td>
    </tr>
  );

  return (
    <div className="min-h-screen bg-slate-50 p-8 font-sans">
      <header className="mb-8 flex justify-between items-center bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 tracking-tight">客户资源池与公海池</h1>
          <p className="text-sm text-gray-500 mt-1">管理线索、潜在客户和成交大客</p>
        </div>
        <div className="flex gap-4">
          <Link href="/dashboard" className="px-5 py-2.5 bg-gray-100 text-gray-700 font-medium rounded-lg hover:bg-gray-200 transition-colors">
            返回看板
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          
          {/* 我的私海客户 */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-6 border-b border-gray-100 bg-green-50/30">
              <h2 className="text-lg font-bold text-gray-800">我的客户 (私海) - {myCustomers.length}家</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-sm border-b border-gray-100">
                    <th className="p-4 font-medium">公司名称/国家</th>
                    <th className="p-4 font-medium">客户分级</th>
                    <th className="p-4 font-medium">来源</th>
                    <th className="p-4 font-medium">归属</th>
                    <th className="p-4 font-medium text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {myCustomers.length === 0 ? (
                    <tr><td colSpan={5} className="p-8 text-center text-gray-500">暂无客户，快去开拓或从公海捞取吧！</td></tr>
                  ) : (
                    myCustomers.map(c => renderCustomerRow(c, 'my'))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* 公海池 */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden border-t-4 border-t-amber-400">
            <div className="p-6 border-b border-gray-100 bg-amber-50/30 flex justify-between items-center">
              <h2 className="text-lg font-bold text-gray-800">客户公海池 (可认领) - {publicCustomers.length}家</h2>
              <span className="text-sm text-gray-500">长期未跟进或被退回的线索</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-sm border-b border-gray-100">
                    <th className="p-4 font-medium">公司名称/国家</th>
                    <th className="p-4 font-medium">客户分级</th>
                    <th className="p-4 font-medium">来源</th>
                    <th className="p-4 font-medium">状态</th>
                    <th className="p-4 font-medium text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {publicCustomers.length === 0 ? (
                    <tr><td colSpan={5} className="p-8 text-center text-gray-500">公海池很干净，没有闲置线索。</td></tr>
                  ) : (
                    publicCustomers.map(c => renderCustomerRow(c, 'public'))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* 其他人的私海 (仅超管可见) */}
          {isSuper && otherCustomers.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden opacity-75">
              <div className="p-6 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
                <h2 className="text-lg font-bold text-gray-800">全公司其他客户 (仅管理层可见) - {otherCustomers.length}家</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 text-sm border-b border-gray-100">
                      <th className="p-4 font-medium">公司名称/国家</th>
                      <th className="p-4 font-medium">客户分级</th>
                      <th className="p-4 font-medium">来源</th>
                      <th className="p-4 font-medium">跟进业务员</th>
                      <th className="p-4 font-medium text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {otherCustomers.map(c => renderCustomerRow(c, 'all'))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 h-fit sticky top-8">
          <h2 className="text-lg font-bold text-gray-800 mb-6 flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-green-50 text-green-600 flex items-center justify-center">🏢</span>
            手动录入新客户
          </h2>
          <form action={addCustomer} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">公司全称 / 客户名</label>
              <input type="text" name="name" required className="w-full border border-gray-200 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-green-500 outline-none transition-all" placeholder="例如：Optisiv Ltd." />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">所属国家</label>
              <input type="text" name="country" className="w-full border border-gray-200 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-green-500 outline-none transition-all" placeholder="例如：Israel" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">官网网址 (可选)</label>
              <input type="text" name="website" className="w-full border border-gray-200 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-green-500 outline-none transition-all" placeholder="www.example.com" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">客户分级</label>
              <select name="type" required className="w-full border border-gray-200 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-green-500 outline-none transition-all bg-white">
                <option value="PROSPECT">潜在客户 (未成交)</option>
                <option value="NEW">新客户 (初次成交)</option>
                <option value="EXISTING">老客户 (多次复购)</option>
                <option value="KEY_ACCOUNT">重点大客 (VIP)</option>
              </select>
            </div>
            <button type="submit" className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-4 rounded-lg transition-colors shadow-sm mt-2">
              + 存入我的私海
            </button>
            <p className="text-xs text-gray-500 mt-4 leading-relaxed">
              * 录入后，客户将直接归入您名下的私海。如果您跟进失败，可以将其「退入公海」供其他同事开发。
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}

import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function SuppliersPage(props: any) {
  const role = (cookies().get('auth_role')?.value || '').toUpperCase();
  if (role !== 'SALES' && role !== 'SUPER_ADMIN' && role !== 'ADMIN') {
    redirect('/');
  }

  async function addSupplier(formData: FormData) {
    'use server';
    const name = String(formData.get('name') || '').trim();
    if (!name) return;
    await prisma.supplier.create({
      data: {
        name,
        category: String(formData.get('category') || '').trim() || null,
        contactPerson: String(formData.get('contactPerson') || '').trim() || null,
        phone: String(formData.get('phone') || '').trim() || null,
        email: String(formData.get('email') || '').trim() || null,
        mainProducts: String(formData.get('mainProducts') || '').trim() || null,
        paymentTerms: String(formData.get('paymentTerms') || '').trim() || null,
      },
    });
    revalidatePath('/suppliers');
  }

  const suppliers = await prisma.supplier.findMany({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { purchaseOrders: true } } },
  });

  return (
    <div className="min-h-screen bg-gray-50 p-6 md:p-8">
      <div className="max-w-6xl mx-auto">
        <header className="flex justify-between items-center mb-6 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">🏭 供应商管理</h1>
            <p className="text-sm text-gray-500 mt-1">共 {suppliers.length} 家供应商</p>
          </div>
          <Link href="/dashboard" className="bg-gray-800 text-white px-4 py-2 rounded-lg font-bold hover:bg-gray-700 transition-all">
            返回看板
          </Link>
        </header>

        {/* 新增供应商 */}
        <details className="mb-6 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <summary className="px-6 py-4 font-bold text-gray-800 cursor-pointer hover:bg-gray-50 select-none">
            ➕ 新增供应商
          </summary>
          <form action={addSupplier} className="p-6 pt-0 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">供应商名称 *</label>
              <input name="name" required className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 focus:border-indigo-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">分类</label>
              <input name="category" placeholder="如：光学元件 / 电子料 / 结构件" className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 focus:border-indigo-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">联系人</label>
              <input name="contactPerson" className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 focus:border-indigo-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">电话</label>
              <input name="phone" className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 focus:border-indigo-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">邮箱</label>
              <input name="email" type="email" className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 focus:border-indigo-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">付款条件</label>
              <input name="paymentTerms" placeholder="如：30% 预付 70% 见提单" className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 focus:border-indigo-500 focus:outline-none" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-gray-500 mb-1">主营产品</label>
              <input name="mainProducts" className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 focus:border-indigo-500 focus:outline-none" />
            </div>
            <div className="md:col-span-2">
              <button type="submit" className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-6 py-2.5 rounded-lg transition-all">
                保存供应商
              </button>
            </div>
          </form>
        </details>

        {/* 列表 */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-sm">
                <th className="p-4 font-bold text-gray-600">供应商</th>
                <th className="p-4 font-bold text-gray-600">分类</th>
                <th className="p-4 font-bold text-gray-600">联系人</th>
                <th className="p-4 font-bold text-gray-600">联系方式</th>
                <th className="p-4 font-bold text-gray-600">付款条件</th>
                <th className="p-4 font-bold text-gray-600">采购单</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="p-4">
                    <div className="font-bold text-gray-800">{s.name}</div>
                    {s.mainProducts && <div className="text-xs text-gray-400 mt-1">{s.mainProducts}</div>}
                  </td>
                  <td className="p-4 text-sm text-gray-600">{s.category || '-'}</td>
                  <td className="p-4 text-sm text-gray-600">{s.contactPerson || '-'}</td>
                  <td className="p-4 text-sm text-gray-600">
                    {s.email && <div><a href={`mailto:${s.email}`} className="text-blue-600 hover:underline">{s.email}</a></div>}
                    {s.phone && <div className="text-gray-500">{s.phone}</div>}
                    {!s.email && !s.phone && '-'}
                  </td>
                  <td className="p-4 text-sm text-gray-600">{s.paymentTerms || '-'}</td>
                  <td className="p-4">
                    <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded text-xs font-bold">
                      {s._count.purchaseOrders} 单
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {suppliers.length === 0 && (
            <div className="p-16 text-center text-gray-400">📭 暂无供应商，点击上方“新增供应商”添加。</div>
          )}
        </div>
      </div>
    </div>
  );
}

import { PrismaClient } from '@prisma/client';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
const prisma = new PrismaClient();

async function addProduct(formData: FormData) {
  'use server';
  await prisma.product.create({
    data: {
      sku: String(formData.get('sku')),
      name: String(formData.get('name')),
      enName: String(formData.get('enName')),
      category: String(formData.get('category')),
      basePriceUSD: parseFloat(String(formData.get('basePriceUSD'))),
      hsCode: String(formData.get('hsCode')),
      specifications: String(formData.get('specifications'))
    }
  });
  redirect('/products');
}

export default async function ProductsPage() {
  const role = cookies().get('auth_role')?.value;
  if (!role) redirect('/');

  const products = await prisma.product.findMany({ orderBy: { id: 'desc' } });

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-8 bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h1 className="text-2xl font-bold text-gray-800">📦 光电/激光产品资料库</h1>
          <Link href="/dashboard" className="text-blue-600 hover:bg-blue-50 px-4 py-2 rounded-lg font-medium transition-colors">← 返回看板</Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-100 text-gray-600 text-sm">
                  <th className="p-4 font-semibold">SKU</th>
                  <th className="p-4 font-semibold">品名 (中/英)</th>
                  <th className="p-4 font-semibold">HS 编码</th>
                  <th className="p-4 font-semibold text-right">基础售价 (USD)</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {products.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-gray-400">暂无产品数据</td></tr>}
                {products.map(p => (
                  <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="p-4 font-mono text-gray-500">{p.sku}</td>
                    <td className="p-4 font-medium text-gray-800">
                      {p.name} <br/><span className="text-xs text-gray-400 font-normal">{p.enName}</span>
                    </td>
                    <td className="p-4 text-gray-600">{p.hsCode || '-'}</td>
                    <td className="p-4 text-right font-bold text-green-600">${p.basePriceUSD}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 h-fit sticky top-8">
            <h2 className="text-lg font-bold text-gray-800 mb-6">➕ 新增产品档案</h2>
            <form action={addProduct} className="space-y-4">
              <input type="text" name="sku" placeholder="SKU 编号 (如: ERDI-L1)" required className="w-full border p-3 rounded-lg text-sm" />
              <input type="text" name="name" placeholder="中文品名" required className="w-full border p-3 rounded-lg text-sm" />
              <input type="text" name="enName" placeholder="英文品名 (用于外贸单据)" className="w-full border p-3 rounded-lg text-sm" />
              <input type="text" name="category" placeholder="产品分类 (如: 测距模块)" required className="w-full border p-3 rounded-lg text-sm" />
              <input type="number" step="0.01" name="basePriceUSD" placeholder="基础售价 (USD)" required className="w-full border p-3 rounded-lg text-sm" />
              <input type="text" name="hsCode" placeholder="海关 HS 编码 (报关用)" className="w-full border p-3 rounded-lg text-sm" />
              <textarea name="specifications" placeholder="规格型号 (用于 PI/CI)" rows={3} className="w-full border p-3 rounded-lg text-sm resize-none"></textarea>
              <button type="submit" className="w-full bg-blue-600 text-white font-bold py-3 rounded-lg hover:bg-blue-700 transition-colors">
                保存入库
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

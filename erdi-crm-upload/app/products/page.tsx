import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

function num(formData: FormData, k: string): number | null {
  const v = formData.get(k);
  if (v === null || String(v).trim() === '') return null;
  const n = parseFloat(String(v));
  return isNaN(n) ? null : n;
}
function str(formData: FormData, k: string): string | null {
  const v = formData.get(k);
  const s = v === null ? '' : String(v).trim();
  return s === '' ? null : s;
}

async function addProduct(formData: FormData) {
  'use server';
  const role = (cookies().get('auth_role')?.value || '').toUpperCase();
  if (!role) return;
  const sku = str(formData, 'sku');
  const name = str(formData, 'name');
  const category = str(formData, 'category');
  if (!sku || !name || !category) return;
  await prisma.product.create({
    data: {
      sku,
      name,
      enName: str(formData, 'enName'),
      category,
      basePriceUSD: num(formData, 'basePriceUSD'),
      hsCode: str(formData, 'hsCode'),
      specifications: str(formData, 'specifications'),
    },
  });
  redirect('/products');
}

async function updateProduct(formData: FormData) {
  'use server';
  const role = (cookies().get('auth_role')?.value || '').toUpperCase();
  if (!role) return;
  const id = String(formData.get('id') || '');
  if (!id) return;
  const sku = str(formData, 'sku');
  const name = str(formData, 'name');
  const category = str(formData, 'category');
  if (!sku || !name || !category) return;
  await prisma.product.update({
    where: { id },
    data: {
      sku,
      name,
      enName: str(formData, 'enName'),
      category,
      basePriceUSD: num(formData, 'basePriceUSD'),
      hsCode: str(formData, 'hsCode'),
      specifications: str(formData, 'specifications'),
    },
  });
  redirect('/products');
}

async function deleteProduct(formData: FormData) {
  'use server';
  const role = (cookies().get('auth_role')?.value || '').toUpperCase();
  if (role !== 'SUPER_ADMIN' && role !== 'ADMIN') return;
  const id = String(formData.get('id') || '');
  if (!id) return;
  // 有关联商机的产品不物理删除，改为停用，避免破坏单据
  const linked = await prisma.opportunity.count({ where: { productId: id } });
  if (linked > 0) {
    await prisma.product.update({ where: { id }, data: { isActive: false } });
  } else {
    await prisma.product.delete({ where: { id } });
  }
  redirect('/products');
}

export default async function ProductsPage() {
  const role = (cookies().get('auth_role')?.value || '').toUpperCase();
  if (!role) redirect('/');
  const canDelete = role === 'SUPER_ADMIN' || role === 'ADMIN';

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
                  <th className="p-4 font-semibold text-right">售价 (USD)</th>
                  <th className="p-4 font-semibold text-right">操作</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {products.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-gray-400">暂无产品数据</td></tr>}
                {products.map(p => (
                    <tr key={p.id} className={`border-b border-gray-50 hover:bg-gray-50 ${p.isActive === false ? 'opacity-50' : ''}`}>
                      <td className="p-4 font-mono text-gray-500">
                        {p.sku}{p.isActive === false && <span className="ml-1 text-xs text-red-400">(已停用)</span>}
                      </td>
                      <td className="p-4 font-medium text-gray-800">
                        {p.name} <br/><span className="text-xs text-gray-400 font-normal">{p.enName}</span>
                      </td>
                      <td className="p-4 text-gray-600">{p.hsCode || '-'}</td>
                      <td className="p-4 text-right font-bold text-green-600">{p.basePriceUSD != null ? `$${p.basePriceUSD}` : '-'}</td>
                      <td className="p-4 text-right whitespace-nowrap">
                        <details className="inline-block text-left">
                          <summary className="cursor-pointer list-none text-blue-600 hover:underline text-xs font-medium inline">✏️ 编辑</summary>
                          <div className="absolute z-10 mt-2 right-8 w-80 bg-white border border-gray-200 rounded-xl shadow-lg p-4">
                            <form action={updateProduct} className="space-y-2">
                              <input type="hidden" name="id" value={p.id} />
                              <input name="sku" defaultValue={p.sku} placeholder="SKU" required className="w-full border p-2 rounded text-sm" />
                              <input name="name" defaultValue={p.name} placeholder="中文品名" required className="w-full border p-2 rounded text-sm" />
                              <input name="enName" defaultValue={p.enName || ''} placeholder="英文品名" className="w-full border p-2 rounded text-sm" />
                              <input name="category" defaultValue={p.category} placeholder="分类" required className="w-full border p-2 rounded text-sm" />
                              <input name="basePriceUSD" type="number" step="0.01" defaultValue={p.basePriceUSD ?? ''} placeholder="售价 USD" className="w-full border p-2 rounded text-sm" />
                              <input name="hsCode" defaultValue={p.hsCode || ''} placeholder="HS 编码" className="w-full border p-2 rounded text-sm" />
                              <textarea name="specifications" defaultValue={p.specifications || ''} placeholder="规格型号" rows={2} className="w-full border p-2 rounded text-sm resize-none" />
                              <button type="submit" className="w-full bg-blue-600 text-white font-bold py-2 rounded text-sm hover:bg-blue-700">保存修改</button>
                            </form>
                          </div>
                        </details>
                        {canDelete && (
                          <form action={deleteProduct} className="inline-block ml-3">
                            <input type="hidden" name="id" value={p.id} />
                            <button type="submit" className="text-red-500 hover:underline text-xs font-medium">🗑️ 删除</button>
                          </form>
                        )}
                      </td>
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
              <input type="number" step="0.01" name="basePriceUSD" placeholder="基础售价 (USD)" className="w-full border p-3 rounded-lg text-sm" />
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

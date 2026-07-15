import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import { requirePermission } from '@/lib/permissions';
import { writeAuditLog } from '@/lib/audit';
import { randomBytes } from 'crypto';

export const dynamic = 'force-dynamic';

export default async function SuppliersPage(props: any) {
  await requirePermission('suppliers.manage');

  async function addSupplier(formData: FormData) {
    'use server';
    const actor = await requirePermission('suppliers.manage');
    const name = String(formData.get('name') || '').trim();
    if (!name) return;
    const supplier = await prisma.supplier.create({
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
    await writeAuditLog(actor, { action: 'supplier.create', entityType: 'Supplier', entityId: supplier.id, summary: supplier.name });
    revalidatePath('/suppliers');
  }

  async function createPurchaseOrder(formData: FormData) {
    'use server';
    const actor = await requirePermission('suppliers.manage');
    const supplierId = String(formData.get('supplierId') || '');
    const opportunityId = String(formData.get('opportunityId') || '') || null;
    const productName = String(formData.get('productName') || '').trim();
    const sku = String(formData.get('sku') || '').trim();
    const quantity = Number(formData.get('quantity') || 0);
    const unitPriceCNY = Number(formData.get('unitPriceCNY') || 0);
    if (!supplierId || !productName || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPriceCNY) || unitPriceCNY < 0) return;
    const [supplier, product, opportunity] = await Promise.all([
      prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true } }),
      sku ? prisma.product.findUnique({ where: { sku }, select: { id: true } }) : null,
      opportunityId ? prisma.opportunity.findUnique({ where: { id: opportunityId }, select: { id: true } }) : null,
    ]);
    if (!supplier || (opportunityId && !opportunity)) return;
    const totalAmountCNY = Math.round(quantity * unitPriceCNY * 100) / 100;
    const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    const poNumber = `PO-${date}-${randomBytes(3).toString('hex').toUpperCase()}`;
    const purchaseOrder = await prisma.purchaseOrder.create({
      data: {
        poNumber,
        supplierId,
        opportunityId,
        totalAmountCNY,
        status: 'PENDING',
        paymentTerms: String(formData.get('paymentTerms') || '').trim() || null,
        expectedAt: formData.get('expectedAt') ? new Date(`${String(formData.get('expectedAt'))}T00:00:00`) : null,
        createdById: actor.userId,
        orderDetails: { schemaVersion: 1, itemCount: 1 },
        lineItems: {
          create: {
            productId: product?.id || null,
            productName,
            sku: sku || null,
            quantity,
            unitPriceCNY,
            totalAmountCNY,
            note: String(formData.get('note') || '').trim() || null,
          },
        },
      },
    });
    await writeAuditLog(actor, {
      action: 'purchase_order.create',
      entityType: 'PurchaseOrder',
      entityId: purchaseOrder.id,
      summary: `${poNumber} · CNY ${totalAmountCNY}`,
      metadata: { supplierId, opportunityId },
    });
    revalidatePath('/suppliers');
    revalidatePath('/finance');
  }

  async function updatePurchaseOrderStatus(formData: FormData) {
    'use server';
    const actor = await requirePermission('suppliers.manage');
    const id = String(formData.get('id') || '');
    const status = String(formData.get('status') || '');
    const order = await prisma.purchaseOrder.findUnique({ where: { id }, select: { id: true, status: true, poNumber: true } });
    if (!order) return;
    const allowed: Record<string, string[]> = {
      PENDING: ['CANCELLED'],
      APPROVED: ['ORDERED', 'CANCELLED'],
      ORDERED: ['RECEIVED'],
    };
    if (!(allowed[order.status] || []).includes(status)) return;
    await prisma.purchaseOrder.update({ where: { id }, data: { status } });
    await writeAuditLog(actor, { action: 'purchase_order.status_update', entityType: 'PurchaseOrder', entityId: id, summary: `${order.poNumber}: ${order.status} -> ${status}` });
    revalidatePath('/suppliers');
    revalidatePath('/finance');
  }

  const [suppliers, purchaseOrders, opportunities] = await Promise.all([
    prisma.supplier.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { purchaseOrders: true } } },
    }),
    prisma.purchaseOrder.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        supplier: true,
        opportunity: { include: { company: true } },
        lineItems: true,
        createdBy: { select: { name: true, email: true } },
        approvedBy: { select: { name: true, email: true } },
      },
      take: 100,
    }),
    prisma.opportunity.findMany({
      where: { stage: { not: 'CLOSED_LOST' } },
      include: { company: true },
      orderBy: { updatedAt: 'desc' },
      take: 150,
    }),
  ]);

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

        <details className="mb-6 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
          <summary className="cursor-pointer px-6 py-4 font-bold text-gray-800 hover:bg-gray-50">➕ 新建采购单</summary>
          <form action={createPurchaseOrder} className="grid grid-cols-1 gap-4 p-6 pt-0 md:grid-cols-3">
            <FieldSelect name="supplierId" label="供应商 *" required options={suppliers.map((item) => ({ value: item.id, label: item.name }))} />
            <FieldSelect name="opportunityId" label="关联客户订单" options={opportunities.map((item) => ({ value: item.id, label: `${item.company.name} · ${item.title}` }))} />
            <FieldInput name="productName" label="产品名称 *" required />
            <FieldInput name="sku" label="SKU（可匹配产品库）" />
            <FieldInput name="quantity" label="数量 *" type="number" required step="0.01" />
            <FieldInput name="unitPriceCNY" label="采购单价 CNY *" type="number" required step="0.01" />
            <FieldInput name="paymentTerms" label="付款条件" />
            <FieldInput name="expectedAt" label="预计到货" type="date" />
            <FieldInput name="note" label="规格 / 备注" />
            <div className="md:col-span-3"><button className="rounded-lg bg-indigo-600 px-6 py-2.5 font-bold text-white hover:bg-indigo-500">提交采购审批</button></div>
          </form>
        </details>

        <section className="mb-6 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
          <div className="border-b border-gray-100 p-5"><h2 className="text-lg font-black text-gray-900">采购单执行</h2><p className="text-sm text-gray-500">待审批由财务中心复核；审批后采购可下单并登记收货。</p></div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-gray-600"><tr><th className="p-4">采购单</th><th className="p-4">供应商 / 客户订单</th><th className="p-4">产品</th><th className="p-4 text-right">金额</th><th className="p-4">状态</th><th className="p-4 text-right">操作</th></tr></thead>
              <tbody>
                {purchaseOrders.map((order) => (
                  <tr key={order.id} className="border-t border-gray-100">
                    <td className="p-4"><p className="font-mono font-bold">{order.poNumber}</p><p className="text-xs text-gray-400">{order.createdBy?.name || order.createdBy?.email || '-'}</p></td>
                    <td className="p-4"><p className="font-bold">{order.supplier.name}</p><p className="text-xs text-gray-500">{order.opportunity ? `${order.opportunity.company.name} · ${order.opportunity.title}` : '未关联销售订单'}</p></td>
                    <td className="p-4">{order.lineItems.map((item) => <p key={item.id}>{item.productName} × {item.quantity}</p>)}</td>
                    <td className="p-4 text-right font-black">¥{order.totalAmountCNY.toLocaleString()}</td>
                    <td className="p-4"><span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-bold">{purchaseStatus(order.status)}</span></td>
                    <td className="p-4"><div className="flex justify-end gap-2">{order.status === 'PENDING' && <OrderStatusButton action={updatePurchaseOrderStatus} id={order.id} status="CANCELLED" label="撤销" />}{order.status === 'APPROVED' && <OrderStatusButton action={updatePurchaseOrderStatus} id={order.id} status="ORDERED" label="已下单" />}{order.status === 'ORDERED' && <OrderStatusButton action={updatePurchaseOrderStatus} id={order.id} status="RECEIVED" label="已收货" />}</div></td>
                  </tr>
                ))}
                {purchaseOrders.length === 0 && <tr><td colSpan={6} className="p-10 text-center text-gray-400">暂无采购单</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

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

function FieldInput({ name, label, type = 'text', required = false, step }: { name: string; label: string; type?: string; required?: boolean; step?: string }) {
  return <label className="block text-xs font-bold text-gray-500">{label}<input name={name} type={type} required={required} min={type === 'number' ? '0' : undefined} step={step} className="mt-1 w-full rounded-lg border-2 border-gray-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" /></label>;
}

function FieldSelect({ name, label, options, required = false }: { name: string; label: string; options: Array<{ value: string; label: string }>; required?: boolean }) {
  return <label className="block text-xs font-bold text-gray-500">{label}<select name={name} required={required} className="mt-1 w-full rounded-lg border-2 border-gray-200 px-3 py-2 text-sm"><option value="">请选择</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

function OrderStatusButton({ action, id, status, label }: { action: (formData: FormData) => Promise<void>; id: string; status: string; label: string }) {
  return <form action={action}><input type="hidden" name="id" value={id} /><input type="hidden" name="status" value={status} /><button className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-bold hover:bg-gray-50">{label}</button></form>;
}

function purchaseStatus(status: string) {
  return ({ PENDING: '待审批', APPROVED: '已审批', ORDERED: '已下单', RECEIVED: '已收货', CANCELLED: '已取消' } as Record<string, string>)[status] || status;
}

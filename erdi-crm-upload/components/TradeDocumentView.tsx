import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { TradeDocumentType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/permissions';
import {
  buildTradeDocumentSnapshot,
  canIssueTradeDocument,
  latestTradeDocument,
  parseTradeDocumentSnapshot,
  TRADE_DOCUMENT_LABELS,
  validateTradeDocument,
} from '@/lib/trade-documents';
import { issueTradeDocument, voidTradeDocument } from '@/app/documents/actions';
import PrintButton from '@/app/pi/[id]/PrintButton';

type SearchParams = Record<string, string | string[] | undefined>;

function money(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(value);
  } catch {
    return `${currency || 'USD'} ${value.toFixed(2)}`;
  }
}

function date(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString().slice(0, 10);
}

function addressLines(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const address = value as Record<string, unknown>;
  const text = (key: string) => typeof address[key] === 'string' ? String(address[key]).trim() : '';
  return [
    text('name'),
    text('company'),
    text('address1'),
    text('address2'),
    [text('city'), text('province'), text('postalCode') || text('zip')].filter(Boolean).join(', '),
    text('country'),
    text('phone'),
  ].filter(Boolean);
}

function documentStatus(status: string) {
  if (status === 'ISSUED') return '当前正式版';
  if (status === 'SUPERSEDED') return '已被新版本替代';
  return '已作废';
}

export default async function TradeDocumentView({
  opportunityId,
  type,
  searchParams,
}: {
  opportunityId: string;
  type: TradeDocumentType;
  searchParams?: SearchParams;
}) {
  const session = await requirePermission('documents.read');
  const history = await prisma.tradeDocument.findMany({
    where: { opportunityId, type },
    orderBy: { version: 'desc' },
    include: { issuedBy: { select: { name: true, email: true } } },
  });
  const nextVersion = (history[0]?.version || 0) + 1;
  const [draft, latest] = await Promise.all([
    buildTradeDocumentSnapshot(session, opportunityId, type, { version: nextVersion }),
    latestTradeDocument(session, opportunityId, type),
  ]);
  if (!draft) notFound();

  const official = latest?.status === 'ISSUED' ? parseTradeDocumentSnapshot(latest.data) : null;
  const snapshot = official || draft;
  const errors = validateTradeDocument(draft);
  const canIssue = canIssueTradeDocument(session, type);
  const error = typeof searchParams?.error === 'string' ? searchParams.error : '';
  const shipTo = addressLines(snapshot.shipment.shippingAddress);
  const title = TRADE_DOCUMENT_LABELS[type];
  const isPackingList = type === 'PL';
  const showCustoms = type === 'CUSTOMS' || type === 'CI';

  return (
    <main className="min-h-screen bg-slate-100 p-3 sm:p-8 print:bg-white print:p-0">
      <div className="mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex gap-2">
          <Link href="/documents" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700">返回单据中心</Link>
          <Link href={`/opportunity/${opportunityId}`} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700">商机详情</Link>
        </div>
        <div className="flex gap-2">
          <PrintButton />
          {canIssue && (
            <form action={issueTradeDocument}>
              <input type="hidden" name="opportunityId" value={opportunityId} />
              <input type="hidden" name="type" value={type} />
              <button
                disabled={errors.length > 0}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-black text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {official ? `签发 V${nextVersion}` : '正式签发'}
              </button>
            </form>
          )}
        </div>
      </div>

      {(error || errors.length > 0) && (
        <section className="mx-auto mb-4 max-w-[210mm] rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 print:hidden">
          <p className="font-black">正式签发前需要补齐</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {error && <li>{error}</li>}
            {errors.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>
      )}

      <article className="relative mx-auto min-h-[297mm] w-full max-w-[210mm] bg-white p-6 shadow-2xl sm:p-10 lg:p-12 print:w-[210mm] print:max-w-none print:shadow-none">
        <div className={`absolute right-8 top-8 rotate-6 border-4 px-3 py-2 text-sm font-black ${official ? 'border-emerald-600 text-emerald-600' : 'border-amber-500 text-amber-600'} print:right-8 print:top-8`}>
          {official ? `OFFICIAL · V${snapshot.version}` : 'DRAFT PREVIEW'}
        </div>

        <header className="mb-8 flex items-end justify-between border-b-2 border-slate-900 pb-6 pr-24">
          <div>
            <h1 className="text-3xl font-black text-slate-950">{snapshot.seller.companyName}</h1>
            <p className="mt-2 text-sm text-slate-500">Laser & Optical Technology OEM/ODM</p>
          </div>
          <div className="text-right">
            <h2 className="text-2xl font-light tracking-widest text-indigo-800">{title}</h2>
            <p className="mt-2 font-mono text-sm text-slate-700">No. {snapshot.documentNumber}</p>
            <p className="text-sm text-slate-500">Date: {date(snapshot.issuedAt)}</p>
          </div>
        </header>

        <section className="mb-8 grid grid-cols-2 gap-8 text-sm">
          <div>
            <h3 className="mb-2 border-b border-slate-200 pb-1 font-black text-slate-800">BUYER / CONSIGNEE</h3>
            <p className="font-bold">{snapshot.buyer.companyName}</p>
            {snapshot.buyer.contactName && <p>{snapshot.buyer.contactName}</p>}
            {snapshot.buyer.email && <p>{snapshot.buyer.email}</p>}
            {snapshot.buyer.phone && <p>{snapshot.buyer.phone}</p>}
            {snapshot.buyer.country && <p>{snapshot.buyer.country}</p>}
            {shipTo.map((line) => <p key={line}>{line}</p>)}
          </div>
          <div>
            <h3 className="mb-2 border-b border-slate-200 pb-1 font-black text-slate-800">SELLER</h3>
            <p className="font-bold">{snapshot.seller.companyName}</p>
            <p>Chengdu, China</p>
            <p>{snapshot.seller.email}</p>
            {snapshot.opportunity.code && <p className="mt-2 text-xs text-slate-500">Order ref: {snapshot.opportunity.code}</p>}
          </div>
        </section>

        <table className="mb-8 w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-100 text-slate-800">
              <th className="border border-slate-300 px-2 py-2 text-left">No.</th>
              <th className="border border-slate-300 px-2 py-2 text-left">Description / SKU</th>
              {showCustoms && <th className="border border-slate-300 px-2 py-2 text-left">HS Code / Origin</th>}
              <th className="border border-slate-300 px-2 py-2 text-right">Qty</th>
              {!isPackingList && <th className="border border-slate-300 px-2 py-2 text-right">Unit price</th>}
              {!isPackingList && <th className="border border-slate-300 px-2 py-2 text-right">Amount</th>}
            </tr>
          </thead>
          <tbody>
            {snapshot.items.map((item, index) => (
              <tr key={`${item.sku}-${index}`}>
                <td className="border-b border-slate-200 px-2 py-3 text-slate-500">{index + 1}</td>
                <td className="border-b border-slate-200 px-2 py-3"><p className="font-bold">{item.description}</p><p className="text-xs text-slate-500">{item.sku || '-'}</p></td>
                {showCustoms && <td className="border-b border-slate-200 px-2 py-3"><p>{item.hsCode || '-'}</p><p className="text-xs text-slate-500">{item.origin || snapshot.shipment.originCountry || '-'}</p></td>}
                <td className="border-b border-slate-200 px-2 py-3 text-right">{item.quantity} {item.unit}</td>
                {!isPackingList && <td className="border-b border-slate-200 px-2 py-3 text-right">{money(item.unitPrice, snapshot.currency)}</td>}
                {!isPackingList && <td className="border-b border-slate-200 px-2 py-3 text-right font-bold">{money(item.amount, snapshot.currency)}</td>}
              </tr>
            ))}
          </tbody>
          {!isPackingList && (
            <tfoot>
              {snapshot.shippingAmount > 0 && <TotalRow label="Shipping" value={money(snapshot.shippingAmount, snapshot.currency)} columns={showCustoms ? 6 : 5} />}
              {snapshot.taxAmount > 0 && <TotalRow label="Tax" value={money(snapshot.taxAmount, snapshot.currency)} columns={showCustoms ? 6 : 5} />}
              <TotalRow label="TOTAL" value={money(snapshot.totalAmount, snapshot.currency)} columns={showCustoms ? 6 : 5} strong />
            </tfoot>
          )}
        </table>

        {(type === 'PL' || type === 'CI' || type === 'CUSTOMS') && (
          <section className="mb-8 grid grid-cols-2 gap-6 rounded-lg border border-slate-200 p-4 text-sm">
            <div>
              <h3 className="font-black">PACKING</h3>
              <p>Packages: {snapshot.shipment.packages || '-'}</p>
              <p>Gross weight: {snapshot.shipment.grossWeightKg || '-'} kg</p>
              <p>Net weight: {snapshot.shipment.netWeightKg || '-'} kg</p>
              <p>Dimensions: {snapshot.shipment.lengthCm || '-'} × {snapshot.shipment.widthCm || '-'} × {snapshot.shipment.heightCm || '-'} cm</p>
            </div>
            <div>
              <h3 className="font-black">SHIPPING</h3>
              <p>Incoterm: {snapshot.shipment.incoterm || '-'}</p>
              <p>Carrier: {snapshot.shipment.carrier || '-'}</p>
              <p>Tracking: {snapshot.shipment.trackingNumber || '-'}</p>
              <p>Origin: {snapshot.shipment.originCountry || '-'}</p>
            </div>
          </section>
        )}

        {(type === 'PI' || type === 'CONTRACT') && (
          <section className="mb-8 grid grid-cols-2 gap-6 rounded-lg bg-slate-50 p-4 text-sm">
            <div>
              <h3 className="font-black">PAYMENT</h3>
              <p>Status: {snapshot.payment.status}</p>
              <p>Method: {snapshot.payment.method || '-'}</p>
              <p>Reference: {snapshot.payment.reference || '-'}</p>
            </div>
            <div>
              <h3 className="font-black">BANK DETAILS</h3>
              <p>{snapshot.bank.beneficiary || '-'}</p>
              <p>{snapshot.bank.bankName || '-'}</p>
              <p>A/C: {snapshot.bank.accountNo || '-'}</p>
              <p>SWIFT: {snapshot.bank.swift || '-'}</p>
            </div>
          </section>
        )}

        {type === 'CONTRACT' && (
          <section className="mb-10 text-sm leading-7 text-slate-700">
            <h3 className="font-black text-slate-900">TERMS</h3>
            <p>1. Products, quantities and prices are governed by this signed contract version.</p>
            <p>2. Delivery follows the Incoterm and shipment details above, subject to confirmed payment.</p>
            <p>3. Changes require a newly issued version; prior versions remain in the audit history.</p>
          </section>
        )}

        <footer className="mt-16 grid grid-cols-2 gap-20 text-center text-sm">
          <div className="border-t border-slate-800 pt-2">Buyer authorized signature</div>
          <div className="border-t border-slate-800 pt-2">{snapshot.seller.companyName}</div>
        </footer>
      </article>

      {history.length > 0 && (
        <section className="mx-auto mt-5 max-w-[210mm] rounded-xl border border-slate-200 bg-white p-5 shadow-sm print:hidden">
          <h2 className="font-black text-slate-900">版本与审计记录</h2>
          <div className="mt-3 space-y-3">
            {history.map((document) => (
              <div key={document.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 text-sm">
                <div>
                  <p className="font-mono font-bold">{document.documentNumber}</p>
                  <p className="text-xs text-slate-500">{documentStatus(document.status)} · {document.issuedAt.toLocaleString('zh-CN')} · {document.issuedBy?.name || document.issuedBy?.email || '系统'}</p>
                  {document.voidReason && <p className="mt-1 text-xs text-red-600">作废原因：{document.voidReason}</p>}
                </div>
                {document.status === 'ISSUED' && ['SUPER_ADMIN', 'ADMIN', 'DOCUMENT'].includes(session.role) && (
                  <form action={voidTradeDocument} className="flex gap-2">
                    <input type="hidden" name="documentId" value={document.id} />
                    <input required minLength={5} name="reason" placeholder="作废原因（至少5字）" className="rounded-lg border border-slate-300 px-2 py-1.5" />
                    <button className="rounded-lg border border-red-200 px-3 py-1.5 font-bold text-red-600">作废</button>
                  </form>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function TotalRow({ label, value, columns, strong = false }: { label: string; value: string; columns: number; strong?: boolean }) {
  return (
    <tr className={strong ? 'text-lg font-black' : ''}>
      <td colSpan={columns - 1} className="px-2 py-2 text-right">{label}</td>
      <td className="border-t border-slate-800 px-2 py-2 text-right">{value}</td>
    </tr>
  );
}

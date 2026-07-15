import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import PrintButton from './PrintButton';

export const dynamic = 'force-dynamic';

type JsonRecord = Record<string, unknown>;

type InvoiceAddress = {
  name: string;
  company: string;
  address1: string;
  address2: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
  phone: string;
};

type InvoiceItem = {
  sku: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
};

type InvoiceData = {
  piNumber: string;
  date: string;
  companyName: string;
  customerName: string;
  email: string;
  phone: string;
  currency: string;
  items: InvoiceItem[];
  subtotal: number;
  shippingAmount: number;
  taxAmount: number;
  totalAmount: number;
  paymentMethod: string;
  paymentStatus: string;
  shippingAddress: InvoiceAddress | null;
  isFrozen: boolean;
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function invoiceAddress(value: unknown): InvoiceAddress | null {
  const address = asRecord(value);
  if (Object.keys(address).length === 0) return null;
  return {
    name: text(address.name),
    company: text(address.company),
    address1: text(address.address1),
    address2: text(address.address2),
    city: text(address.city),
    province: text(address.province),
    postalCode: text(address.postalCode || address.zip),
    country: text(address.country),
    phone: text(address.phone),
  };
}

function invoiceItems(value: unknown, fallbackDescription: string, fallbackAmount: number): InvoiceItem[] {
  const items = Array.isArray(value) ? value : [];
  const normalized = items.map(itemValue => {
    const item = asRecord(itemValue);
    const quantity = Math.max(1, Math.trunc(numberValue(item.quantity, 1)));
    const unitPrice = numberValue(item.unitPrice ?? item.price);
    return {
      sku: text(item.sku),
      description: text(item.title || item.description) || fallbackDescription,
      quantity,
      unitPrice,
      amount: numberValue(item.amount, unitPrice * quantity),
    };
  }).filter(item => item.description);

  return normalized.length ? normalized : [{
    sku: '',
    description: fallbackDescription,
    quantity: 1,
    unitPrice: fallbackAmount,
    amount: fallbackAmount,
  }];
}

function normalizeInvoiceData(rawValue: unknown, fallback: InvoiceData): InvoiceData {
  const raw = asRecord(rawValue);
  const amount = numberValue(raw.totalAmount ?? raw.amountUSD, fallback.totalAmount);
  const items = invoiceItems(raw.items, text(raw.description) || fallback.items[0].description, amount);
  const subtotal = numberValue(raw.subtotal, items.reduce((sum, item) => sum + item.amount, 0));
  const shippingAmount = numberValue(raw.shippingAmount);
  const taxAmount = numberValue(raw.taxAmount);
  return {
    piNumber: text(raw.piNumber) || fallback.piNumber,
    date: text(raw.date) || fallback.date,
    companyName: text(raw.companyName) || fallback.companyName,
    customerName: text(raw.customerName) || fallback.customerName,
    email: text(raw.email) || fallback.email,
    phone: text(raw.phone) || fallback.phone,
    currency: text(raw.currency) || fallback.currency,
    items,
    subtotal,
    shippingAmount,
    taxAmount,
    totalAmount: amount || subtotal + shippingAmount + taxAmount,
    paymentMethod: text(raw.paymentMethod) || fallback.paymentMethod,
    paymentStatus: text(raw.paymentStatus) || fallback.paymentStatus,
    shippingAddress: invoiceAddress(raw.shippingAddress) || fallback.shippingAddress,
    isFrozen: Boolean(raw.isFrozen ?? fallback.isFrozen),
  };
}

function money(value: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    minimumFractionDigits: 2,
  }).format(value);
}

function addressLines(address: InvoiceAddress | null): string[] {
  if (!address) return [];
  return [
    address.address1,
    address.address2,
    [address.city, address.province, address.postalCode].filter(Boolean).join(', '),
    address.country,
  ].filter(Boolean);
}

export default async function PIDocument({ params }: { params: Promise<{ id: string }> }) {
  const { id: oppId } = await params;
  if (!oppId) return <div className="p-10 font-bold text-red-600">Missing opportunity ID.</div>;

  const opp = await prisma.opportunity.findUnique({
    where: { id: String(oppId) },
    include: {
      company: { include: { contacts: { take: 1 } } },
      product: true,
    },
  });
  if (!opp) return <div className="p-10 font-bold text-red-600">Opportunity not found.</div>;

  const settings = await prisma.systemSettings.findFirst();
  const bank = {
    name: settings?.bankName || '[Configure bank name in Settings]',
    swift: settings?.bankSwift || '[Configure SWIFT/BIC]',
    accountNo: settings?.bankAccountNo || '[Configure account number]',
    beneficiary: settings?.bankBeneficiary || settings?.companyName || 'ERDI TECH LTD',
    address: settings?.bankAddress || '',
  };
  const contact = opp.company.contacts[0];
  const now = new Date();
  const shortId = String(oppId).slice(0, 6).toUpperCase();
  const baseAmount = opp.amountUSD || 0;
  const fallback: InvoiceData = {
    piNumber: `PI-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-${shortId}`,
    date: now.toISOString().slice(0, 10),
    companyName: opp.company.name,
    customerName: [contact?.firstName, contact?.lastName].filter(Boolean).join(' '),
    email: contact?.email || '',
    phone: contact?.phone || '',
    currency: 'USD',
    items: [{
      sku: opp.product?.sku || '',
      description: opp.product?.enName || opp.product?.name || opp.title || 'Laser rangefinder product',
      quantity: 1,
      unitPrice: baseAmount,
      amount: baseAmount,
    }],
    subtotal: baseAmount,
    shippingAmount: 0,
    taxAmount: 0,
    totalAmount: baseAmount,
    paymentMethod: '',
    paymentStatus: '',
    shippingAddress: null,
    isFrozen: opp.stage === 'CLOSED_WON',
  };

  const hasLockedData = opp.lockedPiData && typeof opp.lockedPiData === 'object';
  const invoiceData = normalizeInvoiceData(hasLockedData ? opp.lockedPiData : null, fallback);
  if (opp.stage === 'CLOSED_WON' && !hasLockedData) {
    await prisma.opportunity.update({
      where: { id: opp.id },
      data: { lockedPiData: invoiceData as unknown as Prisma.InputJsonObject },
    });
  }
  const paid = invoiceData.paymentStatus.toLowerCase() === 'paid';
  const billToLines = addressLines(invoiceData.shippingAddress);

  return (
    <main className="min-h-screen bg-gray-100 p-3 sm:p-8 print:bg-white print:p-0">
      <article className="relative mx-auto min-h-[297mm] w-full max-w-[210mm] bg-white p-6 shadow-2xl sm:p-10 lg:p-12 print:w-[210mm] print:max-w-none print:shadow-none">
        <header className="relative z-0 mb-8 flex flex-col gap-5 border-b-2 border-gray-800 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-black text-gray-900 sm:text-4xl">ERDI TECH LTD</h1>
            <p className="mt-2 text-sm text-gray-500">Laser & Optical Technology OEM/ODM</p>
          </div>
          <div className="sm:text-right">
            {invoiceData.isFrozen && (
              <div className="mb-2 inline-block border-2 border-gray-500 px-2 py-1 text-xs font-black text-gray-500">
                OFFICIAL ARCHIVED
              </div>
            )}
            <h2 className="text-2xl font-light tracking-widest text-blue-800 sm:text-3xl">PROFORMA INVOICE</h2>
            <p className="mt-2 font-mono text-gray-700">No. {invoiceData.piNumber}</p>
            <p className="text-sm text-gray-500">Date: {invoiceData.date}</p>
          </div>
        </header>

        <section className="relative z-0 mb-10 grid gap-8 text-sm sm:grid-cols-2">
          <div className="break-words">
            <h3 className="mb-2 border-b border-gray-200 pb-1 font-bold text-gray-800">BILL TO</h3>
            <p className="font-bold text-gray-800">{invoiceData.companyName}</p>
            {invoiceData.customerName && invoiceData.customerName !== invoiceData.companyName && <p className="mt-1 text-gray-700">{invoiceData.customerName}</p>}
            {billToLines.map(line => <p key={line} className="mt-1 text-gray-600">{line}</p>)}
            {invoiceData.email && <p className="mt-1 text-gray-600">Email: {invoiceData.email}</p>}
            {(invoiceData.phone || invoiceData.shippingAddress?.phone) && <p className="mt-1 text-gray-600">Phone: {invoiceData.phone || invoiceData.shippingAddress?.phone}</p>}
          </div>
          <div>
            <h3 className="mb-2 border-b border-gray-200 pb-1 font-bold text-gray-800">FROM</h3>
            <p className="font-bold text-gray-800">ERDI TECH LTD</p>
            <p className="mt-1 text-gray-600">Chengdu, China</p>
            <p className="text-gray-600">Email: sales@erdicn.com</p>
          </div>
        </section>

        <div className="relative z-0 mb-8 overflow-x-auto">
          <table className="w-full min-w-[680px] border-collapse">
            <thead>
              <tr className="bg-gray-100 text-sm text-gray-800">
                <th className="w-12 border border-gray-300 px-3 py-2 text-left">No.</th>
                <th className="border border-gray-300 px-3 py-2 text-left">Description / Specifications</th>
                <th className="w-20 border border-gray-300 px-3 py-2 text-center">Qty</th>
                <th className="w-32 border border-gray-300 px-3 py-2 text-right">Unit Price</th>
                <th className="w-32 border border-gray-300 px-3 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoiceData.items.map((item, index) => (
                <tr key={`${item.sku}-${index}`} className="text-sm">
                  <td className="border-b border-gray-200 px-3 py-3 text-center text-gray-500">{index + 1}</td>
                  <td className="border-b border-gray-200 px-3 py-3">
                    <p className="font-bold text-gray-800">{item.description}</p>
                    {item.sku && <p className="mt-1 font-mono text-xs text-gray-500">SKU: {item.sku}</p>}
                  </td>
                  <td className="border-b border-gray-200 px-3 py-3 text-center">{item.quantity}</td>
                  <td className="border-b border-gray-200 px-3 py-3 text-right">{money(item.unitPrice, invoiceData.currency)}</td>
                  <td className="border-b border-gray-200 px-3 py-3 text-right font-semibold">{money(item.amount, invoiceData.currency)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="text-sm">
              <tr><td colSpan={3} /><td className="px-3 pt-3 text-right text-gray-600">Subtotal</td><td className="px-3 pt-3 text-right">{money(invoiceData.subtotal, invoiceData.currency)}</td></tr>
              {invoiceData.shippingAmount > 0 && <tr><td colSpan={3} /><td className="px-3 py-1 text-right text-gray-600">Shipping</td><td className="px-3 py-1 text-right">{money(invoiceData.shippingAmount, invoiceData.currency)}</td></tr>}
              {invoiceData.taxAmount > 0 && <tr><td colSpan={3} /><td className="px-3 py-1 text-right text-gray-600">Tax</td><td className="px-3 py-1 text-right">{money(invoiceData.taxAmount, invoiceData.currency)}</td></tr>}
              <tr>
                <td colSpan={3} className="border-t-2 border-gray-800" />
                <td className="border-t-2 border-gray-800 px-3 py-3 text-right font-bold text-gray-700">TOTAL</td>
                <td className="border-t-2 border-gray-800 px-3 py-3 text-right text-xl font-bold text-blue-800">{money(invoiceData.totalAmount, invoiceData.currency)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {paid ? (
          <section className="relative z-0 mb-8 rounded border border-green-200 bg-green-50 p-4 text-sm text-green-900">
            <h3 className="mb-2 font-bold">PAYMENT DETAILS</h3>
            <p>Status: PAID</p>
            <p>Method: {invoiceData.paymentMethod || 'Online payment'}</p>
          </section>
        ) : (
          <section className="relative z-0 mb-8 rounded border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
            <h3 className="mb-2 font-bold text-gray-800">BANKING DETAILS (T/T in Advance)</h3>
            <p>Bank Name: {bank.name}</p>
            <p>Swift Code: {bank.swift}</p>
            <p>A/C No.: {bank.accountNo}</p>
            <p>Beneficiary: {bank.beneficiary}</p>
            {bank.address && <p>Bank Address: {bank.address}</p>}
          </section>
        )}

        <footer className="ml-auto mt-16 w-48 text-center">
          <p className="mb-16 text-sm text-gray-500">Authorized Signature</p>
          <div className="border-t border-gray-800 pt-2">
            <p className="text-sm font-bold text-gray-800">ERDI TECH LTD</p>
          </div>
        </footer>
      </article>
      <PrintButton />
    </main>
  );
}

export const dynamic = 'force-dynamic';
import React from 'react';
import { PrismaClient } from '@prisma/client';
import { notFound } from 'next/navigation';

const prisma = new PrismaClient();

export default async function PIDocumentPage({ params }: { params: { id: string } }) {
  // 从数据库查出这个商机的详细信息
  const opp = await prisma.opportunity.findUnique({
    where: { id: params.id },
    include: { company: true }
  });

  if (!opp) return notFound();

  const invoiceNo = `PI-${new Date().getFullYear()}${new Date().getMonth()+1}-${opp.id.substring(0,4).toUpperCase()}`;
  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const amount = opp.amount || 0; // 默认金额

  return (
    <div className="min-h-screen bg-gray-200 p-8 flex justify-center">
      {/* 这块白板模拟一张 A4 纸 */}
      <div className="bg-white w-full max-w-[800px] shadow-xl p-12 text-slate-800 font-sans">
        
        {/* 头部：Logo 和 抬头 */}
        <div className="flex justify-between items-start border-b-2 border-slate-900 pb-6 mb-8">
          <div>
            <h1 className="text-4xl font-extrabold text-slate-900 tracking-tighter">ERDI TECH</h1>
            <p className="text-sm font-semibold text-blue-600 tracking-widest mt-1">LASER & OPTICS EXPERTS</p>
          </div>
          <div className="text-right text-sm text-slate-500">
            <h2 className="text-2xl font-bold text-slate-300 mb-2">PROFORMA INVOICE</h2>
            <p>Chengdu, Sichuan, China</p>
            <p>Email: sales@erdicn.com</p>
            <p>Tel: +86-28-81076698</p>
          </div>
        </div>

        {/* 客户与发票信息 */}
        <div className="flex justify-between mb-10 text-sm">
          <div className="bg-slate-50 p-4 rounded-lg w-1/2 mr-4 border border-slate-100">
            <p className="font-bold text-slate-400 mb-1 text-xs">BILL TO (买方):</p>
            <p className="font-bold text-lg text-slate-800">{opp.company?.name || 'Customer'}</p>
            <p className="text-slate-600 mt-1">Source: {opp.company?.source}</p>
          </div>
          <div className="w-1/3 text-right flex flex-col justify-center">
            <p><span className="font-bold text-slate-600">PI No:</span> {invoiceNo}</p>
            <p><span className="font-bold text-slate-600">Date:</span> {dateStr}</p>
            <p><span className="font-bold text-slate-600">Validity:</span> 30 Days</p>
          </div>
        </div>

        {/* 订单表格 */}
        <table className="w-full mb-8 text-sm border-collapse">
          <thead>
            <tr className="bg-slate-900 text-white">
              <th className="p-3 text-left w-1/2">Description (产品描述)</th>
              <th className="p-3 text-center">Qty (数量)</th>
              <th className="p-3 text-right">Unit Price (单价)</th>
              <th className="p-3 text-right">Total (总价)</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-200">
              <td className="p-4 font-medium">{opp.title}</td>
              <td className="p-4 text-center">1</td>
              <td className="p-4 text-right">${amount.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
              <td className="p-4 text-right font-bold">${amount.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
            </tr>
          </tbody>
        </table>

        {/* 总价区域 */}
        <div className="flex justify-end mb-12">
          <div className="w-1/2 bg-slate-50 p-4 rounded-lg border border-slate-200">
            <div className="flex justify-between items-center text-lg font-bold text-slate-900">
              <span>TOTAL DUE:</span>
              <span className="text-blue-600">${amount.toLocaleString(undefined, {minimumFractionDigits: 2})} USD</span>
            </div>
          </div>
        </div>

        {/* 银行信息与签名 */}
        <div className="border-t border-slate-200 pt-8 text-sm text-slate-600 flex justify-between">
          <div className="w-2/3">
            <p className="font-bold text-slate-800 mb-2">Payment Terms (T/T or PayPal):</p>
            <p>Bank Name: Bank of China (Chengdu Branch)</p>
            <p>Account No: XXXX-XXXX-XXXX-XXXX</p>
            <p>SWIFT Code: BKCHCNXXXX</p>
            <p className="mt-4 italic">Delivery: 5-7 working days after payment received.</p>
          </div>
          <div className="w-1/3 text-center mt-10">
            <div className="border-b border-slate-400 mb-2 h-10"></div>
            <p>Authorized Signature</p>
            <p className="text-xs text-slate-400">(ERDI Sales Team)</p>
          </div>
        </div>
      </div>
    </div>
  );
}

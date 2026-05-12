import { PrismaClient } from '@prisma/client';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';


export const dynamic = 'force-dynamic';
const prisma = new PrismaClient();


export default async function FinanceDashboard() {
  // 🔒 安全校验：拦截没买票的黑客
  const role = cookies().get('auth_role')?.value;
  if (role !== 'finance' && role !== 'sales') {
    redirect('/');
  }


  // 财务只能看到“测试中”和“已成单”的业务
  const opps = await prisma.opportunity.findMany({
    where: { stage: { in: ['CLOSED_WON', 'NEGOTIATING'] } },
    orderBy: { updatedAt: 'desc' }
  });


  const totalRevenue = opps.filter(o => o.stage === 'CLOSED_WON').reduce((sum, o) => sum + (o.amountUSD || 0), 0);


  async function logout() {
    'use server';
    cookies().delete('auth_role');
    redirect('/');
  }


  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <header className="mb-8 flex justify-between items-center bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <div>
            <h1 className="text-2xl font-bold text-gray-800 tracking-tight">ERDI 财务数据中心</h1>
            <p className="text-sm text-gray-500 mt-1 flex items-center gap-2">

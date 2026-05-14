import { PrismaClient } from '@prisma/client';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
const prisma = new PrismaClient();

export default async function SuppliersPage() {
  const role = cookies().get('auth_role')?.value;
  if (!role) redirect('/');

  const suppliers = await prisma.supplier.findMany({ orderBy: { id: 'desc' } });

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-8 bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h1 className="text-2xl font-bold text-gray-800">🏭 供货商与采购管理</h1>
          <Link href="/dashboard" className="text-blue-600 hover:bg-blue-50 px-4 py-2 rounded-lg font-medium transition-colors">← 返回看板</Link>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden p-8 text-center text-gray-500">
          <p className="mb-4 text-4xl">🏗️</p>
          <h2 className="text-xl font-bold text-gray-700 mb-2">采购系统基础框架已搭建</h2>
          <p>供货商档案、进货单录入等功能将在下一次小版本更新中全面开放权限。</p>
          <p className="text-sm mt-4 text-gray-400">目前系统共有 {suppliers.length} 个供货商档案</p>
        </div>
      </div>
    </div>
  );
}

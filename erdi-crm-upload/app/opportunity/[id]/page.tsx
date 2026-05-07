import { PrismaClient } from '@prisma/client';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
const prisma = new PrismaClient();

async function updateOpportunity(formData: FormData) {
  'use server';
  
  const oppId = String(formData.get('oppId'));
  const amount = Number(formData.get('amount')) || 0;
  const companyId = String(formData.get('companyId')) || '';
  const stage = String(formData.get('stage'));

  if (!oppId) return;

  await prisma.opportunity.update({
    where: { id: oppId },
    data: { amount, companyId, stage }
  });

  redirect('/dashboard');
}

export default async function OpportunityDetail({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  const oppId = resolvedParams?.id;

  if (!oppId) return <div className="p-10">缺少商机 ID</div>;

  const opp = await prisma.opportunity.findUnique({
    where: { id: String(oppId) }
  });

  if (!opp) return <div className="p-10">找不到该商机</div>;

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-5xl mx-auto">
        
        <div className="mb-6 flex justify-between items-center">
          <Link href="/dashboard" className="text-gray-500 hover:text-gray-800 flex items-center gap-2 font-medium">
            ← 返回看板
          </Link>
          <h1 className="text-2xl font-bold text-gray-800">商机处理中心</h1>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          
          <div className="md:col-span-2 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-bold text-gray-800 border-b pb-3 mb-4">📧 原始邮件内容</h2>
            <div className="mb-4">
              <p className="text-sm text-gray-500">发件人/主题：</p>
              <p className="font-medium text-gray-800">{opp.title}</p>
            </div>
            <div className="mb-4">
              <p className="text-sm text-gray-500">接收时间：</p>
              <p className="text-gray-800">{opp.createdAt ? String(opp.createdAt) : ''}</p>
            </div>
            <div className="bg-gray-50 p-4 rounded-lg border border-gray-100 min-h-[300px] whitespace-pre-wrap text-gray-700">
              {/* 核心修复点：强制转换为 any 绕过类型检查，并且只在字段存在时显示 */}
              {(opp as any).description || '（此商机目前只记录了标题，没有存储完整的邮件正文内容）'}
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-bold text-blue-700 border-b pb-3 mb-4">⚙️ 业务处理台</h2>
            
            <form action={updateOpportunity} className="space-y-5">
              
              <input type="hidden" name="oppId" value={opp.id} />

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">真实客户/公司名</label>
                <input 
                  type="text" 
                  name="companyId" 
                  defaultValue={opp.companyId || ''} 
                  placeholder="例如: Apple Inc."
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">PI 报价总金额 (USD)</label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-gray-500">$</span>
                  <input 
                    type="number" 
                    name="amount" 
                    defaultValue={opp.amount || 0} 
                    className="w-full border border-gray-300 rounded-md pl-8 pr-3 py-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">推进漏斗阶段</label>
                <select 
                  name="stage" 
                  defaultValue={opp.stage}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                >
                  <option value="SPEC_CONFIRMING">1. 新询盘确认 (Spec Confirming)</option>
                  <option value="SAMPLE_TESTING">2. 样品测试 (Sample Testing)</option>
                  <option value="CLOSED_WON">3. 成功赢单 (Closed Won)</option>
                </select>
              </div>

              <div className="pt-4 mt-6 border-t border-gray-100">
                <button 
                  type="submit" 
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg transition-colors shadow-md"
                >
                  💾 保存修改并更新看板
                </button>
              </div>
            </form>
          </div>

        </div>
      </div>
    </div>
  );
}

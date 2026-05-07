import { PrismaClient } from '@prisma/client';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import nodemailer from 'nodemailer';

export const dynamic = 'force-dynamic';
const prisma = new PrismaClient();

// 动作 1：常规业务保存 (改金额、改公司、改阶段)
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

// 动作 2：发送邮件并记录到 CRM 历史
async function sendEmailReply(formData: FormData) {
  'use server';
  const oppId = String(formData.get('oppId'));
  const customerEmail = String(formData.get('customerEmail'));
  const replyContent = String(formData.get('replyContent'));
  const oldDescription = String(formData.get('oldDescription'));
  const oppTitle = String(formData.get('oppTitle'));

  if (!oppId || !replyContent || !customerEmail) return;

  // 1. 智能提取干净的客户邮箱地址
  let cleanEmail = customerEmail;
  const emailMatch = customerEmail.match(/<(.+?)>/);
  if (emailMatch) {
    cleanEmail = emailMatch[1];
  } else if (customerEmail.includes(' ')) {
    cleanEmail = customerEmail.split(' ').pop() || customerEmail;
  }

  try {
    // 2. 配置 Gmail 发送引擎
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: 'sales@erdicn.com',
        pass: 'qmkqpaledxcxicmu' // Gmail专用应用密码
      }
    });

    // 3. 发送真实邮件给客户
    await transporter.sendMail({
      from: '"ERDI TECH LTD" <sales@erdicn.com>',
      to: cleanEmail,
      subject: `Re: ${oppTitle}`,
      text: replyContent
    });

    // 4. 将我们的回复追加到 CRM 的 description 里留档
    const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const newDescription = oldDescription + `\n\n==================================\n[ERDI 回复记录 - ${timestamp}]\n${replyContent}`;

    await prisma.opportunity.update({
      where: { id: oppId },
      data: { description: newDescription }
    });

  } catch (error) {
    console.error("邮件发送失败:", error);
    // 这里如果发信失败其实可以做个错误页面，但为了保证主流程我们记录日志
  }

  // 刷新当前页面以展示最新记录
  redirect(`/opportunity/${oppId}`);
}


export default async function OpportunityDetail({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  const oppId = resolvedParams?.id;

  if (!oppId) return <div className="p-10">缺少商机 ID</div>;

  const opp = await prisma.opportunity.findUnique({
    where: { id: String(oppId) }
  });

  if (!opp) return <div className="p-10">找不到该商机</div>;

  // 从 title 里剥离出客户的名字和邮箱
  const rawSender = opp.title.replace('New Inquiry from ', '');

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        
        <div className="mb-6 flex justify-between items-center">
          <Link href="/dashboard" className="text-gray-500 hover:text-gray-800 flex items-center gap-2 font-medium bg-white px-4 py-2 rounded-lg shadow-sm border border-gray-200 transition-colors">
            ← 返回 CRM 看板
          </Link>
          <h1 className="text-2xl font-black text-gray-800 tracking-tight">ERDI 业务中心</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* 左侧大区：邮件阅读与回复互动区 */}
          <div className="lg:col-span-2 flex flex-col gap-6">
            
            {/* 历史沟通记录瀑布流 */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 flex flex-col h-full">
              <div className="flex justify-between items-center border-b border-gray-100 pb-4 mb-4">
                <h2 className="text-lg font-bold text-gray-800">📧 邮件流与沟通记录</h2>
                <span className="text-sm bg-blue-50 text-blue-600 px-3 py-1 rounded-full font-medium">{rawSender}</span>
              </div>
              
              {/* 正文阅读区 */}
              <div className="bg-gray-50/50 p-5 rounded-xl border border-gray-100 min-h-[300px] max-h-[500px] overflow-y-auto whitespace-pre-wrap text-gray-700 font-sans text-[15px] leading-relaxed shadow-inner">
                {(opp as any).description || '（目前没有正文记录）'}
              </div>
            </div>

            {/* 一键回复客户控制台 */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 border-l-4 border-l-blue-500 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50 rounded-full blur-3xl -mr-10 -mt-10 opacity-50"></div>
              
              <h2 className="text-lg font-bold text-blue-800 mb-4 relative z-10">✉️ 快捷回复客户</h2>
              <form action={sendEmailReply} className="space-y-4 relative z-10">
                <input type="hidden" name="oppId" value={opp.id} />
                <input type="hidden" name="customerEmail" value={rawSender} />
                <input type="hidden" name="oldDescription" value={(opp as any).description || ''} />
                <input type="hidden" name="oppTitle" value={opp.title} />
                
                <div>
                  <textarea 
                    name="replyContent" 
                    rows={5} 
                    required
                    placeholder={`在此输入要回复给 ${rawSender} 的内容...\n系统将以 sales@erdicn.com 的身份发出，并永久追加到上方历史记录中。`}
                    className="w-full border border-gray-200 rounded-xl p-4 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all shadow-sm text-sm resize-none bg-white/80 backdrop-blur-sm"
                  ></textarea>
                </div>
                
                <div className="text-right">
                  <button 
                    type="submit" 
                    className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-bold py-2.5 px-8 rounded-lg transition-all shadow-md hover:shadow-lg transform hover:-translate-y-0.5"
                  >
                    🚀 发送邮件并留档
                  </button>
                </div>
              </form>
            </div>

          </div>

          {/* 右侧窄区：业务参数处理 */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 h-fit sticky top-8">
            <h2 className="text-lg font-bold text-gray-800 border-b border-gray-100 pb-4 mb-5">⚙️ 商机控制台</h2>
            <form action={updateOpportunity} className="space-y-6">
              <input type="hidden" name="oppId" value={opp.id} />
              
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">🏢 真实客户公司名</label>
                <input 
                  type="text" name="companyId" defaultValue={opp.companyId || ''} 
                  placeholder="例如: Apple Inc."
                  className="w-full border border-gray-200 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-green-500 focus:border-green-500 bg-gray-50 focus:bg-white transition-colors text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">💵 PI 报价总金额 (USD)</label>
                <div className="relative">
                  <span className="absolute left-4 top-2.5 text-gray-500 font-medium">$</span>
                  <input 
                    type="number" name="amount" defaultValue={opp.amount || 0} 
                    className="w-full border border-gray-200 rounded-lg pl-8 pr-4 py-2.5 focus:ring-2 focus:ring-green-500 focus:border-green-500 bg-gray-50 focus:bg-white transition-colors font-mono font-medium text-lg text-green-700"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">🎯 推进漏斗阶段</label>
                <select 
                  name="stage" defaultValue={opp.stage} 
                  className="w-full border border-gray-200 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-green-500 focus:border-green-500 bg-gray-50 focus:bg-white transition-colors text-sm font-medium"
                >
                  <option value="SPEC_CONFIRMING">1️⃣ 新询盘确认</option>
                  <option value="SAMPLE_TESTING">2️⃣ 样品测试阶段</option>
                  <option value="CLOSED_WON">3️⃣ 成功赢单签约</option>
                </select>
              </div>

              <div className="pt-2">
                <button 
                  type="submit" 
                  className="w-full bg-gray-800 hover:bg-gray-900 text-white font-bold py-3 px-4 rounded-xl transition-all shadow-md hover:shadow-lg"
                >
                  💾 更新参数至看板
                </button>
              </div>
            </form>
          </div>

        </div>
      </div>
    </div>
  );
}

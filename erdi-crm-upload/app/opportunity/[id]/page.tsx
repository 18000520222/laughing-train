import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import nodemailer from 'nodemailer';
import { translateText } from '@/lib/translate';

export const dynamic = 'force-dynamic';

const STAGE_LABEL: Record<string, string> = {
  UNPROCESSED: '未处理',
  REPLIED: '已回复',
  QUOTING: '报价中',
  NEGOTIATING: '谈判中',
  SPEC_CONFIRMING: '规格确认',
  CLOSED_WON: '已成交',
  CLOSED_LOST: '已流失',
};


// 动作 1：常规业务保存 (改金额、改公司、改阶段)
async function updateOpportunity(formData: FormData) {
  'use server';
  const oppId = String(formData.get('oppId'));
  const amount = Number(formData.get('amount')) || 0;
  const companyId = String(formData.get('companyId')) || '';
  const stage = String(formData.get('stage'));
  const productId = String(formData.get('productId'));
  const nextStep = String(formData.get('nextStep') || '').trim();
  const lostReason = String(formData.get('lostReason') || '').trim();
  const lostDetail = String(formData.get('lostDetail') || '').trim();

  if (!oppId) return;
  if (!STAGE_LABEL[stage]) return;
  const existing = await prisma.opportunity.findUnique({
    where: { id: oppId },
    select: { stage: true, stageChangedAt: true, updatedAt: true },
  });
  if (!existing) return;

  const changedAt = new Date();
  const stageChanged = existing.stage !== stage;
  const email = cookies().get('auth_email')?.value || '';
  const actor = email ? await prisma.user.findUnique({ where: { email }, select: { id: true } }) : null;
  const updateData = {
    amountUSD: amount,
    companyId,
    stage: stage as any,
    stageChangedAt: stageChanged ? changedAt : undefined,
    productId: productId || null,
    nextStep: nextStep || null,
    lostReason: stage === 'CLOSED_LOST' ? (lostReason || '未填写原因') : null,
    lostDetail: stage === 'CLOSED_LOST' ? (lostDetail || null) : null,
  };

  if (stageChanged) {
    const previousStageAt = existing.stageChangedAt || existing.updatedAt;
    const durationDays = previousStageAt
      ? Math.max(0, Math.floor((changedAt.getTime() - new Date(previousStageAt).getTime()) / 86400000))
      : null;
    await prisma.$transaction([
      prisma.opportunity.update({
        where: { id: oppId },
        data: updateData,
      }),
      prisma.opportunityStageHistory.create({
        data: {
          opportunityId: oppId,
          fromStage: existing.stage as any,
          toStage: stage as any,
          durationDays,
          amountUSD: amount,
          note: nextStep || lostDetail || null,
          changedById: actor?.id || null,
          changedAt,
        },
      }),
    ]);
  } else {
    await prisma.opportunity.update({
      where: { id: oppId },
      data: updateData,
    });
  }
  redirect(`/opportunity/${oppId}`);
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
    const smtpUser = process.env.SMTP_USER || 'sales@erdicn.com';
    const smtpPass = process.env.SMTP_PASS;
    if (!smtpPass) {
      throw new Error('SMTP_PASS is not configured in environment variables.');
    }
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT || 465),
      secure: true,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    // 3. 发送真实邮件给客户
    await transporter.sendMail({
      from: `"ERDI TECH LTD" <${smtpUser}>`,
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
  }

  // 刷新当前页面以展示最新记录
  redirect(`/opportunity/${oppId}`);
}

export default async function OpportunityDetail({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  const oppId = resolvedParams?.id;

  if (!oppId) return <div className="p-10">缺少商机 ID</div>;

  const [products, companies] = await Promise.all([
    prisma.product.findMany({ where: { isActive: true }, orderBy: { sku: 'asc' } }),
    prisma.company.findMany({ orderBy: { updatedAt: 'desc' }, take: 500, select: { id: true, name: true, customerCode: true, country: true } }),
  ]);
  const opp = await prisma.opportunity.findUnique({
    where: { id: String(oppId) },
    include: {
      product: true,
      company: true,
      owner: true,
      stageHistory: {
        orderBy: { changedAt: 'desc' },
        take: 12,
        include: { changedBy: { select: { name: true, email: true } } },
      },
    },
  });

  if (!opp) return <div className="p-10">找不到该商机</div>;

  // 从 title 里剥离出客户的名字 and 邮箱
  const rawSender = opp.title.replace('New Inquiry from ', '');
  const stageAgeDays = Math.max(0, Math.floor((Date.now() - new Date(opp.stageChangedAt || opp.updatedAt).getTime()) / 86400000));
  const isStageStale = opp.stage !== 'CLOSED_WON' && opp.stage !== 'CLOSED_LOST' && stageAgeDays >= 7;

  // 智能翻译描述内容 (如果包含英文且存在内容)
  let translatedDesc = '';
  if (opp.description && opp.description.trim()) {
    const hasEnglish = /[a-zA-Z]{5,}/.test(opp.description);
    if (hasEnglish) {
      try {
        const transRes = await translateText(opp.description, 'zh', 'auto');
        translatedDesc = transRes.translatedText;
      } catch (err) {
        console.error('Failed to translate opportunity description:', err);
      }
    }
  }

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
              <div className="mb-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                <StatusCard label="客户" value={opp.company?.name || '未关联客户'} />
                <StatusCard label="阶段停留" value={`${stageAgeDays} 天`} tone={isStageStale ? 'rose' : 'slate'} />
                <StatusCard label="下一步" value={opp.nextStep || '未填写'} />
              </div>
              {isStageStale && (
                <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                  这个商机在当前阶段已停留 {stageAgeDays} 天,需要尽快跟进或更新阶段。
                </div>
              )}

              <div className="mb-4 rounded-xl border border-gray-100 bg-gray-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-black text-gray-800">阶段历史快照</h3>
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-gray-500">{opp.stageHistory.length} 次变更</span>
                </div>
                <div className="mt-3 space-y-2">
                  {opp.stageHistory.map((item) => (
                    <div key={item.id} className="rounded-lg border border-gray-100 bg-white px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs font-black text-gray-900">
                          {stageLabel(item.fromStage)} → {stageLabel(item.toStage)}
                        </div>
                        <span className="rounded-full bg-slate-50 px-2 py-1 text-[11px] font-black text-slate-600">
                          停留 {formatStageTransitionDuration(item.durationDays)}
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] font-bold text-gray-400">
                        {formatStageDate(item.changedAt)} · {item.changedBy?.name || item.changedBy?.email || '系统记录'} · 金额 ${(item.amountUSD || 0).toLocaleString()}
                      </div>
                      {item.note && <div className="mt-1 line-clamp-2 text-xs font-medium text-gray-500">{item.note}</div>}
                    </div>
                  ))}
                  {opp.stageHistory.length === 0 && (
                    <div className="rounded-lg border border-dashed border-gray-200 bg-white p-4 text-center text-xs font-bold text-gray-400">
                      暂无阶段变更历史。下次推进阶段时会自动沉淀快照。
                    </div>
                  )}
                </div>
              </div>
              
              {/* 正文与智能翻译阅读区 */}
              {translatedDesc ? (
                <div className="space-y-4">
                  <div>
                    <div className="text-xs font-bold text-blue-600 mb-1.5 flex items-center gap-1">
                      <span>🇨🇳 智能中文翻译</span>
                      <span className="px-1.5 py-0.2 bg-blue-100 text-blue-700 rounded text-[9px]">AUTOMATIC</span>
                    </div>
                    <div className="bg-blue-50/20 p-5 rounded-xl border border-blue-100/50 min-h-[180px] max-h-[350px] overflow-y-auto whitespace-pre-wrap text-gray-800 font-sans text-[15px] leading-relaxed shadow-inner">
                      {translatedDesc}
                    </div>
                  </div>
                  
                  <details className="group">
                    <summary className="list-none flex items-center justify-between text-xs text-gray-500 hover:text-gray-700 cursor-pointer select-none font-medium mb-1.5">
                      <span>🇺🇸 查看英文原文对照</span>
                      <span className="transition-transform group-open:rotate-180 text-[10px]">▼</span>
                    </summary>
                    <div className="bg-gray-50/50 p-5 rounded-xl border border-gray-100 min-h-[150px] max-h-[300px] overflow-y-auto whitespace-pre-wrap text-gray-600 font-mono text-xs leading-relaxed shadow-inner">
                      {(opp as any).description || '（目前没有正文记录）'}
                    </div>
                  </details>
                </div>
              ) : (
                <div className="bg-gray-50/50 p-5 rounded-xl border border-gray-100 min-h-[300px] max-h-[500px] overflow-y-auto whitespace-pre-wrap text-gray-700 font-sans text-[15px] leading-relaxed shadow-inner">
                  {(opp as any).description || '（目前没有正文记录）'}
                </div>
              )}
            </div>

            {/* 一键回复客户控制台 (已修复按钮丢失问题) */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 border-l-4 border-l-blue-500 mt-2">
              <h2 className="text-lg font-bold text-blue-800 mb-4">✉️ 快捷回复客户</h2>
              <form action={sendEmailReply} className="flex flex-col gap-4">
                <input type="hidden" name="oppId" value={opp.id} />
                <input type="hidden" name="customerEmail" value={rawSender} />
                <input type="hidden" name="oldDescription" value={(opp as any).description || ''} />
                <input type="hidden" name="oppTitle" value={opp.title} />
                
                <textarea 
                  name="replyContent" 
                  rows={5} 
                  required
                  placeholder={`在此输入要回复给 ${rawSender} 的内容...\n系统将以 sales@erdicn.com 的身份发出，并永久追加到上方历史记录中。`}
                  className="w-full border border-gray-300 rounded-xl p-4 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 shadow-sm text-sm resize-none"
                ></textarea>
                
                <button 
                  type="submit" 
                  className="self-end bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-lg shadow-md transition-colors"
                >
                  🚀 发送邮件并留档
                </button>
              </form>
            </div>

          </div>

          {/* 右侧窄区：业务参数处理 */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 h-fit sticky top-8">
          
          <h2 className="text-lg font-bold text-gray-800 border-b border-gray-100 pb-4 mb-5">🗂️ 自动生成单据全家桶</h2>
          <div className="grid grid-cols-2 gap-3 mb-8">
            <Link href={`/pi/${opp.id}`} className="flex flex-col items-center justify-center p-3 border border-blue-200 bg-blue-50 rounded-lg hover:bg-blue-100 text-blue-700 font-semibold text-sm transition-colors shadow-sm">
              <span className="text-xl mb-1">📄</span> 形式发票 PI
            </Link>
            <Link href={`/ci/${opp.id}`} className="flex flex-col items-center justify-center p-3 border border-indigo-200 bg-indigo-50 rounded-lg hover:bg-indigo-100 text-indigo-700 font-semibold text-sm transition-colors shadow-sm">
              <span className="text-xl mb-1">🧾</span> 商业发票 CI
            </Link>
            <Link href={`/pl/${opp.id}`} className="flex flex-col items-center justify-center p-3 border border-amber-200 bg-amber-50 rounded-lg hover:bg-amber-100 text-amber-700 font-semibold text-sm transition-colors shadow-sm">
              <span className="text-xl mb-1">📦</span> 装箱单 PL
            </Link>
            <Link href={`/contract/${opp.id}`} className="flex flex-col items-center justify-center p-3 border border-green-200 bg-green-50 rounded-lg hover:bg-green-100 text-green-700 font-semibold text-sm transition-colors shadow-sm">
              <span className="text-xl mb-1">🤝</span> 销售合同
            </Link>
            <Link href={`/customs/${opp.id}`} className="col-span-2 flex items-center justify-center gap-2 p-3 border border-purple-200 bg-purple-50 rounded-lg hover:bg-purple-100 text-purple-700 font-semibold text-sm transition-colors shadow-sm">
              <span>🛃</span> 智能报关要素与草单
            </Link>
          </div>

            <h2 className="text-lg font-bold text-gray-800 border-b border-gray-100 pb-4 mb-5">⚙️ 商机控制台</h2>
            <form action={updateOpportunity} className="space-y-6">
              <input type="hidden" name="oppId" value={opp.id} />
              
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">🏢 关联客户公司</label>
                <select
                  name="companyId"
                  defaultValue={opp.companyId || ''}
                  className="w-full border border-gray-200 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-green-500 focus:border-green-500 bg-gray-50 focus:bg-white transition-colors text-sm"
                >
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>{c.customerCode ? `${c.customerCode} · ` : ''}{c.name}{c.country ? ` · ${c.country}` : ''}</option>
                  ))}
                </select>
              </div>

              
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">📦 关联光电产品</label>
                <select 
                  name="productId" defaultValue={opp.productId || ''} 
                  className="w-full border border-gray-200 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-green-500 focus:border-green-500 bg-gray-50 focus:bg-white transition-colors text-sm"
                >
                  <option value="">-- 请选择产品 (用于自动生成报关及单据) --</option>
                  {products.map(p => (
                    <option key={p.id} value={p.id}>{p.sku} - {p.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">💵 PI 报价总金额 (USD)</label>
                <div className="relative">
                  <span className="absolute left-4 top-2.5 text-gray-500 font-medium">$</span>
                  <input 
                    type="number" name="amount" defaultValue={opp.amountUSD || 0} 
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
                  <option value="UNPROCESSED">0. 未处理</option>
                  <option value="REPLIED">1. 已回复</option>
                  <option value="QUOTING">2. 报价中</option>
                  <option value="NEGOTIATING">3. 谈判中</option>
                  <option value="SPEC_CONFIRMING">4. 规格确认</option>
                  <option value="CLOSED_WON">5. 成功赢单</option>
                  <option value="CLOSED_LOST">6. 已丢单/流失</option>
                </select>
                <p className="mt-1 text-xs text-gray-400">阶段变化后会自动刷新阶段停留天数。</p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">✅ 下一步动作</label>
                <textarea
                  name="nextStep"
                  rows={3}
                  defaultValue={opp.nextStep || ''}
                  placeholder="如: 今天发送 PI; 周五跟进样品测试反馈; 等客户确认 1535nm 参数"
                  className="w-full border border-gray-200 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-green-500 focus:border-green-500 bg-gray-50 focus:bg-white transition-colors text-sm"
                />
              </div>

              <div className="rounded-xl border border-rose-100 bg-rose-50/40 p-4">
                <label className="block text-sm font-semibold text-gray-700 mb-2">📉 丢单原因</label>
                <select
                  name="lostReason"
                  defaultValue={opp.lostReason || ''}
                  className="w-full border border-rose-100 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-rose-400 focus:border-rose-400 bg-white transition-colors text-sm"
                >
                  <option value="">未丢单/无需填写</option>
                  <option value="PRICE">价格不合适</option>
                  <option value="SPEC">规格/性能不匹配</option>
                  <option value="DELIVERY">交期不满足</option>
                  <option value="CERTIFICATION">认证/资质不满足</option>
                  <option value="COMPETITOR">被竞争对手拿走</option>
                  <option value="NO_RESPONSE">客户无回复</option>
                  <option value="BUDGET">预算取消/推迟</option>
                  <option value="OTHER">其他</option>
                </select>
                <textarea
                  name="lostDetail"
                  rows={3}
                  defaultValue={opp.lostDetail || ''}
                  placeholder="丢单时写清楚真实原因、竞争对手、价格差距、下次改进点"
                  className="mt-3 w-full border border-rose-100 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-rose-400 focus:border-rose-400 bg-white transition-colors text-sm"
                />
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

function StatusCard({ label, value, tone = 'slate' }: { label: string; value: string; tone?: 'slate' | 'rose' }) {
  const color = tone === 'rose' ? 'bg-rose-50 text-rose-700 border-rose-100' : 'bg-slate-50 text-slate-700 border-slate-100';
  return (
    <div className={`rounded-xl border px-4 py-3 ${color}`}>
      <div className="text-xs font-bold opacity-70">{label}</div>
      <div className="mt-1 text-sm font-bold line-clamp-2">{value}</div>
    </div>
  );
}

function stageLabel(stage: string | null | undefined) {
  if (!stage) return '初始';
  return STAGE_LABEL[stage] || stage;
}

function formatStageTransitionDuration(days: number | null | undefined) {
  if (days === null || days === undefined) return '-';
  return `${days} 天`;
}

function formatStageDate(date: Date) {
  return new Date(date).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

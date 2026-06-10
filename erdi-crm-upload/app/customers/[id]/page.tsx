import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { chat, isLLMAvailable } from '@/lib/llm';

export const dynamic = 'force-dynamic';

const STAGE_LABEL: Record<string, string> = {
  UNPROCESSED: '未处理',
  REPLIED: '已回复',
  QUOTING: '报价中',
  NEGOTIATING: '谈判中',
  SPEC_CONFIRMING: '确认规格',
  CLOSED_WON: '已成交',
  CLOSED_LOST: '已流失',
};

const STAGE_COLOR: Record<string, string> = {
  UNPROCESSED: 'bg-gray-100 text-gray-600',
  REPLIED: 'bg-blue-50 text-blue-700',
  QUOTING: 'bg-amber-50 text-amber-700',
  NEGOTIATING: 'bg-orange-50 text-orange-700',
  SPEC_CONFIRMING: 'bg-purple-50 text-purple-700',
  CLOSED_WON: 'bg-green-50 text-green-700',
  CLOSED_LOST: 'bg-red-50 text-red-600',
};

const CHANNEL_LABEL: Record<string, string> = {
  EMAIL: '邮件',
  WHATSAPP: 'WhatsApp',
  ALIBABA: '阿里国际站',
  AMAZON: '亚马逊',
  SHOPEE: '虾皮',
  FACEBOOK: 'Facebook',
};

const TYPE_LABEL: Record<string, string> = {
  NEW: '新客户',
  EXISTING: '老客户',
  PROSPECT: '潜在客户',
  KEY_ACCOUNT: '重点客户',
  LOST: '流失客户',
};

function fmtDate(d: Date | null | undefined): string {
  if (!d) return '-';
  return new Date(d).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

async function updateCustomer(formData: FormData) {
  'use server';
  const role = (cookies().get('auth_role')?.value || '').toUpperCase();
  if (role !== 'SALES' && role !== 'SUPER_ADMIN' && role !== 'ADMIN') return;

  const id = String(formData.get('id') || '');
  if (!id) return;
  const s = (k: string) => {
    const v = formData.get(k);
    const str = v === null ? '' : String(v).trim();
    return str === '' ? null : str;
  };
  const name = s('name');
  if (!name) return;

  await prisma.company.update({
    where: { id },
    data: {
      name,
      customerCode: s('customerCode'),
      type: (s('type') as any) || 'PROSPECT',
      country: s('country'),
      industry: s('industry'),
      website: s('website'),
    },
  });
  redirect(`/customers/${id}`);
}

async function addFollowUp(formData: FormData) {
  'use server';
  const role = (cookies().get('auth_role')?.value || '').toUpperCase();
  if (role !== 'SALES' && role !== 'SUPER_ADMIN' && role !== 'ADMIN') return;

  const companyId = String(formData.get('companyId') || '');
  const content = String(formData.get('content') || '').trim();
  const type = String(formData.get('type') || 'NOTE');
  
  if (!companyId || !content) return;

  const authEmail = cookies().get('auth_email')?.value;
  if (!authEmail) return;

  const user = await prisma.user.findUnique({
    where: { email: authEmail }
  });
  if (!user) return;

  await prisma.followUp.create({
    data: {
      content,
      type,
      companyId,
      userId: user.id
    }
  });

  redirect(`/customers/${companyId}`);
}

async function getAICustomerInsights(company: any) {
  try {
    const isAvailable = isLLMAvailable();
    if (!isAvailable) return null;

    const recentMsgs = company.inboxMessages.slice(0, 3).map((m: any) => ({
      direction: m.direction === 'IN' ? '客户来信' : '我方回复',
      channel: m.channel,
      text: m.originalText,
    }));

    const recentFollowUps = company.followUps.slice(0, 3).map((f: any) => ({
      content: f.content,
      type: f.type,
      date: f.createdAt,
    }));

    const prompt = `你是一个外贸 B2B 领域的资深销售专家 AI 助手。请根据下方的客户信息、往来消息和跟进记录，对客户进行深度意图、情绪和成单赢率的智能分析，并提供针对性的跟进话术模板。
    
客户基本信息：
公司名称: ${company.name}
国家/地区: ${company.country || '未知'}
行业: ${company.industry || '未知'}
客户类型: ${company.type}

最近 3 条往来消息：
${JSON.stringify(recentMsgs, null, 2)}

最近 3 条跟进记录：
${JSON.stringify(recentFollowUps, null, 2)}

请务必输出一个合法的 JSON 格式字符串，格式必须与以下结构一致（不要输出 Markdown 的 \`\`\`json 标记，直接输出 JSON 文本）：
{
  "clientType": "例如：高价值批发商 / 学术机构 / 价格敏感买家",
  "clientSentiment": "例如：高度意向 / 温和观望 / 冰冷休眠",
  "winRate": "成单概率估计，例如：75%",
  "riskAssessment": "识别出的潜在风险或同行竞争威胁，如果没有，写'暂无风险'",
  "followUpStrategy": "具体的跟进策略和建议（100字以内，中文）",
  "recommendedDraftZh": "一键跟进邮件中文模板（语气专业、针对性极强，且表达热情）",
  "recommendedDraftEn": "英文翻译（销售经理可以直接发送给客户）"
}`;

    const resText = await chat([
      { role: 'system', content: 'You must output a raw, valid JSON object matching the requested schema.' },
      { role: 'user', content: prompt }
    ], { temperature: 0.3, timeoutMs: 12000 });

    const cleanJson = resText.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    return JSON.parse(cleanJson);
  } catch (err) {
    console.error('AI Customer Insights extraction failed:', err);
    return null;
  }
}

export default async function CustomerDetailPage(props: any) {
  const role = (cookies().get('auth_role')?.value || '').toUpperCase();
  if (role !== 'SALES' && role !== 'SUPER_ADMIN' && role !== 'ADMIN') {
    redirect('/');
  }

  const id = props.params.id as string;

  const company = await prisma.company.findUnique({
    where: { id },
    include: {
      owner: true,
      contacts: { orderBy: { createdAt: 'asc' } },
      opportunities: { orderBy: { updatedAt: 'desc' }, include: { product: true } },
      followUps: { orderBy: { createdAt: 'desc' }, take: 20, include: { user: true } },
      inboxMessages: { orderBy: { createdAt: 'desc' }, take: 15 },
    },
  });

  if (!company) notFound();

  const aiInsights = await getAICustomerInsights(company);

  const wonAmount = company.opportunities
    .filter((o) => o.stage === 'CLOSED_WON')
    .reduce((s, o) => s + (o.amountUSD || 0), 0);
  const openCount = company.opportunities.filter(
    (o) => o.stage !== 'CLOSED_WON' && o.stage !== 'CLOSED_LOST'
  ).length;

  // 💡 智能行动指南 / 互动提示语逻辑
  const lastMailDate = company.inboxMessages[0]?.sentAt || company.inboxMessages[0]?.createdAt || null;
  const lastFollowUpDate = company.followUps[0]?.createdAt || null;
  const lastInteractionDate = [lastMailDate, lastFollowUpDate, company.createdAt]
    .filter(Boolean)
    .map(d => new Date(d!).getTime())
    .reduce((max, t) => Math.max(max, t), 0);

  const daysSinceLastInteraction = Math.floor((Date.now() - lastInteractionDate) / (1000 * 60 * 60 * 24));

  const hints: Array<{ type: 'danger' | 'warning' | 'success' | 'info'; text: string }> = [];

  if (daysSinceLastInteraction >= 90) {
    hints.push({
      type: 'danger',
      text: `⚠️ 失联预警：该客户已失联长达 ${daysSinceLastInteraction} 天！系统判定为深度休眠，建议立即主动联络激活，或释放归入公海。`
    });
  } else if (daysSinceLastInteraction >= 30) {
    hints.push({
      type: 'warning',
      text: `🔔 提示：已有 ${daysSinceLastInteraction} 天没有与客户互动，建议尽快安排跟进（如发送最新的激光模块规格、报价单进行常规问候）。`
    });
  } else {
    hints.push({
      type: 'success',
      text: `🎉 状态活跃：最近跟进/往来发生在 ${daysSinceLastInteraction} 天内。客户关系处于活跃期，请继续保持！`
    });
  }

  const lastIncomingMail = company.inboxMessages.find(m => m.direction === 'IN');
  if (lastIncomingMail && lastIncomingMail.status === 'AI_DRAFTED') {
    hints.push({
      type: 'warning',
      text: `✉️ 新邮件提示：客户发来了新询盘，AI 已经为您翻译为中文并写好回复草稿，请前往【全渠道收件箱】查看回复！`
    });
  }

  const openOpps = company.opportunities.filter(o => o.stage !== 'CLOSED_WON' && o.stage !== 'CLOSED_LOST');
  if (openOpps.length > 0) {
    openOpps.forEach(op => {
      if (op.stage === 'UNPROCESSED' || op.stage === 'REPLIED') {
        hints.push({
          type: 'info',
          text: `💼 商机提示：商机【${op.title}】规格若已基本敲定，建议在商机模块为其一键生成 形式发票 (PI) 锁定项目订单！`
        });
      } else if (op.stage === 'SPEC_CONFIRMING' && !op.lockedCiData) {
        hints.push({
          type: 'info',
          text: `📜 单证提示：商机【${op.title}】的订单已锁定，请前往商机管理中生成 商业发票 (CI) 和 装箱单 (PL) 以筹备出口报关装运！`
        });
      }
    });
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6 md:p-8">
      {/* 顶部 */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3 text-sm text-gray-500">
          <Link href="/customers" className="hover:text-gray-800 font-medium">← 客户列表</Link>
          <span>/</span>
          <span className="text-gray-800 font-semibold">{company.name}</span>
        </div>
        <Link href="/dashboard" className="bg-gray-800 text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-gray-700 transition-all">
          返回看板
        </Link>
      </div>

      {/* 公司概览卡片 */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-black text-gray-900">{company.name}</h1>
              <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded font-mono text-xs font-bold">
                {company.customerCode || '未分配编号'}
              </span>
              <span className="bg-indigo-50 text-indigo-700 px-2 py-1 rounded text-xs font-bold">
                {TYPE_LABEL[company.type] || company.type}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-600">
              <span>🌍 国家：{company.country || '-'}</span>
              <span>🏭 行业：{company.industry || '-'}</span>
              <span>🔗 来源：{company.source || '-'}</span>
              {company.website && (
                <a href={company.website.startsWith('http') ? company.website : `https://${company.website}`}
                   target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                  🌐 {company.website}
                </a>
              )}
              <span>👤 负责人：{company.owner?.name || company.owner?.email || '未分配'}</span>
              <span>🕒 创建：{fmtDate(company.createdAt)}</span>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="bg-green-50 rounded-xl px-5 py-3 text-center">
              <div className="text-2xl font-black text-green-700">${wonAmount.toLocaleString()}</div>
              <div className="text-xs text-green-600 font-bold mt-1">成交金额</div>
            </div>
            <div className="bg-orange-50 rounded-xl px-5 py-3 text-center">
              <div className="text-2xl font-black text-orange-700">{openCount}</div>
              <div className="text-xs text-orange-600 font-bold mt-1">进行中商机</div>
            </div>
          </div>
        </div>

        {/* 编辑客户信息 */}
        <details className="mt-5 pt-5 border-t border-gray-100">
          <summary className="cursor-pointer select-none text-sm font-bold text-indigo-600 hover:text-indigo-700">
            ✏️ 编辑客户信息
          </summary>
          <form action={updateCustomer} className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            <input type="hidden" name="id" value={company.id} />
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">公司名称 *</label>
              <input name="name" defaultValue={company.name} required className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">客户编号</label>
              <input name="customerCode" defaultValue={company.customerCode || ''} placeholder="可填写 / 修改" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">客户类型</label>
              <select name="type" defaultValue={company.type} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none bg-white">
                <option value="PROSPECT">潜在客户</option>
                <option value="NEW">新客户</option>
                <option value="EXISTING">老客户</option>
                <option value="KEY_ACCOUNT">重点客户</option>
                <option value="LOST">流失客户</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">国家 / 地区</label>
              <input name="country" defaultValue={company.country || ''} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">行业</label>
              <input name="industry" defaultValue={company.industry || ''} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">官网</label>
              <input name="website" defaultValue={company.website || ''} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
            </div>
            <div className="md:col-span-3">
              <button type="submit" className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-6 py-2.5 rounded-lg transition-all">
                保存修改
              </button>
            </div>
          </form>
        </details>
      </div>

      {/* ✨ AI 客户智能分析大脑 (AI Customer Brain) */}
      {aiInsights && (
        <div className="bg-gradient-to-r from-indigo-50 via-purple-50 to-pink-50 rounded-2xl shadow-md border border-indigo-100/50 p-6 mb-6">
          <div className="flex items-center justify-between mb-4 border-b border-indigo-100/30 pb-3">
            <h3 className="text-base font-black text-indigo-900 flex items-center gap-2">
              <span className="animate-pulse">✨</span> AI 客户智能分析大脑
            </h3>
            <span className="bg-indigo-600 text-white text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full shadow-sm">
              Copilot Active
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
            <div className="bg-white/80 p-3 rounded-xl border border-indigo-100/30">
              <span className="text-[10px] text-indigo-500 font-bold uppercase block mb-0.5 tracking-wider">🎯 客户画像判定</span>
              <span className="text-sm font-extrabold text-gray-800">{aiInsights.clientType}</span>
            </div>
            <div className="bg-white/80 p-3 rounded-xl border border-indigo-100/30">
              <span className="text-[10px] text-indigo-500 font-bold uppercase block mb-0.5 tracking-wider">🔥 采购意向热度</span>
              <span className="text-sm font-extrabold text-gray-800">{aiInsights.clientSentiment}</span>
            </div>
            <div className="bg-white/80 p-3 rounded-xl border border-indigo-100/30">
              <span className="text-[10px] text-indigo-500 font-bold uppercase block mb-0.5 tracking-wider">📈 预计成单赢率</span>
              <span className="text-sm font-extrabold text-indigo-600">{aiInsights.winRate}</span>
            </div>
            <div className="bg-white/80 p-3 rounded-xl border border-indigo-100/30">
              <span className="text-[10px] text-red-500 font-bold uppercase block mb-0.5 tracking-wider">⚠️ 潜在流失风险</span>
              <span className="text-sm font-extrabold text-red-600">{aiInsights.riskAssessment}</span>
            </div>
          </div>

          <div className="bg-white/90 p-4 rounded-xl border border-indigo-100/30 mb-4 shadow-inner">
            <span className="text-xs font-bold text-indigo-800 block mb-1">🎯 首席顾问跟进策略建议：</span>
            <p className="text-sm text-gray-700 leading-relaxed">{aiInsights.followUpStrategy}</p>
          </div>

          {/* AI 一键跟进模板双语 */}
          <details className="group bg-white/90 rounded-xl border border-indigo-100/30 overflow-hidden">
            <summary className="list-none flex items-center justify-between text-xs font-bold text-indigo-700 hover:text-indigo-900 cursor-pointer select-none p-3.5">
              <span className="flex items-center gap-1.5">
                <span>✉️</span> 智能生成针对性跟进话术模板 (中英对照)
              </span>
              <span className="transition-transform group-open:rotate-180 text-[10px]">▼</span>
            </summary>
            
            <div className="p-4 border-t border-indigo-100/20 bg-indigo-50/20 space-y-4 text-xs">
              <div>
                <div className="text-[10px] text-indigo-600 font-bold mb-1 tracking-wider">🇨🇳 中文话术（供您理解）</div>
                <div className="text-sm text-gray-800 bg-white p-3 rounded-lg border border-indigo-100/10 whitespace-pre-wrap leading-relaxed shadow-sm">{aiInsights.recommendedDraftZh}</div>
              </div>
              <div>
                <div className="text-[10px] text-indigo-600 font-bold mb-1 tracking-wider flex items-center justify-between">
                  <span>🇺🇸 英文内容（点击内容即可全选复制，回复客户）</span>
                </div>
                <pre className="text-xs font-mono text-gray-700 bg-white p-3 rounded-lg border border-indigo-100/10 whitespace-pre-wrap leading-relaxed shadow-sm select-all cursor-pointer" title="双击或长按即可快速全选">
                  {aiInsights.recommendedDraftEn}
                </pre>
              </div>
            </div>
          </details>
        </div>
      )}

      {/* 💡 智能行动指南 (Hints & Alerts) */}
      {hints.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
          <h3 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-2">
            💡 智能行动指南
          </h3>
          <div className="space-y-2.5">
            {hints.map((h, i) => {
              const bg = h.type === 'danger' ? 'bg-red-50 text-red-700 border-red-100'
                : h.type === 'warning' ? 'bg-amber-50 text-amber-700 border-amber-100'
                : h.type === 'success' ? 'bg-green-50 text-green-700 border-green-100'
                : 'bg-blue-50 text-blue-700 border-blue-100';
              return (
                <div key={i} className={`px-4 py-3 rounded-xl border text-sm font-medium ${bg}`}>
                  {h.text}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 左列：联系人 + 商机 */}
        <div className="lg:col-span-2 space-y-6">
          {/* 联系人 */}
          <section className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <h2 className="px-6 py-4 font-bold text-gray-800 border-b border-gray-100">
              📇 联系人 <span className="text-gray-400 font-normal">（{company.contacts.length}）</span>
            </h2>
            {company.contacts.length === 0 ? (
              <p className="px-6 py-8 text-center text-gray-400 text-sm">暂无联系人</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-xs">
                    <th className="text-left px-6 py-2 font-bold">姓名</th>
                    <th className="text-left px-4 py-2 font-bold">职位</th>
                    <th className="text-left px-4 py-2 font-bold">邮箱</th>
                    <th className="text-left px-4 py-2 font-bold">电话</th>
                  </tr>
                </thead>
                <tbody>
                  {company.contacts.map((ct) => (
                    <tr key={ct.id} className="border-t border-gray-50">
                      <td className="px-6 py-3 font-semibold text-gray-800">
                        {ct.firstName} {ct.lastName || ''}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{ct.title || '-'}</td>
                      <td className="px-4 py-3">
                        <a href={`mailto:${ct.email}`} className="text-blue-600 hover:underline">{ct.email}</a>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{ct.phone || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* 商机 */}
          <section className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <h2 className="px-6 py-4 font-bold text-gray-800 border-b border-gray-100">
              💼 商机 <span className="text-gray-400 font-normal">（{company.opportunities.length}）</span>
            </h2>
            {company.opportunities.length === 0 ? (
              <p className="px-6 py-8 text-center text-gray-400 text-sm">暂无商机</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {company.opportunities.map((op) => (
                  <Link key={op.id} href={`/opportunity/${op.id}`}
                        className="flex items-center justify-between px-6 py-4 hover:bg-gray-50 transition-colors">
                    <div className="min-w-0">
                      <div className="font-semibold text-gray-800 truncate">{op.title}</div>
                      <div className="text-xs text-gray-400 mt-1">
                        {op.opportunityCode || op.id.slice(0, 8)} · {op.product?.name || '未关联产品'} · 更新 {fmtDate(op.updatedAt)}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 ml-4">
                      {op.amountUSD ? (
                        <span className="font-bold text-gray-700">${op.amountUSD.toLocaleString()}</span>
                      ) : null}
                      <span className={`px-2 py-1 rounded text-xs font-bold ${STAGE_COLOR[op.stage] || 'bg-gray-100 text-gray-600'}`}>
                        {STAGE_LABEL[op.stage] || op.stage}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* 右列：往来邮件 + 跟进 */}
        <div className="space-y-6">
          <section className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <h2 className="px-6 py-4 font-bold text-gray-800 border-b border-gray-100">📨 最近往来</h2>
            {company.inboxMessages.length === 0 ? (
              <p className="px-6 py-8 text-center text-gray-400 text-sm">暂无往来消息</p>
            ) : (
              <ul className="divide-y divide-gray-50 max-h-[500px] overflow-y-auto">
                {company.inboxMessages.map((m) => (
                  <li key={m.id} className="px-6 py-4 hover:bg-gray-50/40 transition-colors">
                    <div className="flex items-center justify-between text-xs text-gray-400 mb-2">
                      <span className={`font-bold ${m.direction === 'IN' ? 'text-blue-600' : 'text-green-600'}`}>
                        {m.direction === 'IN' ? '↓ 客户来信' : '↑ 我方回复'} · {CHANNEL_LABEL[m.channel] || m.channel}
                      </span>
                      <span>{fmtDate(m.sentAt || m.createdAt)}</span>
                    </div>
                    
                    {/* 默认简短预览 */}
                    <p className="text-sm font-semibold text-gray-800 line-clamp-2 leading-relaxed">
                      {m.direction === 'IN' ? (m.translatedText || m.originalText) : (m.originalText || m.aiReplyZh)}
                    </p>

                    {/* 免 JS 纯 HTML 细节折叠器，极速展开译文和原文对照 */}
                    <details className="group mt-2">
                      <summary className="list-none flex items-center justify-between text-xs text-indigo-600 hover:text-indigo-800 cursor-pointer select-none font-medium">
                        <span>{m.direction === 'IN' ? '📖 展开中英双语对照' : '📖 展开我方中英回复'}</span>
                        <span className="transition-transform group-open:rotate-180 text-[10px]">▼</span>
                      </summary>
                      
                      <div className="mt-2 text-xs space-y-3.5 border-t border-gray-100 pt-3 bg-gray-50/60 p-3 rounded-xl border border-gray-100/50">
                        {m.direction === 'IN' ? (
                          <>
                            <div>
                              <div className="text-[10px] text-blue-600 font-bold mb-1 tracking-wider uppercase">🇨🇳 中文翻译</div>
                              <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed bg-white p-2.5 rounded-lg border border-gray-100">{m.translatedText || '暂无翻译'}</div>
                            </div>
                            <div>
                              <div className="text-[10px] text-gray-500 font-bold mb-1 tracking-wider uppercase">🇺🇸 客户原文 ({m.detectedLang || 'EN'})</div>
                              <div className="text-xs text-gray-600 font-mono whitespace-pre-wrap leading-relaxed bg-white p-2.5 rounded-lg border border-gray-100">{m.originalText}</div>
                            </div>
                          </>
                        ) : (
                          <>
                            <div>
                              <div className="text-[10px] text-green-600 font-bold mb-1 tracking-wider uppercase">🇨🇳 我方中文 (编写内容)</div>
                              <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed bg-white p-2.5 rounded-lg border border-gray-100">{m.originalText || m.aiReplyZh}</div>
                            </div>
                            {m.aiReplyCustomer && (
                              <div>
                                <div className="text-[10px] text-gray-500 font-bold mb-1 tracking-wider uppercase">🇺🇸 译文 (实际发送给客户)</div>
                                <div className="text-xs text-gray-600 font-mono whitespace-pre-wrap leading-relaxed bg-white p-2.5 rounded-lg border border-gray-100">{m.aiReplyCustomer}</div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <h2 className="px-6 py-4 font-bold text-gray-800 border-b border-gray-100">📝 跟进记录</h2>
            
            {/* 快速新增跟进记录表单 */}
            <form action={addFollowUp} className="p-6 border-b border-gray-100 bg-gray-50/50">
              <input type="hidden" name="companyId" value={company.id} />
              <div className="flex gap-4 mb-3">
                <select 
                  name="type" 
                  defaultValue="NOTE" 
                  className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-semibold text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="NOTE">💡 备注 / 便签</option>
                  <option value="PHONE">📞 电话跟进</option>
                  <option value="EMAIL">✉️ 邮件联系</option>
                  <option value="WECHAT">💬 微信 / 聊天</option>
                  <option value="MEETING">🤝 面对面会议</option>
                </select>
                <span className="text-xs text-gray-400 self-center">记录线下跟进或客户口头需求</span>
              </div>
              <div className="flex gap-2">
                <textarea
                  name="content"
                  placeholder="输入沟通记录（如：客户要求在 6 月 15 日前发送样品报价...）"
                  required
                  rows={2}
                  className="flex-1 px-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition self-end h-fit"
                >
                  提交记录
                </button>
              </div>
            </form>

            {company.followUps.length === 0 ? (
              <p className="px-6 py-8 text-center text-gray-400 text-sm">暂无跟进记录</p>
            ) : (
              <ul className="divide-y divide-gray-50 max-h-[320px] overflow-y-auto">
                {company.followUps.map((f) => (
                  <li key={f.id} className="px-6 py-3">
                    <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
                      <span className="font-bold text-gray-500">{f.user?.name || f.user?.email || '系统'} · {f.type}</span>
                      <span>{fmtDate(f.createdAt)}</span>
                    </div>
                    <p className="text-sm text-gray-700">{f.content}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

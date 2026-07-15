import { prisma } from '@/lib/prisma';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { chat, isLLMAvailable } from '@/lib/llm';
import { buildSalesRadar } from '@/lib/sales-radar';
import { buildCustomerHealthRow } from '@/lib/customer-health';
import { can, requirePermission } from '@/lib/permissions';
import { companyIsAccessible } from '@/lib/data-access';
import { writeAuditLog } from '@/lib/audit';

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
  INSTAGRAM: 'Instagram',
};

const TYPE_LABEL: Record<string, string> = {
  INQUIRY: '询盘客户',
  QUOTED: '已报价客户',
  CONTRACT_SENT: '已发合同客户',
  DEAL_WON: '已成交客户',
  NEW: '新客户',
  EXISTING: '已成交/老客户',
  PROSPECT: '潜在客户',
  KEY_ACCOUNT: '老客户/大客户',
  LOST: '流失客户',
};

function fmtDate(d: Date | null | undefined): string {
  if (!d) return '-';
  return new Date(d).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

function maskAccount(value: string | null) {
  if (!value) return '账号未填写';
  const compact = value.replace(/\s+/g, '');
  return `****${compact.slice(-4)}`;
}

async function updateCustomer(formData: FormData) {
  'use server';
  const session = await requirePermission('customers.write');

  const id = String(formData.get('id') || '');
  if (!id) return;
  const existing = await prisma.company.findUnique({ where: { id }, select: { ownerId: true, isPublic: true } });
  if (!existing || !companyIsAccessible(session, existing)) redirect('/customers?error=forbidden');
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
      type: (s('type') as any) || 'INQUIRY',
      country: s('country'),
      industry: s('industry'),
      website: s('website'),
      ownerId: session.role === 'SALES' ? existing.ownerId || session.userId : s('ownerId'),
      priorityScore: Math.max(0, Math.min(100, parseInt(String(formData.get('priorityScore') || '0'), 10) || 0)),
      mainProducts: s('mainProducts'),
      customerProfile: s('customerProfile'),
      painPoints: s('painPoints'),
      competitors: s('competitors'),
      nextAction: s('nextAction'),
      lastProfiledAt: new Date(),
    },
  });
  redirect(`/customers/${id}`);
}

async function addFollowUp(formData: FormData) {
  'use server';
  const session = await requirePermission('customers.write');

  const companyId = String(formData.get('companyId') || '');
  const content = String(formData.get('content') || '').trim();
  const type = String(formData.get('type') || 'NOTE');
  
  if (!companyId || !content) return;

  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { ownerId: true, isPublic: true } });
  if (!company || !companyIsAccessible(session, company)) redirect('/customers?error=forbidden');

  await prisma.followUp.create({
    data: {
      content,
      type,
      companyId,
      userId: session.userId
    }
  });

  redirect(`/customers/${companyId}`);
}

async function createCustomerOrder(formData: FormData) {
  'use server';
  const session = await requirePermission('sales.manage');

  const companyId = String(formData.get('companyId') || '');
  const productName = String(formData.get('productName') || '').trim();
  const quantity = Number(formData.get('quantity'));
  const unitPrice = Number(formData.get('unitPrice'));
  const currency = String(formData.get('currency') || 'USD').toUpperCase();
  const salesStage = String(formData.get('salesStage') || 'QUOTED') as 'QUOTED' | 'CONTRACT_SENT' | 'DEAL_WON';
  const bankAccountId = String(formData.get('bankAccountId') || '') || null;
  const paymentMethod = String(formData.get('paymentMethod') || '') || null;
  const paymentReference = String(formData.get('paymentReference') || '').trim() || null;
  const note = String(formData.get('note') || '').trim() || null;
  if (!companyId || !productName || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) return;
  if (!['USD', 'CNY', 'EUR'].includes(currency) || !['QUOTED', 'CONTRACT_SENT', 'DEAL_WON'].includes(salesStage)) return;

  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company || !companyIsAccessible(session, company)) redirect('/customers?error=forbidden');
  const { ensureCustomerCode } = await import('@/lib/customer-code');
  const customerCode = company.customerCode || await ensureCustomerCode();
  const total = Math.round((quantity * unitPrice + Number.EPSILON) * 100) / 100;
  const opportunityCode = `MAN-${Date.now().toString(36).toUpperCase()}`;
  const oppStage = salesStage === 'DEAL_WON' ? 'CLOSED_WON' : salesStage === 'CONTRACT_SENT' ? 'SPEC_CONFIRMING' : 'QUOTING';
  const currentRank = { INQUIRY: 1, NEW: 1, PROSPECT: 1, QUOTED: 2, CONTRACT_SENT: 3, DEAL_WON: 4, EXISTING: 4, KEY_ACCOUNT: 4, LOST: 99 }[company.type] || 0;
  const desiredRank = { QUOTED: 2, CONTRACT_SENT: 3, DEAL_WON: 4 }[salesStage];
  const companyType = desiredRank > currentRank ? salesStage : company.type;
  const product = await prisma.product.findFirst({
    where: {
      OR: [
        { sku: { equals: productName, mode: 'insensitive' } },
        { name: { equals: productName, mode: 'insensitive' } },
        { enName: { equals: productName, mode: 'insensitive' } },
      ],
    },
  });

  await prisma.$transaction(async (tx) => {
    const opportunity = await tx.opportunity.create({
      data: {
        opportunityCode,
        title: `${productName} - ${company.name}`,
        description: note,
        companyId,
        ownerId: company.ownerId || session.userId,
        productId: product?.id,
        amountUSD: currency === 'USD' ? total : null,
        amountCNY: currency === 'CNY' ? total : null,
        stage: oppStage,
        stageChangedAt: new Date(),
        nextStep: salesStage === 'DEAL_WON' ? '核对收款并安排备货出运' : salesStage === 'CONTRACT_SENT' ? '跟进合同和付款' : '跟进报价反馈',
        lineItems: {
          create: {
            productId: product?.id,
            productName,
            sku: product?.sku,
            quantity,
            unitPrice,
            currency,
            totalAmount: total,
            source: 'MANUAL',
          },
        },
      },
    });
    await tx.opportunityStageHistory.create({
      data: { opportunityId: opportunity.id, toStage: oppStage, amountUSD: currency === 'USD' ? total : null, note: '客户页手工录入订单', changedById: session.userId },
    });
    if (salesStage === 'DEAL_WON') {
      await tx.paymentRecord.create({
        data: {
          companyId,
          opportunityId: opportunity.id,
          bankAccountId,
          amount: total,
          currency,
          status: can(session.role, 'finance.manage') ? 'CONFIRMED' : 'PENDING',
          method: paymentMethod,
          reference: paymentReference,
          paidAt: new Date(),
          source: 'MANUAL',
          note,
        },
      });
    }
    await tx.company.update({
      where: { id: companyId },
      data: {
        customerCode,
        type: companyType,
        mainProducts: !company.mainProducts
          ? productName
          : company.mainProducts.toLowerCase().includes(productName.toLowerCase())
            ? company.mainProducts
            : `${company.mainProducts}\n${productName}`,
      },
    });
  });
  await writeAuditLog(session, {
    action: 'CUSTOMER_ORDER_CREATED', entityType: 'Company', entityId: companyId,
    summary: `录入客户订单 ${productName}`, metadata: { quantity, unitPrice, currency, total, salesStage },
  });
  redirect(`/customers/${companyId}`);
}

async function createCustomerRadarTask(formData: FormData) {
  'use server';
  const session = await requirePermission('sales.manage');

  const companyId = String(formData.get('companyId') || '');
  if (!companyId) return;
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company || !companyIsAccessible(session, company)) redirect('/customers?error=forbidden');

  const ownerId = company.ownerId || session.userId;
  const sourceRef = `RADAR:${companyId}`;
  const exists = await prisma.salesTask.findFirst({
    where: { companyId, status: 'TODO', source: 'SALES_RADAR', sourceRef },
    select: { id: true },
  });
  if (exists) redirect(`/customers/${companyId}`);

  const dueHours = Math.max(2, Math.min(168, parseInt(String(formData.get('dueHours') || '24'), 10) || 24));
  const dueAt = new Date();
  dueAt.setHours(dueAt.getHours() + dueHours);
  const description = String(formData.get('description') || '').trim() || '根据智能销售雷达生成的跟进任务。';
  const priority = String(formData.get('priority') || 'NORMAL') as any;

  await prisma.salesTask.create({
    data: {
      title: String(formData.get('title') || '').trim() || `跟进 ${company.name}`,
      description,
      type: priority === 'URGENT' ? 'RISK_RESCUE' : 'FOLLOW_UP',
      priority,
      dueAt,
      ownerId,
      createdById: session.userId,
      companyId,
      source: 'SALES_RADAR',
      sourceRef,
    },
  });
  await prisma.company.update({ where: { id: companyId }, data: { nextAction: company.nextAction || description } });
  await prisma.notification.create({
    data: {
      userId: ownerId,
      type: 'SYSTEM',
      title: '销售雷达已生成跟进任务',
      body: `${company.name}: ${description}`,
      link: `/customers/${companyId}`,
    },
  });
  redirect(`/customers/${companyId}`);
}

async function createCustomerHealthTask(formData: FormData) {
  'use server';
  const session = await requirePermission('sales.manage');

  const companyId = String(formData.get('companyId') || '');
  if (!companyId) return;
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company || !companyIsAccessible(session, company)) redirect('/customers?error=forbidden');

  const ownerId = company.ownerId || session.userId;
  const sourceRef = `CUSTOMER_HEALTH:${companyId}`;
  const exists = await prisma.salesTask.findFirst({
    where: { companyId, status: 'TODO', source: 'CUSTOMER_HEALTH', sourceRef },
    select: { id: true },
  });
  if (exists) redirect(`/customers/${companyId}`);

  const dueHours = Math.max(2, Math.min(168, parseInt(String(formData.get('dueHours') || '48'), 10) || 48));
  const dueAt = new Date();
  dueAt.setHours(dueAt.getHours() + dueHours);
  const description = String(formData.get('description') || '').trim() || '根据客户五点体检生成的修复任务。';
  const priority = String(formData.get('priority') || 'NORMAL') as any;

  await prisma.salesTask.create({
    data: {
      title: String(formData.get('title') || '').trim() || `修复 ${company.name} 客户体检短板`,
      description,
      type: priority === 'URGENT' ? 'RISK_RESCUE' : 'FOLLOW_UP',
      priority,
      dueAt,
      ownerId,
      createdById: session.userId,
      companyId,
      source: 'CUSTOMER_HEALTH',
      sourceRef,
    },
  });
  await prisma.company.update({ where: { id: companyId }, data: { nextAction: company.nextAction || description } });
  await prisma.notification.create({
    data: {
      userId: ownerId,
      type: 'SYSTEM',
      title: '客户五点体检已生成任务',
      body: `${company.name}: ${description}`,
      link: `/customers/${companyId}`,
    },
  });
  redirect(`/customers/${companyId}`);
}

async function completeCustomerSalesTask(formData: FormData) {
  'use server';
  const session = await requirePermission('sales.manage');

  const id = String(formData.get('id') || '');
  if (!id) return;
  const task = await prisma.salesTask.findUnique({ where: { id } });
  if (!task) return;
  if (session.role === 'SALES' && task.ownerId !== session.userId) return;

  await prisma.salesTask.update({ where: { id }, data: { status: 'DONE', completedAt: new Date() } });
  await prisma.followUp.create({
    data: {
      companyId: task.companyId,
      userId: session.userId,
      type: 'TASK',
      content: `完成销售任务: ${task.title}`,
    },
  });
  redirect(`/customers/${task.companyId}`);
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
负责人: ${company.owner?.name || company.owner?.email || '未分配'}
优先级评分: ${company.priorityScore || 0}/100
主营/关注产品: ${company.mainProducts || '未知'}
客户画像备注: ${company.customerProfile || '无'}
痛点/采购关注点: ${company.painPoints || '未知'}
竞品/竞争对手: ${company.competitors || '未知'}
下一步动作: ${company.nextAction || '未填写'}

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
  const session = await requirePermission('customers.read');
  const role = session.role;

  const id = props.params.id as string;
  const searchParams = props.searchParams || {};
  const highlightedCompletionTaskId = typeof searchParams.completionTask === 'string' ? searchParams.completionTask : '';
  const completionResolved = typeof searchParams.completionResolved === 'string' ? searchParams.completionResolved : '';

  const company = await prisma.company.findUnique({
    where: { id },
    include: {
      owner: true,
      contacts: { orderBy: { createdAt: 'asc' } },
      opportunities: { orderBy: { updatedAt: 'desc' }, include: { product: true, lineItems: true, payments: true } },
      followUps: { orderBy: { createdAt: 'desc' }, take: 20, include: { user: true } },
      inboxMessages: { orderBy: { createdAt: 'desc' }, take: 15 },
      salesTasks: {
        where: { status: 'TODO' },
        orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
        include: { owner: true, opportunity: true },
      },
    },
  });

  if (!company) notFound();
  if (!companyIsAccessible(session, company)) redirect('/customers?error=forbidden');

  const salesUsers = await prisma.user.findMany({
    where: { role: { in: ['SUPER_ADMIN', 'ADMIN', 'SALES'] as any }, isActive: true },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, email: true, name: true },
  });
  const bankAccounts = await prisma.bankAccount.findMany({
    where: { isActive: true },
    orderBy: [{ isDefault: 'desc' }, { label: 'asc' }],
  });

  const aiInsights = await getAICustomerInsights(company);

  const wonAmount = company.opportunities
    .filter((o) => o.stage === 'CLOSED_WON')
    .reduce((s, o) => s + (o.amountUSD || 0), 0);
  const openCount = company.opportunities.filter(
    (o) => o.stage !== 'CLOSED_WON' && o.stage !== 'CLOSED_LOST'
  ).length;
  const salesRadar = buildSalesRadar(company);
  const customerHealth = buildCustomerHealthRow(company);
  const customerHealthPriority = customerHealth.score < 55 || customerHealth.stalledOpportunityCount > 0 || customerHealth.overdueTaskCount > 0 ? 'URGENT' : customerHealth.score < 75 ? 'HIGH' : 'NORMAL';
  const customerHealthDueHours = customerHealthPriority === 'URGENT' ? 24 : customerHealthPriority === 'HIGH' ? 48 : 72;
  const customerHealthDimensions = [
    { label: '资料完整', value: customerHealth.fitScore, detail: '国家/行业/产品/痛点/竞品' },
    { label: '联系人', value: customerHealth.contactScore, detail: '邮箱、电话、多人关系' },
    { label: '互动热度', value: customerHealth.engagementScore, detail: `${customerHealth.daysSinceLastInteraction >= 999 ? '暂无互动' : `${customerHealth.daysSinceLastInteraction} 天未互动`}` },
    { label: '商机推进', value: customerHealth.pipelineScore, detail: `${customerHealth.openOpportunityCount} 个进行中 · ${customerHealth.stalledOpportunityCount} 个停滞` },
    { label: '下一步/负责人', value: customerHealth.ownerScore, detail: customerHealth.noNextAction ? '缺下一步动作' : customerHealth.ownerLabel },
  ];
  const completionEvidenceTasks = company.salesTasks.filter((task) => task.source === 'COMPLETION_EVIDENCE_AUDIT');
  const completionEvidenceEscalated = completionEvidenceTasks.filter((task) => task.escalatedAt).length;
  const completionEvidenceOverdue = completionEvidenceTasks.filter((task) => task.dueAt && task.dueAt.getTime() < Date.now()).length;

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
              <span>⭐ 优先级：{company.priorityScore}/100</span>
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
                <option value="INQUIRY">询盘客户</option>
                <option value="QUOTED">已报价客户</option>
                <option value="CONTRACT_SENT">已发合同客户</option>
                <option value="DEAL_WON">已成交客户</option>
                <option value="KEY_ACCOUNT">老客户/大客户</option>
                <option value="PROSPECT">潜在客户(旧)</option>
                <option value="NEW">新客户(旧)</option>
                <option value="EXISTING">老客户(旧)</option>
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
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">负责人</label>
              <select name="ownerId" defaultValue={company.ownerId || ''} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none bg-white">
                <option value="">未分配</option>
                {salesUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.name || u.email}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">优先级评分(0-100)</label>
              <input name="priorityScore" type="number" min={0} max={100} defaultValue={company.priorityScore || 0} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
            </div>
            <div className="md:col-span-3 border-t border-gray-100 pt-4">
              <h3 className="text-sm font-bold text-gray-800 mb-3">客户画像与竞争情报</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FieldTextArea name="mainProducts" label="主营/关注产品" value={company.mainProducts} placeholder="如: 905nm/1535nm 测距模块、无人机吊舱、手持测距仪" />
                <FieldTextArea name="competitors" label="竞品/竞争对手" value={company.competitors} placeholder="如: 已在对比某品牌,或客户提到的供应商/价格" />
                <FieldTextArea name="painPoints" label="痛点/采购关注点" value={company.painPoints} placeholder="如: 交期、价格、认证、尺寸、功耗、测距精度" />
                <FieldTextArea name="nextAction" label="下一步动作" value={company.nextAction} placeholder="如: 明天发送 PI, 周五跟进样品测试反馈" />
                <div className="md:col-span-2">
                  <FieldTextArea name="customerProfile" label="客户画像备注" value={company.customerProfile} placeholder="如: 系统集成商/贸易商/军警渠道/科研单位,采购决策链和预算情况" />
                </div>
              </div>
            </div>
            <div className="md:col-span-3">
              <button type="submit" className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-6 py-2.5 rounded-lg transition-all">
                保存修改
              </button>
            </div>
          </form>
        </details>
      </div>

      <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-bold text-gray-900">客户五点体检</h2>
            <p className="text-xs text-gray-400 mt-1">把资料、联系人、互动、商机和下一步动作合成一张客户 360 体检卡。</p>
          </div>
          <CustomerHealthBadge score={customerHealth.score} />
        </div>
        <div className="mt-5 grid grid-cols-1 xl:grid-cols-[0.9fr_1.1fr] gap-4">
          <div className="rounded-xl border border-gray-100 bg-slate-50 p-4">
            <div className="text-xs font-bold text-gray-500">系统建议动作</div>
            <div className="mt-2 text-base font-black text-gray-900">{customerHealth.action}</div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-gray-500">
              <span className="rounded bg-white px-2 py-1">短板: {customerHealth.shortfalls.join('、') || '暂无明显短板'}</span>
              <span className="rounded bg-white px-2 py-1">互动间隔 {customerHealth.daysSinceLastInteraction >= 999 ? '-' : customerHealth.daysSinceLastInteraction} 天</span>
              <span className="rounded bg-white px-2 py-1">待办逾期 {customerHealth.overdueTaskCount}</span>
              <span className="rounded bg-white px-2 py-1">{customerHealth.hasRecentInbound ? '近期有客户来信' : '近期无客户来信'}</span>
            </div>
            <form action={createCustomerHealthTask} className="mt-4">
              <input type="hidden" name="companyId" value={company.id} />
              <input type="hidden" name="title" value={`修复 ${company.name} 客户体检短板`} />
              <input type="hidden" name="description" value={customerHealth.action} />
              <input type="hidden" name="priority" value={customerHealthPriority} />
              <input type="hidden" name="dueHours" value={customerHealthDueHours} />
              <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700">
                生成体检修复任务
              </button>
            </form>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            {customerHealthDimensions.map((item) => (
              <CustomerHealthDimension key={item.label} label={item.label} value={item.value} detail={item.detail} />
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-gray-900">客户画像与竞争情报</h2>
          <span className="text-xs text-gray-400">最近更新:{company.lastProfiledAt ? fmtDate(company.lastProfiledAt) : '未维护'}</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <IntelCard label="优先级" value={`${company.priorityScore}/100`} />
          <IntelCard label="主营/关注产品" value={company.mainProducts || '未填写'} />
          <IntelCard label="竞品/竞争对手" value={company.competitors || '未填写'} />
          <IntelCard label="痛点" value={company.painPoints || '未填写'} />
          <IntelCard label="下一步动作" value={company.nextAction || '未填写'} />
        </div>
        {company.customerProfile && (
          <div className="mt-4 rounded-xl border border-gray-100 bg-slate-50 p-4 text-sm text-gray-700 whitespace-pre-wrap">
            {company.customerProfile}
          </div>
        )}
      </section>

      <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-bold text-gray-900">智能销售雷达</h2>
            <p className="text-xs text-gray-400 mt-1">综合客户阶段、往来消息、商机停留、负责人和下一步动作生成销售优先级</p>
          </div>
          <RadarBadge level={salesRadar.level} label={salesRadar.levelLabel} score={salesRadar.score} />
        </div>
        <div className="mt-5 grid grid-cols-1 lg:grid-cols-[0.85fr_1.15fr] gap-4">
          <div className="rounded-xl border border-gray-100 bg-slate-50 p-4">
            <div className="text-xs font-bold text-gray-500">系统判定</div>
            <div className="mt-1 text-lg font-black text-gray-900">{salesRadar.title}</div>
            <div className="mt-3 text-sm leading-relaxed text-gray-700">{salesRadar.recommendedAction}</div>
            <form action={createCustomerRadarTask} className="mt-4">
              <input type="hidden" name="companyId" value={company.id} />
              <input type="hidden" name="title" value={`跟进 ${company.name}`} />
              <input type="hidden" name="description" value={salesRadar.recommendedAction} />
              <input type="hidden" name="priority" value={salesRadar.level === 'hot' || salesRadar.level === 'risk' ? 'URGENT' : salesRadar.level === 'warm' ? 'HIGH' : 'NORMAL'} />
              <input type="hidden" name="dueHours" value={salesRadar.level === 'hot' || salesRadar.level === 'risk' || salesRadar.metrics.awaitingReply ? 24 : 72} />
              <button className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-500">
                生成跟进任务
              </button>
            </form>
          </div>
          <div className="rounded-xl border border-gray-100 bg-slate-50 p-4">
            <div className="text-xs font-bold text-gray-500">判定依据</div>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
              {salesRadar.reasons.map((reason) => (
                <div key={reason} className="rounded-lg bg-white px-3 py-2 text-sm text-gray-700">{reason}</div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold text-gray-500">
              <span className="rounded bg-white px-2 py-1">互动间隔 {salesRadar.metrics.daysSinceLastInteraction ?? '-'} 天</span>
              <span className="rounded bg-white px-2 py-1">进行中商机 {salesRadar.metrics.openOpportunityCount}</span>
              <span className="rounded bg-white px-2 py-1">超期商机 {salesRadar.metrics.stalledOpportunityCount}</span>
              <span className="rounded bg-white px-2 py-1">{salesRadar.metrics.awaitingReply ? '客户等回复' : '回复节奏正常'}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-bold text-gray-900">销售任务</h2>
          <span className="text-xs font-bold text-gray-400">{company.salesTasks.length} 个待办</span>
        </div>
        {company.salesTasks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center text-sm text-gray-400">暂无待办任务,可从智能销售雷达生成。</div>
        ) : (
          <div className="space-y-3">
            {company.salesTasks.map((task) => (
              <div key={task.id} className="rounded-xl border border-gray-100 bg-slate-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-bold text-gray-900">{task.title}</div>
                    <div className="mt-1 text-xs text-gray-500">{task.description || '-'}</div>
                    <div className="mt-2 text-xs text-gray-400">
                      负责人:{task.owner.name || task.owner.email} · 截止:{task.dueAt ? fmtDate(task.dueAt) : '-'}
                      {task.opportunity ? ` · 商机:${task.opportunity.title}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <TaskPriority priority={task.priority} />
                    <form action={completeCustomerSalesTask}>
                      <input type="hidden" name="id" value={task.id} />
                      <button className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100">完成</button>
                    </form>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section id="completion-evidence-workbench" className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6 scroll-mt-24">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-bold text-gray-900">补证据处理台</h2>
            <p className="mt-1 text-xs text-gray-400">处理“已完成但缺业务结果”的任务,补客户回复、出站消息或商机推进证据后自动关闭补证据任务。</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-black">
            <span className="rounded-lg bg-slate-100 px-3 py-2 text-slate-700">待补 {completionEvidenceTasks.length}</span>
            <span className="rounded-lg bg-rose-50 px-3 py-2 text-rose-700">已升级 {completionEvidenceEscalated}</span>
            <span className="rounded-lg bg-amber-50 px-3 py-2 text-amber-700">已逾期 {completionEvidenceOverdue}</span>
          </div>
        </div>
        {completionResolved && (
          <div className={`mt-4 rounded-xl border px-4 py-3 text-sm font-bold ${
            completionResolved === 'done'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : completionResolved === 'forbidden'
              ? 'border-rose-200 bg-rose-50 text-rose-700'
              : 'border-amber-200 bg-amber-50 text-amber-700'
          }`}>
            {completionResolved === 'done' ? '已补充完成证据并关闭任务。' : completionResolved === 'forbidden' ? '当前账号不能处理这条补证据任务。' : '补证据失败,请确认任务仍然待处理且证据内容不为空。'}
          </div>
        )}
        {completionEvidenceTasks.length === 0 ? (
          <div className="mt-5 rounded-xl border border-dashed border-gray-200 p-8 text-center text-sm text-gray-400">暂无待补证据任务。</div>
        ) : (
          <div className="mt-5 space-y-4">
            {completionEvidenceTasks.map((task) => {
              const isFocused = task.id === highlightedCompletionTaskId;
              const originalTaskId = task.sourceRef?.startsWith('completion-evidence:') ? task.sourceRef.slice('completion-evidence:'.length) : '';
              return (
                <div key={task.id} className={`rounded-xl border p-4 ${isFocused ? 'border-rose-200 bg-rose-50/50' : 'border-gray-100 bg-slate-50'}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-black text-gray-900">{task.title}</div>
                      <div className="mt-1 text-xs leading-relaxed text-gray-500">{task.description || '系统要求补齐该完成任务的业务证据。'}</div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold text-gray-400">
                        <span>负责人:{task.owner.name || task.owner.email}</span>
                        <span>截止:{task.dueAt ? fmtDate(task.dueAt) : '-'}</span>
                        {task.escalatedAt && <span className="text-rose-600">升级:{fmtDate(task.escalatedAt)}</span>}
                        {originalTaskId && <span>原任务:{originalTaskId}</span>}
                      </div>
                    </div>
                    <TaskPriority priority={task.escalatedAt ? 'URGENT' : task.priority} />
                  </div>
                  <form action="/api/customers/completion-evidence/resolve" method="post" className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[180px_1fr_auto]">
                    <input type="hidden" name="taskId" value={task.id} />
                    <select name="evidenceType" defaultValue="CUSTOMER_REPLY" className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-700 focus:border-indigo-500 focus:outline-none">
                      <option value="CUSTOMER_REPLY">客户回复</option>
                      <option value="OUTBOUND_MESSAGE">出站消息</option>
                      <option value="OPPORTUNITY_PROGRESS">商机推进</option>
                      <option value="CALL_NOTE">电话证据</option>
                      <option value="OTHER">其他证据</option>
                    </select>
                    <textarea
                      name="content"
                      rows={2}
                      required
                      minLength={6}
                      placeholder="填写真实证据,例如: 已向客户发送报价单并收到确认; 客户要求补发 1535nm 模块规格; 商机阶段已推进到规格确认。"
                      className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                    />
                    <button className="rounded-xl bg-rose-600 px-5 py-2 text-sm font-black text-white hover:bg-rose-500">补证据并完成</button>
                  </form>
                </div>
              );
            })}
          </div>
        )}
      </section>

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
          <section className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-800">🧾 快速录入报价 / 合同 / 成交订单</h2>
              <p className="text-xs text-gray-400 mt-1">输入产品、单价和数量，系统自动计算金额、建商机并更新客户阶段；成交时同时登记收款。</p>
            </div>
            <form action={createCustomerOrder} data-testid="quick-order-form" className="p-6 grid grid-cols-1 md:grid-cols-4 gap-4">
              <input type="hidden" name="companyId" value={company.id} />
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-gray-500 mb-1">产品名称 / SKU *</label>
                <input name="productName" data-testid="quick-order-product" required placeholder="可直接输入或使用系统语音输入" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">单价 *</label>
                <input name="unitPrice" data-testid="quick-order-unit-price" type="number" min="0" step="0.01" required className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">数量 *</label>
                <input name="quantity" data-testid="quick-order-quantity" type="number" min="0.01" step="0.01" defaultValue="1" required className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">币种</label>
                <select name="currency" data-testid="quick-order-currency" defaultValue="USD" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                  <option value="USD">USD 美元</option><option value="CNY">CNY 人民币</option><option value="EUR">EUR 欧元</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">业务阶段</label>
                <select name="salesStage" data-testid="quick-order-stage" defaultValue="QUOTED" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                  <option value="QUOTED">已提交报价</option><option value="CONTRACT_SENT">已签/已发合同</option><option value="DEAL_WON">已成交并确认付款</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">收款银行账号</label>
                <select name="bankAccountId" data-testid="quick-order-bank" defaultValue={bankAccounts.find((item) => item.isDefault)?.id || ''} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                  <option value="">未指定</option>
                  {bankAccounts.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.currency} · {maskAccount(item.accountNo)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">付款方式</label>
                <select name="paymentMethod" data-testid="quick-order-payment-method" defaultValue="BANK_TRANSFER" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                  <option value="BANK_TRANSFER">银行转账</option><option value="PAYPAL">PayPal</option><option value="CARD">银行卡</option><option value="LETTER_OF_CREDIT">信用证</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-gray-500 mb-1">付款参考号</label>
                <input name="paymentReference" data-testid="quick-order-payment-reference" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-gray-500 mb-1">备注</label>
                <input name="note" data-testid="quick-order-note" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="md:col-span-4">
                <button data-testid="quick-order-submit" className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-6 py-2.5 rounded-lg">保存并自动更新客户阶段</button>
              </div>
            </form>
          </section>

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
                        {op.opportunityCode || op.id.slice(0, 8)} · {op.lineItems[0]?.productName || op.product?.name || '未关联产品'} · {op.lineItems.length || 0} 个明细 · {op.payments.length ? '已登记付款' : '未登记付款'} · 更新 {fmtDate(op.updatedAt)}
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

function FieldTextArea({ name, label, value, placeholder }: { name: string; label: string; value?: string | null; placeholder?: string }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-gray-500 mb-1">{label}</span>
      <textarea
        name={name}
        defaultValue={value || ''}
        placeholder={placeholder}
        rows={3}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
      />
    </label>
  );
}

function IntelCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-slate-50 p-4">
      <div className="text-xs font-bold text-gray-500 mb-1">{label}</div>
      <div className="text-sm font-semibold text-gray-800 whitespace-pre-wrap">{value}</div>
    </div>
  );
}

function RadarBadge({ level, label, score }: { level: string; label: string; score: number }) {
  const style: Record<string, string> = {
    hot: 'border-rose-200 bg-rose-50 text-rose-700',
    risk: 'border-amber-200 bg-amber-50 text-amber-700',
    warm: 'border-blue-200 bg-blue-50 text-blue-700',
    normal: 'border-slate-200 bg-slate-50 text-slate-700',
  };
  return (
    <div className={`rounded-xl border px-5 py-3 text-center ${style[level] || style.normal}`}>
      <div className="text-2xl font-black">{score}</div>
      <div className="mt-1 text-xs font-bold">{label}</div>
    </div>
  );
}

function CustomerHealthBadge({ score }: { score: number }) {
  const style = score >= 75 ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : score >= 55 ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-rose-200 bg-rose-50 text-rose-700';
  const label = score >= 75 ? '健康' : score >= 55 ? '需补强' : '高风险';
  return (
    <div className={`rounded-xl border px-5 py-3 text-center ${style}`}>
      <div className="text-2xl font-black">{score}</div>
      <div className="mt-1 text-xs font-bold">{label}</div>
    </div>
  );
}

function CustomerHealthDimension({ label, value, detail }: { label: string; value: number; detail: string }) {
  const width = Math.max(3, Math.round((value / 20) * 100));
  const bar = value >= 14 ? 'bg-emerald-500' : value >= 10 ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <div className="rounded-xl border border-gray-100 bg-slate-50 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="truncate text-xs font-black text-gray-700">{label}</div>
        <div className="text-xs font-black text-gray-900">{value}/20</div>
      </div>
      <div className="mt-3 h-2 rounded-full bg-white">
        <div className={`h-2 rounded-full ${bar}`} style={{ width: `${width}%` }} />
      </div>
      <div className="mt-2 text-[11px] font-bold text-gray-400">{detail}</div>
    </div>
  );
}

function TaskPriority({ priority }: { priority: string }) {
  const style: Record<string, string> = {
    URGENT: 'bg-rose-50 text-rose-700 border-rose-100',
    HIGH: 'bg-amber-50 text-amber-700 border-amber-100',
    NORMAL: 'bg-blue-50 text-blue-700 border-blue-100',
    LOW: 'bg-slate-50 text-slate-600 border-slate-100',
  };
  const label: Record<string, string> = {
    URGENT: '紧急',
    HIGH: '高',
    NORMAL: '普通',
    LOW: '低',
  };
  return <span className={`rounded-full border px-2 py-1 text-xs font-bold ${style[priority] || style.NORMAL}`}>{label[priority] || priority}</span>;
}

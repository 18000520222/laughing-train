import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/permissions';
import { isLLMAvailable } from '@/lib/llm';

export const dynamic = 'force-dynamic';

type Status = 'READY' | 'AUTH_REQUIRED' | 'CONFIG_REQUIRED' | 'EMPTY';
type Check = { name: string; status: Status; detail: string; action: string; href: string };

function configured(value: string | null | undefined, minimum = 1) {
  return Boolean(value && value.trim().length >= minimum);
}

export default async function ReadinessPage() {
  await requirePermission('settings.manage');
  const now = new Date();
  const [settings, emailAccounts, socialAccounts, roleRows, counts, forcedPasswordUsers] = await Promise.all([
    prisma.systemSettings.findUnique({ where: { id: 'default' } }),
    prisma.emailAccount.findMany({ where: { isActive: true }, select: { email: true, authType: true, password: true, oauthRefreshToken: true, lastSuccessAt: true, lastError: true } }),
    prisma.socialAccount.findMany({ select: { platform: true, expiresAt: true } }),
    prisma.user.groupBy({ by: ['role'], where: { isActive: true }, _count: { _all: true } }),
    Promise.all([
      prisma.company.count(), prisma.contact.count(), prisma.opportunity.count(), prisma.product.count({ where: { isActive: true } }),
      prisma.supplier.count(), prisma.purchaseOrder.count(), prisma.bankAccount.count({ where: { isActive: true } }),
      prisma.shipment.count(), prisma.salesTask.count(), prisma.emailMessage.count(), prisma.inboxMessage.count(),
    ]),
    prisma.user.count({ where: { isActive: true, mustChangePassword: true } }),
  ]);

  const gmailAuthorized = emailAccounts.some((account) => configured(account.oauthRefreshToken) || configured(account.password));
  const facebookAuthorized = socialAccounts.some((account) => ['FACEBOOK', 'INSTAGRAM'].includes(account.platform) && (!account.expiresAt || account.expiresAt > now));
  const linkedinAuthorized = socialAccounts.some((account) => account.platform === 'LINKEDIN' && (!account.expiresAt || account.expiresAt > now));
  const checks: Check[] = [
    check('核心会话安全', configured(process.env.AUTH_SECRET, 32), 'CONFIG_REQUIRED', 'AUTH_SECRET 已达到 32 位且会话会实时校验账号状态', '配置服务器环境变量', '/users'),
    check('Gmail 自动同步', gmailAuthorized, configured(settings?.googleClientId || process.env.GOOGLE_CLIENT_ID) ? 'AUTH_REQUIRED' : 'CONFIG_REQUIRED', gmailAuthorized ? `${emailAccounts.length} 个启用邮箱已授权` : '需要 Google OAuth 授权或邮箱应用密码', '连接 Gmail', '/settings/channels'),
    check('邮件定时任务', configured(process.env.CRON_SECRET, 32) || configured(process.env.MAIL_CRON_KEY, 32), 'CONFIG_REQUIRED', '定时拉取、分类、审计和任务节奏使用服务端密钥', '配置定时任务密钥', '/readiness'),
    check('AI 提取与回复草稿', isLLMAvailable(), 'CONFIG_REQUIRED', isLLMAvailable() ? 'LLM 兼容接口已配置' : '未配置 LLM API；邮件仍可同步和规则分类', '配置 LLM API', '/settings'),
    check('Alibaba.com', configured(settings?.alibabaAccessToken), configured(settings?.alibabaAppKey) && configured(settings?.alibabaAppSecret) ? 'AUTH_REQUIRED' : 'CONFIG_REQUIRED', '询盘/站内信接入', '授权 Alibaba', '/settings/channels'),
    check('Amazon SP-API', configured(settings?.amazonRefreshToken), configured(settings?.amazonLwaClientId) && configured(settings?.amazonLwaClientSecret) ? 'AUTH_REQUIRED' : 'CONFIG_REQUIRED', '订单与消息接入', '授权 Amazon', '/settings/channels'),
    check('Shopee', configured(settings?.shopeeAccessToken) && configured(settings?.shopeeRefreshToken), configured(settings?.shopeePartnerId) && configured(settings?.shopeePartnerKey) ? 'AUTH_REQUIRED' : 'CONFIG_REQUIRED', '店铺授权与消息接入', '授权 Shopee', '/settings/channels'),
    check('WhatsApp', configured(settings?.whatsapp360ApiKey) || configured(settings?.whatsappToken), 'AUTH_REQUIRED', '360dialog 或 Meta Cloud API', '连接 WhatsApp', '/settings/channels'),
    check('Facebook / Instagram', facebookAuthorized, configured(settings?.fbAppId) && configured(settings?.fbAppSecret) ? 'AUTH_REQUIRED' : 'CONFIG_REQUIRED', 'Meta Page / Instagram Business', '授权 Meta', '/settings/channels'),
    check('LinkedIn', linkedinAuthorized, configured(settings?.linkedinClientId) && configured(settings?.linkedinClientSecret) ? 'AUTH_REQUIRED' : 'CONFIG_REQUIRED', '账号与 Lead Gen Forms', '授权 LinkedIn', '/settings/channels'),
    check('AfterShip', configured(settings?.aftershipApiKey || process.env.AFTERSHIP_API_KEY), 'AUTH_REQUIRED', '物流查询与状态回传', '配置 AfterShip API', '/settings/channels'),
    check('网站询盘 Webhook', configured(process.env.WEBHOOK_TOKEN, 32), 'CONFIG_REQUIRED', '网站表单自动进入统一收件箱和询盘客户', '配置 Webhook Token', '/readiness'),
    check('SHOPLINE 订单', configured(process.env.SHOPLINE_APP_SECRET, 16), 'CONFIG_REQUIRED', '已付款订单签名校验后自动建成交客户、订单明细和发货草稿', '配置 SHOPLINE Secret', '/readiness'),
    check('渠道 Webhook 安全', configured(process.env.CHANNEL_WEBHOOK_TOKEN, 32) || (configured(process.env.ALIBABA_WEBHOOK_TOKEN, 32) && configured(process.env.SHOPEE_WEBHOOK_TOKEN, 32) && configured(process.env.AFTERSHIP_WEBHOOK_TOKEN, 32)), 'CONFIG_REQUIRED', 'Alibaba、Shopee、AfterShip 回调必须使用独立或统一长密钥', '配置 Webhook 密钥', '/readiness'),
  ];
  const ready = checks.filter((item) => item.status === 'READY').length;
  const authRequired = checks.filter((item) => item.status === 'AUTH_REQUIRED').length;
  const configRequired = checks.filter((item) => item.status === 'CONFIG_REQUIRED').length;
  const [companies, contacts, opportunities, products, suppliers, purchaseOrders, bankAccounts, shipments, tasks, emails, inbox] = counts;
  const adoption = [
    ['客户', companies], ['联系人', contacts], ['商机', opportunities], ['邮件', emails], ['统一消息', inbox], ['产品', products],
    ['供应商', suppliers], ['采购单', purchaseOrders], ['收款账户', bankAccounts], ['发货', shipments], ['任务', tasks],
  ] as const;

  return (
    <main className="min-h-screen bg-slate-50 p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div><p className="text-sm font-black text-slate-500">不显示任何密钥内容</p><h1 className="text-2xl font-black text-slate-950">公司上线检查与授权清单</h1><p className="mt-1 text-sm text-slate-600">代码能力、业务数据和第三方授权分开检查，避免“页面存在但流程没跑”。</p></div>
          <Link href="/settings/channels" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-black text-white">渠道授权</Link>
        </header>

        <section className="grid gap-4 md:grid-cols-4"><Stat label="已就绪" value={ready} tone="green" /><Stat label="只差授权/API" value={authRequired} tone="amber" /><Stat label="还需服务器配置" value={configRequired} tone="red" /><Stat label="待改初始密码员工" value={forcedPasswordUsers} tone={forcedPasswordUsers ? 'amber' : 'green'} /></section>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm"><thead className="bg-slate-100 text-slate-600"><tr><th className="p-4">能力</th><th className="p-4">状态</th><th className="p-4">说明</th><th className="p-4 text-right">下一步</th></tr></thead><tbody>{checks.map((item) => <tr key={item.name} className="border-t border-slate-100"><td className="p-4 font-black text-slate-900">{item.name}</td><td className="p-4"><StatusBadge status={item.status} /></td><td className="p-4 text-slate-600">{item.detail}</td><td className="p-4 text-right"><Link href={item.href} className="font-bold text-indigo-600 hover:underline">{item.action}</Link></td></tr>)}</tbody></table>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-black text-slate-900">业务数据采用情况</h2><p className="text-sm text-slate-500">数量为 0 的模块需要公司录入基础资料或开始执行流程，不代表代码缺失。</p></div><div className="text-xs text-slate-500">岗位：{roleRows.map((row) => `${row.role} ${row._count._all}`).join(' · ')}</div></div>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">{adoption.map(([label, value]) => <div key={label} className={`rounded-lg border p-3 ${value ? 'border-slate-200 bg-slate-50' : 'border-amber-200 bg-amber-50'}`}><p className="text-xs font-bold text-slate-500">{label}</p><p className="mt-1 text-2xl font-black text-slate-900">{value}</p></div>)}</div>
        </section>
      </div>
    </main>
  );
}

function check(name: string, ready: boolean, missingStatus: Exclude<Status, 'READY' | 'EMPTY'>, detail: string, action: string, href: string): Check {
  return { name, status: ready ? 'READY' : missingStatus, detail, action, href };
}

function StatusBadge({ status }: { status: Status }) {
  const map: Record<Status, [string, string]> = { READY: ['已就绪', 'bg-green-50 text-green-700'], AUTH_REQUIRED: ['待授权/API', 'bg-amber-50 text-amber-700'], CONFIG_REQUIRED: ['待服务器配置', 'bg-red-50 text-red-700'], EMPTY: ['待录入数据', 'bg-slate-100 text-slate-600'] };
  return <span className={`rounded-full px-2 py-1 text-xs font-black ${map[status][1]}`}>{map[status][0]}</span>;
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'green' | 'amber' | 'red' }) {
  const colors = { green: 'border-green-200 bg-green-50 text-green-800', amber: 'border-amber-200 bg-amber-50 text-amber-800', red: 'border-red-200 bg-red-50 text-red-800' }[tone];
  return <div className={`rounded-xl border p-5 shadow-sm ${colors}`}><p className="text-sm font-bold">{label}</p><p className="mt-2 text-3xl font-black">{value}</p></div>;
}

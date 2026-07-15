import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requirePermission } from '@/lib/permissions';
import { writeAuditLog } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const SECRET_FIELDS = new Set([
  'whatsappToken',
  'fbAppSecret',
  'linkedinClientSecret',
  'alibabaAppSecret',
  'alibabaAccessToken',
  'alibabaRefreshToken',
  'amazonLwaClientSecret',
  'amazonAwsAccessKeyId',
  'amazonAwsSecretAccessKey',
  'amazonRefreshToken',
  'shopeePartnerKey',
  'shopeeAccessToken',
  'shopeeRefreshToken',
  'aftershipApiKey',
]);


export default async function SettingsPage(props: any) {
  const session = await requirePermission('settings.manage');
  const role = session.role;

  let settings = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
  if (!settings) {
    settings = { id: 'default', usdToCnyRate: 7.2, companyName: 'ERDI TECH LTD', updatedAt: new Date() } as any;
  }

  const emailAccounts = await prisma.emailAccount.findMany();
  const socialAccounts = await prisma.socialAccount.findMany();
  const bankAccounts = await prisma.bankAccount.findMany({ orderBy: [{ isDefault: 'desc' }, { label: 'asc' }] });
  const mailTest = String(props?.searchParams?.mailTest || '');
  const mailTestInfo = String(props?.searchParams?.mailTestInfo || '');

  async function saveSettings(formData: FormData) {
    'use server';
    const actor = await requirePermission('settings.manage');
    const rate = parseFloat(formData.get('usdToCnyRate') as string);
    const companyName = formData.get('companyName') as string;
    const bankFields = {
      bankName: (formData.get('bankName') as string) || null,
      bankSwift: (formData.get('bankSwift') as string) || null,
      bankAccountNo: (formData.get('bankAccountNo') as string) || null,
      bankBeneficiary: (formData.get('bankBeneficiary') as string) || null,
      bankAddress: (formData.get('bankAddress') as string) || null,
    };
    if (rate && companyName) {
      await prisma.systemSettings.upsert({
        where: { id: 'default' },
        update: { usdToCnyRate: rate, companyName: companyName, ...bankFields },
        create: { id: 'default', usdToCnyRate: rate, companyName: companyName, ...bankFields }
      });
      if (bankFields.bankName) {
        const currentDefault = await prisma.bankAccount.findFirst({ where: { isDefault: true } });
        const data = {
          label: bankFields.bankName,
          bankName: bankFields.bankName,
          accountNo: bankFields.bankAccountNo,
          swift: bankFields.bankSwift,
          beneficiary: bankFields.bankBeneficiary,
          bankAddress: bankFields.bankAddress,
          isActive: true,
          isDefault: true,
        };
        if (currentDefault) await prisma.bankAccount.update({ where: { id: currentDefault.id }, data });
        else await prisma.bankAccount.create({ data });
      }
    }
    await writeAuditLog(actor, { action: 'SETTINGS_UPDATED', entityType: 'SystemSettings', entityId: 'default', summary: '更新公司基础设置或收款账户' });
    redirect('/settings');
  }

  async function saveIntegrations(formData: FormData) {
    'use server';
    const actor = await requirePermission('channels.configure');
    const g = (key: string, fallback?: string | null) => {
      const value = String(formData.get(key) || '').trim();
      if (!value) return SECRET_FIELDS.has(key) ? undefined : fallback ?? null;
      return value;
    };
    const rawData: any = {
      whatsappToken: g('whatsappToken'),
      whatsappPhoneId: g('whatsappPhoneId'),
      whatsappVerifyToken: g('whatsappVerifyToken'),
      whatsapp360ApiKey: g('whatsapp360ApiKey'),
      fbAppId: g('fbAppId'),
      fbAppSecret: g('fbAppSecret'),
      fbVerifyToken: g('fbVerifyToken'),
      linkedinClientId: g('linkedinClientId'),
      linkedinClientSecret: g('linkedinClientSecret'),
      aftershipApiKey: g('aftershipApiKey'),
      libretranslateUrl: g('libretranslateUrl', 'https://libretranslate.com'),
      autoReplyMode: g('autoReplyMode', 'DRAFT'),
      aiBusinessInfo: g('aiBusinessInfo'),
      alibabaAppKey: g('alibabaAppKey'),
      alibabaAppSecret: g('alibabaAppSecret'),
      alibabaAccessToken: g('alibabaAccessToken'),
      alibabaRefreshToken: g('alibabaRefreshToken'),
      amazonRefreshToken: g('amazonRefreshToken'),
      amazonLwaClientId: g('amazonLwaClientId'),
      amazonLwaClientSecret: g('amazonLwaClientSecret'),
      amazonAwsAccessKeyId: g('amazonAwsAccessKeyId'),
      amazonAwsSecretAccessKey: g('amazonAwsSecretAccessKey'),
      amazonSellerId: g('amazonSellerId'),
      amazonMarketplaceId: g('amazonMarketplaceId', 'ATVPDKIKX0DER'),
      amazonRegion: g('amazonRegion', 'na'),
      shopeePartnerId: g('shopeePartnerId'),
      shopeePartnerKey: g('shopeePartnerKey'),
      shopeeShopId: g('shopeeShopId'),
      shopeeAccessToken: g('shopeeAccessToken'),
      shopeeRefreshToken: g('shopeeRefreshToken'),
    };
    const data = Object.fromEntries(Object.entries(rawData).filter(([, v]) => v !== undefined));
    await prisma.systemSettings.upsert({
      where: { id: 'default' },
      update: data,
      create: { id: 'default', ...data } as any,
    });
    await writeAuditLog(actor, { action: 'INTEGRATION_SETTINGS_UPDATED', entityType: 'SystemSettings', entityId: 'default', summary: '更新第三方集成配置（不记录密钥值）' });
    redirect('/settings');
  }

  async function updateEmailConfig(formData: FormData) {
    'use server';
    await requirePermission('channels.configure');
    const id = formData.get('id') as string;
    const pwd = String(formData.get('password') || '').trim();
    const host = formData.get('imapHost') as string;
    if (id && host) {
      await prisma.$transaction(async (tx) => {
        await tx.emailAccount.update({
          where: { id },
          data: {
            imapHost: host,
            ...(pwd ? {
              password: pwd,
              authType: 'APP_PASSWORD',
              oauthProvider: null,
              oauthRefreshToken: null,
              oauthAccessToken: null,
              oauthTokenExpiresAt: null,
            } : {}),
          },
        });
        await tx.emailFolderCursor.deleteMany({ where: { accountId: id } });
      });
    }
    redirect('/settings');
  }

  async function addBankAccount(formData: FormData) {
    'use server';
    await requirePermission('finance.manage');
    const label = String(formData.get('label') || '').trim();
    const bankName = String(formData.get('bankName') || '').trim();
    if (!label || !bankName) return;
    const isDefault = formData.get('isDefault') === '1';
    await prisma.$transaction(async (tx) => {
      if (isDefault) await tx.bankAccount.updateMany({ data: { isDefault: false } });
      await tx.bankAccount.create({
        data: {
          label,
          bankName,
          currency: String(formData.get('currency') || 'USD').toUpperCase(),
          accountNo: String(formData.get('accountNo') || '').trim() || null,
          swift: String(formData.get('swift') || '').trim() || null,
          beneficiary: String(formData.get('beneficiary') || '').trim() || null,
          bankAddress: String(formData.get('bankAddress') || '').trim() || null,
          isDefault,
        },
      });
    });
    redirect('/settings');
  }

  async function testEmailConnection(formData: FormData) {
    'use server';
    await requirePermission('channels.configure');
    const id = String(formData.get('id') || '');
    const { testEmailAccountConnection } = await import('@/lib/email-sync');
    const result = await testEmailAccountConnection(id);
    const info = result.ok
      ? `${result.latencyMs}ms; Sent=${result.sentMailbox || '未找到'}`
      : String(result.error || '连接失败').slice(0, 160);
    redirect(`/settings?mailTest=${result.ok ? 'ok' : 'fail'}&mailTestInfo=${encodeURIComponent(info)}`);
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* 基本设置 */}
        <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200">
          <div className="flex justify-between items-center mb-8 pb-4 border-b border-gray-100">
            <h1 className="text-2xl font-bold text-gray-800">⚙️ 系统基础配置</h1>
            <Link href="/dashboard" className="text-blue-600 hover:underline font-medium">返回看板</Link>
          </div>
          <form action={saveSettings} className="space-y-6">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">美元兑人民币汇率</label>
                <input type="number" step="0.0001" name="usdToCnyRate" defaultValue={settings?.usdToCnyRate} required className="w-full border border-gray-300 rounded-lg p-3 outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">公司主体名称</label>
                <input type="text" name="companyName" defaultValue={settings?.companyName} required className="w-full border border-gray-300 rounded-lg p-3 outline-none focus:border-blue-500" />
              </div>
            </div>
            <div className="pt-4 border-t border-gray-100">
              <h2 className="text-base font-bold text-gray-800 mb-1">🏦 收款银行信息（用于 PI / 形式发票）</h2>
              <p className="text-xs text-gray-500 mb-4">填写后将自动显示在所有 PI 单据的 BANKING DETAILS 区域。</p>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">开户行名称 (Bank Name)</label>
                  <input type="text" name="bankName" defaultValue={(settings as any)?.bankName || ''} className="w-full border border-gray-300 rounded-lg p-3 outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">SWIFT / BIC 代码</label>
                  <input type="text" name="bankSwift" defaultValue={(settings as any)?.bankSwift || ''} className="w-full border border-gray-300 rounded-lg p-3 outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">收款账号 (A/C No.)</label>
                  <input type="text" name="bankAccountNo" defaultValue={(settings as any)?.bankAccountNo || ''} className="w-full border border-gray-300 rounded-lg p-3 outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">收款人 (Beneficiary)</label>
                  <input type="text" name="bankBeneficiary" defaultValue={(settings as any)?.bankBeneficiary || 'ERDI TECH LTD'} className="w-full border border-gray-300 rounded-lg p-3 outline-none focus:border-blue-500" />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-semibold text-gray-700 mb-2">开户行地址 (可选)</label>
                  <input type="text" name="bankAddress" defaultValue={(settings as any)?.bankAddress || ''} className="w-full border border-gray-300 rounded-lg p-3 outline-none focus:border-blue-500" />
                </div>
              </div>
            </div>
            <button type="submit" className="bg-gray-900 text-white px-6 py-3 rounded-lg font-bold hover:bg-gray-800">保存系统设置</button>
          </form>
        </div>

        <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200">
          <div className="mb-6 pb-4 border-b border-gray-100">
            <h2 className="text-xl font-bold text-gray-800">🏦 多收款账户</h2>
            <p className="text-sm text-gray-500 mt-1">订单付款可选择具体收款账户；列表仅显示账号尾号。</p>
          </div>
          <div className="space-y-2 mb-6">
            {bankAccounts.map((account) => (
              <div key={account.id} className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3 text-sm">
                <span className="font-semibold text-gray-800">{account.label} {account.isDefault ? '· 默认' : ''}</span>
                <span className="text-gray-500">{account.currency} · {account.bankName} · {maskBankAccount(account.accountNo)}</span>
              </div>
            ))}
            {bankAccounts.length === 0 && <p className="text-sm text-gray-400">尚未建立结构化收款账户；保存上方银行信息后会自动建立默认账户。</p>}
          </div>
          {(role === 'SUPER_ADMIN' || role === 'ADMIN') && (
            <form action={addBankAccount} className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field name="label" label="账户简称 *" />
              <Field name="bankName" label="银行名称 *" />
              <div><label className="block text-xs font-semibold text-gray-700 mb-1">币种</label><select name="currency" className="w-full border border-gray-300 rounded-lg p-2.5 text-sm bg-white"><option>USD</option><option>CNY</option><option>EUR</option></select></div>
              <Field name="accountNo" label="收款账号" />
              <Field name="swift" label="SWIFT / BIC" />
              <Field name="beneficiary" label="收款人" def="ERDI TECH LTD" />
              <div className="md:col-span-2"><Field name="bankAddress" label="银行地址" /></div>
              <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" name="isDefault" value="1" />设为默认账户</label>
              <div className="md:col-span-3"><button className="bg-gray-900 text-white px-5 py-2.5 rounded-lg font-bold">新增收款账户</button></div>
            </form>
          )}
        </div>

        {/* 第三方集成 */}
        <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200">
          <div className="mb-6 pb-4 border-b border-gray-100">
            <h2 className="text-xl font-bold text-gray-800">🔌 第三方平台集成 Token</h2>
            <p className="text-sm text-gray-500 mt-1">配置后，对应模块（WhatsApp / Facebook / LinkedIn / AfterShip 物流）自动启用。</p>
          </div>
          <form action={saveIntegrations} className="space-y-8">
            <Section title="📱 WhatsApp（二选一：360dialog BSP 或 Meta 原生）">
              <div className="rounded-lg border border-green-300 bg-green-50 p-3 mb-3">
                <p className="text-sm font-semibold text-green-800">✅ 推荐：360dialog (BSP)</p>
                <p className="text-xs text-green-700 mt-1 leading-snug">
                  在 360dialog Hub 完成 Embedded Signup 后会拿到一个 API Key，填入下方即可。
                  填了这个 Key，系统会自动走 360dialog 网关，<b>无需</b>再填下面的 Meta Phone ID / Token。
                  <br />Webhook 在 360dialog Hub 里设为：<code>https://erdicrm.com/api/whatsapp/webhook</code>
                </p>
              </div>
              <Field name="whatsapp360ApiKey" label="360dialog API Key" def={(settings as any)?.whatsapp360ApiKey} type="password" />

              <div className="border-t border-gray-200 my-4" />
              <p className="text-xs text-gray-500 mb-2">
                — 或 — 原生 Meta Cloud API（业务组合未被封时用；当前你的 ERDI 组合已被封，建议走上面的 360dialog）
                <br />Webhook URL：<code>https://erdicrm.com/api/whatsapp/webhook</code>（Verify Token 与下方一致）
              </p>
              <Field name="whatsappPhoneId" label="Phone Number ID" def={(settings as any)?.whatsappPhoneId} />
              <Field name="whatsappToken" label="Permanent Access Token" def={(settings as any)?.whatsappToken} type="password" />
              <Field name="whatsappVerifyToken" label="Webhook Verify Token (自定义任意字符串)" def={(settings as any)?.whatsappVerifyToken || 'erdi-verify-2026'} />
            </Section>

            <Section title="📘 Facebook (Page Messenger / OAuth)">
              <p className="text-xs text-gray-500 -mt-2 mb-3">
                配置后访问 <Link href="/api/auth/facebook/start" className="text-blue-600 underline">/api/auth/facebook/start</Link> 授权 Page。Webhook：<code>/api/facebook/webhook</code>
              </p>
              <Field name="fbAppId" label="App ID" def={(settings as any)?.fbAppId} />
              <Field name="fbAppSecret" label="App Secret" def={(settings as any)?.fbAppSecret} type="password" />
              <Field name="fbVerifyToken" label="Webhook Verify Token" def={(settings as any)?.fbVerifyToken || 'erdi-fb-verify'} />
            </Section>

            <Section title="👔 LinkedIn (OAuth + Lead Gen)">
              <p className="text-xs text-gray-500 -mt-2 mb-3">
                Redirect URL：<code>https://erdicrm.com/api/auth/linkedin/callback</code> ·
                授权入口：<Link href="/api/auth/linkedin/start" className="text-blue-600 underline">/api/auth/linkedin/start</Link>
              </p>
              <Field name="linkedinClientId" label="Client ID" def={(settings as any)?.linkedinClientId} />
              <Field name="linkedinClientSecret" label="Client Secret" def={(settings as any)?.linkedinClientSecret} type="password" />
            </Section>

            <Section title="🟠 阿里巴巴国际站 (Alibaba.com 开放平台)">
              <p className="text-xs text-gray-500 -mt-2 mb-3">
                在阿里开放平台控制台创建应用并授权后填入。需金品诚企(Gold Supplier)资质。询盘/消息将自动汇入统一收件箱。
              </p>
              <Field name="alibabaAppKey" label="App Key" def={(settings as any)?.alibabaAppKey} />
              <Field name="alibabaAppSecret" label="App Secret" def={(settings as any)?.alibabaAppSecret} type="password" />
              <Field name="alibabaAccessToken" label="Access Token" def={(settings as any)?.alibabaAccessToken} type="password" />
              <Field name="alibabaRefreshToken" label="Refresh Token" def={(settings as any)?.alibabaRefreshToken} type="password" />
            </Section>

            <Section title="📦 亚马逊 SP-API (Selling Partner)">
              <p className="text-xs text-gray-500 -mt-2 mb-3">
                在 Seller Central → 开发者中心创建应用,LWA 授权后填入。买家消息/订单将轮询汇入统一收件箱。
              </p>
              <Field name="amazonLwaClientId" label="LWA Client ID" def={(settings as any)?.amazonLwaClientId} />
              <Field name="amazonLwaClientSecret" label="LWA Client Secret" def={(settings as any)?.amazonLwaClientSecret} type="password" />
              <Field name="amazonAwsAccessKeyId" label="AWS Access Key ID (SP-API SigV4)" def={(settings as any)?.amazonAwsAccessKeyId} type="password" />
              <Field name="amazonAwsSecretAccessKey" label="AWS Secret Access Key (SP-API SigV4)" def={(settings as any)?.amazonAwsSecretAccessKey} type="password" />
              <Field name="amazonRefreshToken" label="Refresh Token" def={(settings as any)?.amazonRefreshToken} type="password" />
              <Field name="amazonSellerId" label="Seller ID (可选)" def={(settings as any)?.amazonSellerId} />
              <Field name="amazonMarketplaceId" label="Marketplace ID (默认美国 ATVPDKIKX0DER)" def={(settings as any)?.amazonMarketplaceId || 'ATVPDKIKX0DER'} />
              <Field name="amazonRegion" label="Region (na / eu / fe)" def={(settings as any)?.amazonRegion || 'na'} />
            </Section>

            <Section title="🛍️ 虾皮 Shopee (Open Platform)">
              <p className="text-xs text-gray-500 -mt-2 mb-3">
                在 Shopee 开放平台创建应用并授权店铺后填入。聊天消息将通过 webhook 汇入统一收件箱。Push URL:<code>https://erdicrm.com/api/shopee/webhook</code>
              </p>
              <Field name="shopeePartnerId" label="Partner ID" def={(settings as any)?.shopeePartnerId} />
              <Field name="shopeePartnerKey" label="Partner Key" def={(settings as any)?.shopeePartnerKey} type="password" />
              <Field name="shopeeShopId" label="Shop ID" def={(settings as any)?.shopeeShopId} />
              <Field name="shopeeAccessToken" label="Access Token" def={(settings as any)?.shopeeAccessToken} type="password" />
              <Field name="shopeeRefreshToken" label="Refresh Token" def={(settings as any)?.shopeeRefreshToken} type="password" />
            </Section>

            <Section title="🚚 AfterShip 物流追踪">
              <Field name="aftershipApiKey" label="AfterShip API Key" def={(settings as any)?.aftershipApiKey} type="password" />
              <p className="text-xs text-gray-500">配置后，访问 <code>/api/tracking/sync</code> 手动同步，或绑定 Vercel Cron 每天自动同步。</p>
            </Section>

            <Section title="🤖 AI 智能客服 / 实时翻译">
              <p className="text-xs text-gray-500 -mt-2 mb-3">
                全渠道（WhatsApp / 阿里 / 亚马逊 / 虾皮 / Facebook / 邮件）入站消息自动翻译为中文，并由 AI 生成回复。配置后即时生效。
                <span className="text-green-600 font-medium"> 当前翻译引擎已升级为 LLM（外贸语境最佳）。</span>
              </p>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-2">自动回复模式</label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <RadioCard name="autoReplyMode" value="OFF" current={(settings as any)?.autoReplyMode || 'DRAFT'}
                    title="🚫 关闭" desc="只翻译，不生成 AI 回复" />
                  <RadioCard name="autoReplyMode" value="DRAFT" current={(settings as any)?.autoReplyMode || 'DRAFT'}
                    title="✍️ 草稿（推荐）" desc="AI 生成回复草稿，业务员审阅后手动发送" />
                  <RadioCard name="autoReplyMode" value="AUTO" current={(settings as any)?.autoReplyMode || 'DRAFT'}
                    title="⚡ 全自动" desc="低风险问题 AI 直接回复客户；报价/交期/投诉仍转人工" />
                </div>
              </div>
              <div className="mt-2">
                <label className="block text-xs font-semibold text-gray-700 mb-1">业务背景 / 话术（喂给 AI，让回复更贴合你的产品）</label>
                <textarea
                  name="aiBusinessInfo"
                  defaultValue={(settings as any)?.aiBusinessInfo || ''}
                  rows={6}
                  placeholder={"例如：\nERDI TECH LTD 是激光测距模块/激光目标指示器/光电模块的中国制造商。\n主营产品：LR系列激光测距模块（量程 20m-20km）、激光指示器。\n回复口径：交期 15-30 天；MOQ 可议；样品支持；不在聊天中直接报价，引导客户提供型号/数量后由专人报价。\n语气：专业、礼貌、简洁。"}
                  className="w-full border border-gray-300 rounded-lg p-3 text-sm outline-none focus:border-blue-500 font-mono leading-relaxed"
                />
                <p className="text-xs text-gray-500 mt-1">建议写清：公司简介、主营产品线、报价/交期/MOQ 口径、希望的回复语气。AI 会据此起草更准确的回复，且不会编造价格数字。</p>
              </div>
            </Section>

            <Section title="🌐 翻译引擎降级 (LibreTranslate)">
              <Field name="libretranslateUrl" label="服务地址" def={(settings as any)?.libretranslateUrl || 'https://libretranslate.com'} />
              <p className="text-xs text-gray-500">仅当 LLM 不可用时作为降级翻译。默认公共实例（可能限流），建议自部署后填 https 地址。</p>
            </Section>

            <button type="submit" className="bg-gray-900 text-white px-6 py-3 rounded-lg font-bold hover:bg-gray-800">保存所有 API Key</button>
          </form>

          {socialAccounts.length > 0 && (
            <div className="mt-8 pt-6 border-t">
              <h3 className="font-semibold text-gray-800 mb-3">已授权账号</h3>
              <div className="space-y-2">
                {socialAccounts.map(s => (
                  <div key={s.id} className="flex justify-between items-center bg-gray-50 px-4 py-2 rounded">
                    <span className="text-sm">{s.platform === 'FACEBOOK' ? '📘' : '👔'} {s.name || s.externalId}</span>
                    <span className="text-xs text-gray-500">{s.platform}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 邮箱配置 */}
        <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200">
          <div className="mb-6 pb-4 border-b border-gray-100">
            <h2 className="text-xl font-bold text-gray-800">🔐 聚合邮箱安全配置 (IMAP)</h2>
            <p className="text-sm text-gray-500 mt-1">填入应用专用密码 / IMAP 授权码（非登录密码）。</p>
          </div>
          {mailTest && (
            <div className={`mb-5 rounded-lg border px-4 py-3 text-sm ${mailTest === 'ok' ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
              {mailTest === 'ok' ? 'IMAP 连接测试成功' : 'IMAP 连接测试失败'} · {mailTestInfo}
            </div>
          )}
          <div className="space-y-6">
            {emailAccounts.map(acc => (
              <div key={acc.id} className="bg-gray-50 p-6 rounded-lg border border-gray-100">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-gray-800 text-lg">{acc.email}</h3>
                  <span className={`text-xs px-2 py-1 rounded ${acc.password || acc.oauthRefreshToken ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {acc.oauthRefreshToken ? '✅ Google OAuth' : acc.password ? '✅ IMAP 已配置' : '❌ 未配置'}
                  </span>
                </div>
                <div className="mb-4 text-xs text-gray-500">
                  最近成功：{acc.lastSuccessAt ? new Date(acc.lastSuccessAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '从未成功'}
                  {acc.lastError ? <span className="ml-3 text-red-600">最近错误：{acc.lastError.slice(0, 180)}</span> : null}
                </div>
                <form action={updateEmailConfig} className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <input type="hidden" name="id" value={acc.id} />
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">IMAP 服务器</label>
                    <input type="text" name="imapHost" defaultValue={acc.imapHost} required className="w-full border border-gray-300 rounded-lg p-2.5 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">授权码</label>
                    <input type="password" name="password" placeholder={acc.password ? "******** (留空保持)" : "请输入"} className="w-full border border-gray-300 rounded-lg p-2.5 text-sm" />
                  </div>
                  <div className="md:col-span-2"><button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium text-sm hover:bg-blue-700">更新配置</button></div>
                </form>
                {(role === 'SUPER_ADMIN' || role === 'ADMIN') && (
                  <form action={testEmailConnection}>
                    <input type="hidden" name="id" value={acc.id} />
                    <button className="border border-gray-300 bg-white px-4 py-2 rounded-lg font-medium text-sm hover:bg-gray-100">立即测试 IMAP 与已发送文件夹</button>
                  </form>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function maskBankAccount(value: string | null) {
  if (!value) return '未填写账号';
  const compact = value.replace(/\s+/g, '');
  return compact.length <= 4 ? `****${compact}` : `****${compact.slice(-4)}`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-gray-200 rounded-lg p-5 bg-gray-50/50">
      <h3 className="font-bold text-gray-800 mb-4">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function RadioCard({ name, value, current, title, desc }: { name: string; value: string; current: string; title: string; desc: string }) {
  const checked = current === value;
  return (
    <label className={`cursor-pointer block rounded-lg border p-3 transition ${checked ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' : 'border-gray-300 bg-white hover:border-gray-400'}`}>
      <div className="flex items-center gap-2">
        <input type="radio" name={name} value={value} defaultChecked={checked} className="accent-blue-600" />
        <span className="font-semibold text-sm text-gray-800">{title}</span>
      </div>
      <p className="text-xs text-gray-500 mt-1 leading-snug">{desc}</p>
    </label>
  );
}

function Field({ name, label, def, type = 'text' }: { name: string; label: string; def?: any; type?: string }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-700 mb-1">{label}</label>
      <input
        type={type}
        name={name}
        defaultValue={type === 'password' ? '' : def || ''}
        placeholder={def && type === 'password' ? '已配置 (留空保持不变)' : ''}
        className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500"
      />
    </div>
  );
}

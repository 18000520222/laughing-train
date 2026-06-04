import { PrismaClient } from '@prisma/client';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
const prisma = new PrismaClient();

export default async function SettingsPage() {
  const role = cookies().get('auth_role')?.value;
  if (role !== 'SUPER_ADMIN' && role !== 'ADMIN' && role !== 'SALES') {
    redirect('/');
  }

  let settings = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
  if (!settings) {
    settings = { id: 'default', usdToCnyRate: 7.2, companyName: 'ERDI TECH LTD', updatedAt: new Date() } as any;
  }

  const emailAccounts = await prisma.emailAccount.findMany();
  const socialAccounts = await prisma.socialAccount.findMany();

  async function saveSettings(formData: FormData) {
    'use server';
    const r = cookies().get('auth_role')?.value;
    if (r !== 'SUPER_ADMIN' && r !== 'ADMIN' && r !== 'SALES') return;
    const rate = parseFloat(formData.get('usdToCnyRate') as string);
    const companyName = formData.get('companyName') as string;
    if (rate && companyName) {
      await prisma.systemSettings.upsert({
        where: { id: 'default' },
        update: { usdToCnyRate: rate, companyName: companyName },
        create: { id: 'default', usdToCnyRate: rate, companyName: companyName }
      });
    }
    redirect('/settings');
  }

  async function saveIntegrations(formData: FormData) {
    'use server';
    const r = cookies().get('auth_role')?.value;
    if (r !== 'SUPER_ADMIN' && r !== 'ADMIN') return;
    await prisma.systemSettings.upsert({
      where: { id: 'default' },
      update: {
        whatsappToken: (formData.get('whatsappToken') as string) || null,
        whatsappPhoneId: (formData.get('whatsappPhoneId') as string) || null,
        whatsappVerifyToken: (formData.get('whatsappVerifyToken') as string) || null,
        fbAppId: (formData.get('fbAppId') as string) || null,
        fbAppSecret: (formData.get('fbAppSecret') as string) || null,
        fbVerifyToken: (formData.get('fbVerifyToken') as string) || null,
        linkedinClientId: (formData.get('linkedinClientId') as string) || null,
        linkedinClientSecret: (formData.get('linkedinClientSecret') as string) || null,
        aftershipApiKey: (formData.get('aftershipApiKey') as string) || null,
        libretranslateUrl: (formData.get('libretranslateUrl') as string) || 'https://libretranslate.com',
        // 阿里国际站
        alibabaAppKey: (formData.get('alibabaAppKey') as string) || null,
        alibabaAppSecret: (formData.get('alibabaAppSecret') as string) || null,
        alibabaAccessToken: (formData.get('alibabaAccessToken') as string) || null,
        alibabaRefreshToken: (formData.get('alibabaRefreshToken') as string) || null,
        // 亚马逊 SP-API
        amazonRefreshToken: (formData.get('amazonRefreshToken') as string) || null,
        amazonLwaClientId: (formData.get('amazonLwaClientId') as string) || null,
        amazonLwaClientSecret: (formData.get('amazonLwaClientSecret') as string) || null,
        amazonSellerId: (formData.get('amazonSellerId') as string) || null,
        amazonMarketplaceId: (formData.get('amazonMarketplaceId') as string) || 'ATVPDKIKX0DER',
        amazonRegion: (formData.get('amazonRegion') as string) || 'na',
        // 虾皮 Shopee
        shopeePartnerId: (formData.get('shopeePartnerId') as string) || null,
        shopeePartnerKey: (formData.get('shopeePartnerKey') as string) || null,
        shopeeShopId: (formData.get('shopeeShopId') as string) || null,
        shopeeAccessToken: (formData.get('shopeeAccessToken') as string) || null,
        shopeeRefreshToken: (formData.get('shopeeRefreshToken') as string) || null,
      },
      create: { id: 'default' } as any,
    });
    redirect('/settings');
  }

  async function updateEmailConfig(formData: FormData) {
    'use server';
    const r = cookies().get('auth_role')?.value;
    if (r !== 'SUPER_ADMIN' && r !== 'ADMIN') return;
    const id = formData.get('id') as string;
    const pwd = formData.get('password') as string;
    const host = formData.get('imapHost') as string;
    if (id && pwd && host) {
      await prisma.emailAccount.update({ where: { id }, data: { password: pwd, imapHost: host } });
    }
    redirect('/settings');
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
            <button type="submit" className="bg-gray-900 text-white px-6 py-3 rounded-lg font-bold hover:bg-gray-800">保存系统设置</button>
          </form>
        </div>

        {/* 第三方集成 */}
        <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200">
          <div className="mb-6 pb-4 border-b border-gray-100">
            <h2 className="text-xl font-bold text-gray-800">🔌 第三方平台集成 Token</h2>
            <p className="text-sm text-gray-500 mt-1">配置后，对应模块（WhatsApp / Facebook / LinkedIn / AfterShip 物流）自动启用。</p>
          </div>
          <form action={saveIntegrations} className="space-y-8">
            <Section title="📱 WhatsApp Cloud API (Meta)">
              <p className="text-xs text-gray-500 -mt-2 mb-3">
                Webhook URL：<code>https://crm.erdicn.com/api/whatsapp/webhook</code>（在 Meta 后台填入，Verify Token 与下方一致）
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
                Redirect URL：<code>https://crm.erdicn.com/api/auth/linkedin/callback</code> ·
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
              <Field name="amazonRefreshToken" label="Refresh Token" def={(settings as any)?.amazonRefreshToken} type="password" />
              <Field name="amazonSellerId" label="Seller ID (可选)" def={(settings as any)?.amazonSellerId} />
              <Field name="amazonMarketplaceId" label="Marketplace ID (默认美国 ATVPDKIKX0DER)" def={(settings as any)?.amazonMarketplaceId || 'ATVPDKIKX0DER'} />
              <Field name="amazonRegion" label="Region (na / eu / fe)" def={(settings as any)?.amazonRegion || 'na'} />
            </Section>

            <Section title="🛍️ 虾皮 Shopee (Open Platform)">
              <p className="text-xs text-gray-500 -mt-2 mb-3">
                在 Shopee 开放平台创建应用并授权店铺后填入。聊天消息将通过 webhook 汇入统一收件箱。Push URL:<code>https://crm.erdicn.com/api/shopee/webhook</code>
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

            <Section title="🌐 LibreTranslate 翻译服务">
              <Field name="libretranslateUrl" label="服务地址" def={(settings as any)?.libretranslateUrl || 'https://libretranslate.com'} />
              <p className="text-xs text-gray-500">默认使用公共实例（可能限流）。建议自部署 LibreTranslate 后填入 https 地址。</p>
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
          <div className="space-y-6">
            {emailAccounts.map(acc => (
              <form key={acc.id} action={updateEmailConfig} className="bg-gray-50 p-6 rounded-lg border border-gray-100">
                <input type="hidden" name="id" value={acc.id} />
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-gray-800 text-lg">{acc.email}</h3>
                  <span className={`text-xs px-2 py-1 rounded ${acc.password ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {acc.password ? '✅ 已配置' : '❌ 未配置'}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">IMAP 服务器</label>
                    <input type="text" name="imapHost" defaultValue={acc.imapHost} required className="w-full border border-gray-300 rounded-lg p-2.5 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">授权码</label>
                    <input type="password" name="password" placeholder={acc.password ? "******** (覆盖)" : "请输入"} required className="w-full border border-gray-300 rounded-lg p-2.5 text-sm" />
                  </div>
                </div>
                <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium text-sm hover:bg-blue-700">更新</button>
              </form>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-gray-200 rounded-lg p-5 bg-gray-50/50">
      <h3 className="font-bold text-gray-800 mb-4">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({ name, label, def, type = 'text' }: { name: string; label: string; def?: any; type?: string }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-700 mb-1">{label}</label>
      <input
        type={type}
        name={name}
        defaultValue={def || ''}
        placeholder={def && type === 'password' ? '已配置 (留空保持不变)' : ''}
        className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500"
      />
    </div>
  );
}

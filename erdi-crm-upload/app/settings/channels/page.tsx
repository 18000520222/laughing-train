import { prisma } from '@/lib/prisma';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN'];

export default async function ChannelSettingsPage({
  searchParams,
}: {
  searchParams?: { connected?: string; error?: string; saved?: string };
}) {
  const role = cookies().get('auth_role')?.value?.toUpperCase();
  if (!role || !ADMIN_ROLES.includes(role)) redirect('/');

  const connected = searchParams?.connected;
  const authError = searchParams?.error;

  let s = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
  if (!s) s = { id: 'default', usdToCnyRate: 7.2, companyName: 'ERDI TECH LTD', updatedAt: new Date() } as any;
  const st: any = s;

  async function save(formData: FormData) {
    'use server';
    const r = cookies().get('auth_role')?.value?.toUpperCase();
    if (!r || !ADMIN_ROLES.includes(r)) return;
    const g = (k: string) => {
      const v = formData.get(k);
      return v === null || v === '' ? null : String(v);
    };
    const data: any = {
      // WhatsApp
      whatsappToken: g('whatsappToken'),
      whatsappPhoneId: g('whatsappPhoneId'),
      whatsappVerifyToken: g('whatsappVerifyToken'),
      // 阿里国际站
      alibabaAppKey: g('alibabaAppKey'),
      alibabaAppSecret: g('alibabaAppSecret'),
      alibabaAccessToken: g('alibabaAccessToken'),
      alibabaRefreshToken: g('alibabaRefreshToken'),
      // 亚马逊 SP-API
      amazonRefreshToken: g('amazonRefreshToken'),
      amazonLwaClientId: g('amazonLwaClientId'),
      amazonLwaClientSecret: g('amazonLwaClientSecret'),
      amazonSellerId: g('amazonSellerId'),
      amazonMarketplaceId: g('amazonMarketplaceId'),
      amazonRegion: g('amazonRegion'),
      // Shopee
      shopeePartnerId: g('shopeePartnerId'),
      shopeePartnerKey: g('shopeePartnerKey'),
      shopeeShopId: g('shopeeShopId'),
      shopeeAccessToken: g('shopeeAccessToken'),
      shopeeRefreshToken: g('shopeeRefreshToken'),
    };
    // 只更新表单提交的非空字段以外的全部(允许清空)
    await prisma.systemSettings.upsert({
      where: { id: 'default' },
      update: data,
      create: { id: 'default', usdToCnyRate: 7.2, companyName: 'ERDI TECH LTD', ...data },
    });
    redirect('/settings/channels?saved=1');
  }

  const status = (configured: boolean) =>
    configured ? (
      <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-semibold">已配置</span>
    ) : (
      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-semibold">未配置</span>
    );

  const waOk = !!(st.whatsappToken && st.whatsappPhoneId);
  const abOk = !!(st.alibabaAppKey && st.alibabaAppSecret && st.alibabaAccessToken);
  const amzOk = !!(st.amazonRefreshToken && st.amazonLwaClientId && st.amazonLwaClientSecret);
  const spOk = !!(st.shopeePartnerId && st.shopeePartnerKey && st.shopeeShopId);

  const baseUrl = 'https://crm.erdicn.com';

  return (
    <div className="max-w-4xl mx-auto p-6 md:p-10">
      <div className="flex items-center gap-3 mb-2">
        <Link href="/settings" className="text-sm text-gray-500 hover:text-gray-800">← 系统设置</Link>
      </div>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">🔌 渠道接入配置</h1>
      <p className="text-sm text-gray-500 mb-6">
        填写各电商/社媒渠道的开放平台凭据后，系统将自动拉取询盘并进入「统一收件箱」（含翻译 + AI 回复草稿）。
        凭据保存在数据库，不会显示在前端明文回显之外的位置。
      </p>

      {connected && (
        <div className="mb-6 p-4 rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm font-medium">
          ✅ {connected.toUpperCase()} 授权成功，access_token 已保存并将自动刷新。
        </div>
      )}
      {authError && (
        <div className="mb-6 p-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm break-all">
          ❌ 授权失败：{decodeURIComponent(authError)}
        </div>
      )}

      <form action={save} className="space-y-8">
        {/* WhatsApp */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-bold text-gray-800">💬 WhatsApp Cloud API</h2>
            {status(waOk)}
          </div>
          <p className="text-xs text-gray-400 mb-4">Webhook 回调地址：<code>{baseUrl}/api/whatsapp/webhook</code></p>
          <div className="grid grid-cols-2 gap-4">
            <Field name="whatsappToken" label="Access Token" defaultValue={st.whatsappToken} />
            <Field name="whatsappPhoneId" label="Phone Number ID" defaultValue={st.whatsappPhoneId} />
            <Field name="whatsappVerifyToken" label="Verify Token（Webhook 校验）" defaultValue={st.whatsappVerifyToken} placeholder="erdi-verify-2026" />
          </div>
        </section>

        {/* 阿里国际站 */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-bold text-gray-800">🟠 阿里巴巴国际站</h2>
            <div className="flex items-center gap-2">
              {status(abOk)}
              <a href="/api/auth/alibaba/start" className="text-xs px-3 py-1 rounded-full bg-orange-500 text-white font-semibold hover:bg-orange-600">🔑 一键授权</a>
            </div>
          </div>
          <p className="text-xs text-gray-400 mb-4">消息推送地址：<code>{baseUrl}/api/alibaba/webhook</code>　·　授权回调：<code>{baseUrl}/api/auth/alibaba/callback</code>（先填 AppKey/AppSecret 并「保存」，再点右上「一键授权」跳转阿里授权页，回来后 token 自动入库并续期）</p>
          <div className="grid grid-cols-2 gap-4">
            <Field name="alibabaAppKey" label="App Key" defaultValue={st.alibabaAppKey} />
            <Field name="alibabaAppSecret" label="App Secret" defaultValue={st.alibabaAppSecret} />
            <Field name="alibabaAccessToken" label="Access Token" defaultValue={st.alibabaAccessToken} />
            <Field name="alibabaRefreshToken" label="Refresh Token" defaultValue={st.alibabaRefreshToken} />
          </div>
        </section>

        {/* 亚马逊 */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-bold text-gray-800">📦 亚马逊 SP-API</h2>
            <div className="flex items-center gap-2">
              {status(amzOk)}
              <a href="/api/auth/amazon/start" className="text-xs px-3 py-1 rounded-full bg-yellow-500 text-white font-semibold hover:bg-yellow-600">🔑 一键授权</a>
            </div>
          </div>
          <p className="text-xs text-gray-400 mb-4">亚马逊无消息 webhook，系统每 10 分钟轮询订单/消息。</p>
          <div className="grid grid-cols-2 gap-4">
            <Field name="amazonRefreshToken" label="LWA Refresh Token" defaultValue={st.amazonRefreshToken} />
            <Field name="amazonLwaClientId" label="LWA Client ID" defaultValue={st.amazonLwaClientId} />
            <Field name="amazonLwaClientSecret" label="LWA Client Secret" defaultValue={st.amazonLwaClientSecret} />
            <Field name="amazonSellerId" label="Seller ID" defaultValue={st.amazonSellerId} />
            <Field name="amazonMarketplaceId" label="Marketplace ID" defaultValue={st.amazonMarketplaceId} placeholder="ATVPDKIKX0DER（美国）" />
            <Field name="amazonRegion" label="Region（na / eu / fe）" defaultValue={st.amazonRegion} placeholder="na" />
          </div>
        </section>

        {/* Shopee */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-bold text-gray-800">🛒 Shopee 虾皮</h2>
            <div className="flex items-center gap-2">
              {status(spOk)}
              <a href="/api/auth/shopee/start" className="text-xs px-3 py-1 rounded-full bg-orange-600 text-white font-semibold hover:bg-orange-700">🔑 一键授权</a>
            </div>
          </div>
          <p className="text-xs text-gray-400 mb-4">Push 回调地址：<code>{baseUrl}/api/shopee/webhook</code></p>
          <div className="grid grid-cols-2 gap-4">
            <Field name="shopeePartnerId" label="Partner ID" defaultValue={st.shopeePartnerId} />
            <Field name="shopeePartnerKey" label="Partner Key" defaultValue={st.shopeePartnerKey} />
            <Field name="shopeeShopId" label="Shop ID" defaultValue={st.shopeeShopId} />
            <Field name="shopeeAccessToken" label="Access Token" defaultValue={st.shopeeAccessToken} />
            <Field name="shopeeRefreshToken" label="Refresh Token" defaultValue={st.shopeeRefreshToken} />
          </div>
        </section>

        <button type="submit" className="bg-gray-900 text-white px-6 py-3 rounded-lg font-bold hover:bg-gray-800">
          保存渠道配置
        </button>
      </form>
    </div>
  );
}

function Field({ name, label, defaultValue, placeholder }: { name: string; label: string; defaultValue?: string | null; placeholder?: string }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-gray-700 mb-1.5">{label}</label>
      <input
        type="text"
        name={name}
        defaultValue={defaultValue || ''}
        placeholder={placeholder || ''}
        autoComplete="off"
        className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500"
      />
    </div>
  );
}

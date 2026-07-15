import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { InboxChannel, SocialPlatform } from '@prisma/client';
import { requirePermission } from '@/lib/permissions';
import { writeAuditLog } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN'];
const SECRET_FIELDS = new Set([
  'whatsappToken',
  'whatsapp360ApiKey',
  'fbAppSecret',
  'linkedinClientSecret',
  'aftershipApiKey',
  'alibabaAppSecret',
  'alibabaAccessToken',
  'alibabaRefreshToken',
  'amazonRefreshToken',
  'amazonLwaClientSecret',
  'amazonAwsAccessKeyId',
  'amazonAwsSecretAccessKey',
  'shopeePartnerKey',
  'shopeeAccessToken',
  'shopeeRefreshToken',
  'salesmartlyWebhookKey',
  'salesmartlyApiKey',
  'chatwootApiToken',
  'chatwootWebhookKey',
  'googleClientSecret',
]);

const hasEnv = (key: string) => Boolean(process.env[key]?.trim());

type RuntimeChannelConfig = {
  whatsapp360: boolean;
  whatsappCloud: boolean;
  facebookApp: boolean;
  facebookAppIdOnly: boolean;
  linkedinClient: boolean;
  aftershipApi: boolean;
  alibabaOauth: boolean;
  amazonSpApi: boolean;
  shopeePartner: boolean;
  salesmartlyWebhook: boolean;
  salesmartlyReply: boolean;
  chatwootCore: boolean;
  chatwootReply: boolean;
  googleClient: boolean;
};

export default async function ChannelSettingsPage({
  searchParams,
}: {
  searchParams?: Promise<{ connected?: string; error?: string; saved?: string }>;
}) {
  await requirePermission('channels.configure');
  const query = searchParams ? await searchParams : {};

  const connected = query.connected;
  const authError = query.error;

  let s = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
  if (!s) s = { id: 'default', usdToCnyRate: 7.2, companyName: 'ERDI TECH LTD', updatedAt: new Date() } as any;
  const st: any = s;

  const [emailAccounts, socialAccounts, inboxTotals, inboxPending, trackingEventCount, latestTrackingEvent] = await Promise.all([
    prisma.emailAccount.findMany({
      orderBy: { email: 'asc' },
      select: {
        email: true,
        password: true,
        authType: true,
        oauthRefreshToken: true,
        oauthTokenExpiresAt: true,
        imapHost: true,
        isActive: true,
        updatedAt: true,
        _count: { select: { messages: true } },
        messages: { orderBy: { date: 'desc' }, take: 1, select: { date: true } },
      },
    }),
    prisma.socialAccount.findMany({
      orderBy: [{ platform: 'asc' }, { updatedAt: 'desc' }],
      select: {
        platform: true,
        name: true,
        externalId: true,
        expiresAt: true,
        updatedAt: true,
        _count: { select: { messages: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
      },
    }),
    prisma.inboxMessage.groupBy({
      by: ['channel'],
      where: { direction: 'IN' },
      _count: { _all: true },
      _max: { createdAt: true, sentAt: true },
    }),
    prisma.inboxMessage.groupBy({
      by: ['channel'],
      where: { direction: 'IN', status: { in: ['NEW', 'AI_DRAFTED'] } },
      _count: { _all: true },
    }),
    prisma.trackingEvent.count(),
    prisma.trackingEvent.findFirst({
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      select: { occurredAt: true, createdAt: true },
    }),
  ]);

  async function save(formData: FormData) {
    'use server';
    const actor = await requirePermission('channels.configure');
    const g = (k: string) => {
      const v = formData.get(k);
      const value = v === null ? '' : String(v).trim();
      if (!value) return SECRET_FIELDS.has(k) ? undefined : null;
      return value;
    };
    const rawData: any = {
      // WhatsApp
      whatsappToken: g('whatsappToken'),
      whatsappPhoneId: g('whatsappPhoneId'),
      whatsappVerifyToken: g('whatsappVerifyToken'),
      whatsapp360ApiKey: g('whatsapp360ApiKey'),
      // Facebook / LinkedIn / AfterShip
      fbAppId: g('fbAppId'),
      fbAppSecret: g('fbAppSecret'),
      fbVerifyToken: g('fbVerifyToken'),
      linkedinClientId: g('linkedinClientId'),
      linkedinClientSecret: g('linkedinClientSecret'),
      aftershipApiKey: g('aftershipApiKey'),
      // 阿里国际站
      alibabaAppKey: g('alibabaAppKey'),
      alibabaAppSecret: g('alibabaAppSecret'),
      alibabaAccessToken: g('alibabaAccessToken'),
      alibabaRefreshToken: g('alibabaRefreshToken'),
      // 亚马逊 SP-API
      amazonRefreshToken: g('amazonRefreshToken'),
      amazonLwaClientId: g('amazonLwaClientId'),
      amazonLwaClientSecret: g('amazonLwaClientSecret'),
      amazonAwsAccessKeyId: g('amazonAwsAccessKeyId'),
      amazonAwsSecretAccessKey: g('amazonAwsSecretAccessKey'),
      amazonSellerId: g('amazonSellerId'),
      amazonMarketplaceId: g('amazonMarketplaceId'),
      amazonRegion: g('amazonRegion'),
      // Shopee
      shopeePartnerId: g('shopeePartnerId'),
      shopeePartnerKey: g('shopeePartnerKey'),
      shopeeShopId: g('shopeeShopId'),
      shopeeAccessToken: g('shopeeAccessToken'),
      shopeeRefreshToken: g('shopeeRefreshToken'),
      // SaleSmartly
      salesmartlyWebhookKey: g('salesmartlyWebhookKey'),
      salesmartlyReplyUrl: g('salesmartlyReplyUrl'),
      salesmartlyApiKey: g('salesmartlyApiKey'),
      // Chatwoot
      chatwootBaseUrl: g('chatwootBaseUrl'),
      chatwootAccountId: g('chatwootAccountId'),
      chatwootInboxId: g('chatwootInboxId'),
      chatwootApiToken: g('chatwootApiToken'),
      chatwootWebhookKey: g('chatwootWebhookKey'),
      // Google / Gmail OAuth
      googleClientId: g('googleClientId'),
      googleClientSecret: g('googleClientSecret'),
    };
    const data = Object.fromEntries(Object.entries(rawData).filter(([, v]) => v !== undefined));
    // 敏感字段留空时保持原值；普通字段留空时允许清空。
    await prisma.systemSettings.upsert({
      where: { id: 'default' },
      update: data,
      create: { id: 'default', usdToCnyRate: 7.2, companyName: 'ERDI TECH LTD', ...data },
    });
    await writeAuditLog(actor, { action: 'CHANNEL_SETTINGS_UPDATED', entityType: 'SystemSettings', entityId: 'default', summary: '更新渠道接入配置（不记录密钥值）' });
    redirect('/settings/channels?saved=1');
  }

  const status = (configured: boolean) =>
    configured ? (
      <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-semibold">已配置</span>
    ) : (
      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-semibold">未配置</span>
    );

  const runtimeConfig: RuntimeChannelConfig = {
    whatsapp360: hasEnv('WHATSAPP_360_API_KEY'),
    whatsappCloud: hasEnv('WHATSAPP_TOKEN') && hasEnv('WHATSAPP_PHONE_ID'),
    facebookApp: hasEnv('FB_APP_ID') && hasEnv('FB_APP_SECRET'),
    facebookAppIdOnly: hasEnv('FB_APP_ID'),
    linkedinClient: hasEnv('LINKEDIN_CLIENT_ID') && hasEnv('LINKEDIN_CLIENT_SECRET'),
    aftershipApi: hasEnv('AFTERSHIP_API_KEY'),
    alibabaOauth: hasEnv('ALIBABA_APP_KEY') && hasEnv('ALIBABA_APP_SECRET') && hasEnv('ALIBABA_ACCESS_TOKEN'),
    amazonSpApi:
      hasEnv('AMAZON_REFRESH_TOKEN') &&
      hasEnv('AMAZON_LWA_CLIENT_ID') &&
      hasEnv('AMAZON_LWA_CLIENT_SECRET') &&
      hasEnv('AMAZON_AWS_ACCESS_KEY_ID') &&
      hasEnv('AMAZON_AWS_SECRET_ACCESS_KEY'),
    shopeePartner: hasEnv('SHOPEE_PARTNER_ID') && hasEnv('SHOPEE_PARTNER_KEY') && hasEnv('SHOPEE_SHOP_ID'),
    salesmartlyWebhook: hasEnv('SALESMARTLY_WEBHOOK_KEY'),
    salesmartlyReply: hasEnv('SALESMARTLY_REPLY_URL') && hasEnv('SALESMARTLY_API_KEY'),
    chatwootCore: hasEnv('CHATWOOT_BASE_URL') && hasEnv('CHATWOOT_ACCOUNT_ID') && hasEnv('CHATWOOT_WEBHOOK_KEY'),
    chatwootReply: hasEnv('CHATWOOT_BASE_URL') && hasEnv('CHATWOOT_ACCOUNT_ID') && hasEnv('CHATWOOT_API_TOKEN'),
    googleClient: hasEnv('GOOGLE_CLIENT_ID') && hasEnv('GOOGLE_CLIENT_SECRET'),
  };

  const dbWaOk = !!(st.whatsapp360ApiKey || (st.whatsappToken && st.whatsappPhoneId));
  const dbFbOk = !!(st.fbAppId && st.fbAppSecret);
  const dbLiOk = !!(st.linkedinClientId && st.linkedinClientSecret);
  const dbAftershipOk = !!st.aftershipApiKey;
  const dbAbOk = !!(st.alibabaAppKey && st.alibabaAppSecret && st.alibabaAccessToken);
  const dbAmzOk = !!(st.amazonRefreshToken && st.amazonLwaClientId && st.amazonLwaClientSecret && st.amazonAwsAccessKeyId && st.amazonAwsSecretAccessKey);
  const dbSpOk = !!(st.shopeePartnerId && st.shopeePartnerKey && st.shopeeShopId);
  const dbSsOk = !!st.salesmartlyWebhookKey;
  const dbCwOk = !!(st.chatwootBaseUrl && st.chatwootAccountId);
  const dbGoogleOk = !!(st.googleClientId && st.googleClientSecret);
  const waOk = dbWaOk || runtimeConfig.whatsapp360 || runtimeConfig.whatsappCloud;
  const fbOk = dbFbOk || runtimeConfig.facebookApp;
  const liOk = dbLiOk || runtimeConfig.linkedinClient;
  const aftershipOk = dbAftershipOk || runtimeConfig.aftershipApi;
  const abOk = dbAbOk || runtimeConfig.alibabaOauth;
  const amzOk = dbAmzOk || runtimeConfig.amazonSpApi;
  const spOk = dbSpOk || runtimeConfig.shopeePartner;
  const ssOk = dbSsOk || runtimeConfig.salesmartlyWebhook;
  const cwOk = dbCwOk || runtimeConfig.chatwootCore;
  const googleOk = dbGoogleOk || runtimeConfig.googleClient;

  const baseUrl = 'https://erdicrm.com';
  const channelHealthRows = buildChannelHealthRows({
    st,
    emailAccounts,
    socialAccounts,
    inboxTotals,
    inboxPending,
    trackingEventCount,
    latestTrackingAt: latestTrackingEvent?.occurredAt || latestTrackingEvent?.createdAt || null,
    configured: { waOk, fbOk, liOk, aftershipOk, abOk, amzOk, spOk, ssOk, cwOk, googleOk },
    runtimeConfig,
  });
  const channelHealthSummary = summarizeChannelHealth(channelHealthRows);

  return (
    <div className="max-w-6xl mx-auto p-6 md:p-10">
      <div className="flex items-center gap-3 mb-2">
        <Link href="/settings" className="text-sm text-gray-500 hover:text-gray-800">← 系统设置</Link>
      </div>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">🔌 渠道接入配置</h1>
      <p className="text-sm text-gray-500 mb-6">
        填写各电商/社媒渠道的开放平台凭据后，系统将自动拉取询盘并进入「统一收件箱」（含翻译 + AI 回复草稿）。
        凭据保存在数据库；敏感字段不会明文回显，留空保存会保持原值。
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

      <section className="mb-8 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-bold text-gray-900">渠道授权健康总控</h2>
            <p className="mt-1 text-xs text-gray-500">
              按 HubSpot/Zendesk/Intercom/Pipedrive 的接入与队列治理思路,统一检查授权、数据流入、SLA 积压和下一步动作。
            </p>
          </div>
          <span className={`rounded-lg px-3 py-2 text-xs font-black ${channelHealthSummary.healthScore >= 80 ? 'bg-emerald-50 text-emerald-700' : channelHealthSummary.healthScore >= 55 ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'}`}>
            接入健康度 {channelHealthSummary.healthScore}
          </span>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <ChannelHealthMetric label="渠道总数" value={channelHealthSummary.total} detail="邮件/社媒/平台/物流" tone="blue" />
          <ChannelHealthMetric label="已配置" value={channelHealthSummary.configured} detail="凭据或账号存在" tone={channelHealthSummary.configured === channelHealthSummary.total ? 'emerald' : 'amber'} />
          <ChannelHealthMetric label="有数据流入" value={channelHealthSummary.flowing} detail="已有消息或事件" tone={channelHealthSummary.flowing > 0 ? 'emerald' : 'rose'} />
          <ChannelHealthMetric label="待回复积压" value={channelHealthSummary.pending} detail="NEW + AI草稿" tone={channelHealthSummary.pending > 0 ? 'rose' : 'emerald'} />
          <ChannelHealthMetric label="需处理" value={channelHealthSummary.risks} detail="缺授权/断流/过期" tone={channelHealthSummary.risks > 0 ? 'rose' : 'emerald'} />
          <ChannelHealthMetric label="7天内活跃" value={channelHealthSummary.fresh} detail="最近有入站数据" tone={channelHealthSummary.fresh > 0 ? 'emerald' : 'slate'} />
        </div>
        <div className="mt-4 rounded-xl bg-gray-50 px-4 py-3 text-xs font-bold text-gray-600">{channelHealthSummary.recommendation}</div>
        <div className="mt-4 overflow-hidden rounded-xl border border-gray-100">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs font-black text-gray-500">
              <tr>
                <th className="p-3">渠道</th>
                <th className="p-3">授权/连接</th>
                <th className="p-3">数据流入</th>
                <th className="p-3">待处理</th>
                <th className="p-3">建议动作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {channelHealthRows.map((row) => (
                <tr key={row.key} className="hover:bg-gray-50">
                  <td className="p-3">
                    <div className="font-black text-gray-900">{row.name}</div>
                    <div className="mt-0.5 text-[11px] font-bold text-gray-400">{row.mode}</div>
                  </td>
                  <td className="p-3">
                    <span className={`rounded-full px-2 py-1 text-xs font-black ${row.toneClass}`}>{row.status}</span>
                    <div className="mt-1 text-[11px] font-bold text-gray-400">{row.tokenLabel}</div>
                  </td>
                  <td className="p-3">
                    <div className="font-black text-gray-800">{row.dataCount}</div>
                    <div className="mt-0.5 text-[11px] font-bold text-gray-400">最近:{row.lastSeenLabel}</div>
                  </td>
                  <td className="p-3">
                    <div className={`font-black ${row.pendingCount > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{row.pendingCount}</div>
                    <div className="mt-0.5 text-[11px] font-bold text-gray-400">统一收件箱</div>
                  </td>
                  <td className="p-3">
                    <div className="text-xs font-bold text-gray-600">{row.action}</div>
                    <Link href={row.href} className="mt-1 inline-block text-[11px] font-black text-blue-600 hover:underline">{row.linkLabel}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <form action={save} className="space-y-8">
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-bold text-gray-800">📧 Gmail / Google OAuth</h2>
            <div className="flex items-center gap-2">
              {status(googleOk)}
              <a href="/api/auth/google/start" className="text-xs px-3 py-1 rounded-full bg-red-600 text-white font-semibold hover:bg-red-700">🔑 一键授权</a>
            </div>
          </div>
          <p className="text-xs text-gray-400 mb-4">
            Google OAuth Redirect URI：<code>{baseUrl}/api/auth/google/callback</code>。先填 Client ID/Secret 并保存，再点一键授权，CRM 会把 Gmail OAuth token 写入邮箱账号并用于 IMAP 同步。
          </p>
          {!dbGoogleOk && runtimeConfig.googleClient && <RuntimeConfigHint text="已检测到 Google Client 来自环境变量；密钥不会回显，表单留空不会删除环境变量。" />}
          <div className="grid grid-cols-2 gap-4">
            <Field name="googleClientId" label="Google OAuth Client ID" defaultValue={st.googleClientId} />
            <Field name="googleClientSecret" label="Google OAuth Client Secret" defaultValue={st.googleClientSecret} type="password" />
          </div>
        </section>

        {/* WhatsApp */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-bold text-gray-800">💬 WhatsApp</h2>
            {status(waOk)}
          </div>
          <p className="text-xs text-gray-400 mb-4">推荐 360dialog BSP。Webhook 回调地址：<code>{baseUrl}/api/whatsapp/webhook</code></p>
          {!dbWaOk && (runtimeConfig.whatsapp360 || runtimeConfig.whatsappCloud) && <RuntimeConfigHint text="已检测到 WhatsApp 凭据来自环境变量；密钥不会回显，表单留空不会删除环境变量。" />}
          <div className="mb-4">
            <Field name="whatsapp360ApiKey" label="360dialog API Key（推荐）" defaultValue={st.whatsapp360ApiKey} type="password" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field name="whatsappToken" label="Meta Access Token" defaultValue={st.whatsappToken} type="password" />
            <Field name="whatsappPhoneId" label="Phone Number ID" defaultValue={st.whatsappPhoneId} />
            <Field name="whatsappVerifyToken" label="Verify Token（Webhook 校验）" defaultValue={st.whatsappVerifyToken} placeholder="erdi-verify-2026" />
          </div>
        </section>

        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-bold text-gray-800">💠 SaleSmartly</h2>
            {status(ssOk)}
          </div>
          <p className="text-xs text-gray-400 mb-4">Webhook 回调地址：<code>{baseUrl}/api/salesmartly/webhook</code>。SaleSmartly 后台配置 webhook key；如需从 CRM 一键回复，再填 SaleSmartly 回复地址和 API Key。</p>
          {!dbSsOk && runtimeConfig.salesmartlyWebhook && <RuntimeConfigHint text="已检测到 SaleSmartly Webhook Key 来自环境变量；密钥不会回显，表单留空不会删除环境变量。" />}
          <div className="grid grid-cols-2 gap-4">
            <Field name="salesmartlyWebhookKey" label="Webhook Key" defaultValue={st.salesmartlyWebhookKey} type="password" />
            <Field name="salesmartlyReplyUrl" label="Message Reply URL" defaultValue={st.salesmartlyReplyUrl} placeholder="https://..." />
            <Field name="salesmartlyApiKey" label="API Key / Reply Token" defaultValue={st.salesmartlyApiKey} type="password" />
          </div>
        </section>

        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-bold text-gray-800">🟢 Chatwoot</h2>
            {status(cwOk)}
          </div>
          <p className="text-xs text-gray-400 mb-4">
            Webhook 回调地址：<code>{baseUrl}/api/chatwoot/webhook</code>。Chatwoot 后台 Webhooks 订阅 conversation/message/contact 事件；如需从 CRM 回发，必须填 Base URL、Account ID 和 API Token。
          </p>
          {!dbCwOk && runtimeConfig.chatwootCore && <RuntimeConfigHint text="已检测到 Chatwoot 来自环境变量；生产 Webhook/API 可用，密钥不会回显，表单留空不会删除环境变量。" />}
          <div className="grid grid-cols-2 gap-4">
            <Field name="chatwootBaseUrl" label="Chatwoot Base URL" defaultValue={st.chatwootBaseUrl} placeholder="https://chat.yourdomain.com" />
            <Field name="chatwootAccountId" label="Account ID" defaultValue={st.chatwootAccountId} placeholder="1" />
            <Field name="chatwootInboxId" label="Inbox ID（可选）" defaultValue={st.chatwootInboxId} placeholder="1" />
            <Field name="chatwootApiToken" label="API Access Token" defaultValue={st.chatwootApiToken} type="password" />
            <Field name="chatwootWebhookKey" label="Webhook Key（可选，建议填）" defaultValue={st.chatwootWebhookKey} type="password" />
          </div>
        </section>

        {/* Facebook / LinkedIn / AfterShip */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-bold text-gray-800">📘 Facebook Page / Messenger</h2>
            <div className="flex items-center gap-2">
              {status(fbOk)}
              <a href="/api/auth/facebook/start" className="text-xs px-3 py-1 rounded-full bg-blue-600 text-white font-semibold hover:bg-blue-700">🔑 一键授权</a>
            </div>
          </div>
          <p className="text-xs text-gray-400 mb-4">授权回调：<code>{baseUrl}/api/auth/facebook/callback</code>　·　Webhook：<code>{baseUrl}/api/facebook/webhook</code></p>
          {!dbFbOk && runtimeConfig.facebookAppIdOnly && !runtimeConfig.facebookApp && <RuntimeConfigHint tone="amber" text="已检测到 FB_APP_ID 来自环境变量，但缺 FB_APP_SECRET；Meta OAuth 还不能算完整。" />}
          {!dbFbOk && runtimeConfig.facebookApp && <RuntimeConfigHint text="已检测到 Meta App 凭据来自环境变量；密钥不会回显，表单留空不会删除环境变量。" />}
          <div className="grid grid-cols-2 gap-4">
            <Field name="fbAppId" label="App ID" defaultValue={st.fbAppId} />
            <Field name="fbAppSecret" label="App Secret" defaultValue={st.fbAppSecret} type="password" />
            <Field name="fbVerifyToken" label="Webhook Verify Token" defaultValue={st.fbVerifyToken} placeholder="erdi-fb-verify" />
          </div>
        </section>

        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-bold text-gray-800">👔 LinkedIn Lead Gen</h2>
            <div className="flex items-center gap-2">
              {status(liOk)}
              <a href="/api/auth/linkedin/start" className="text-xs px-3 py-1 rounded-full bg-indigo-600 text-white font-semibold hover:bg-indigo-700">🔑 一键授权</a>
            </div>
          </div>
          <p className="text-xs text-gray-400 mb-4">授权回调：<code>{baseUrl}/api/auth/linkedin/callback</code></p>
          {!dbLiOk && runtimeConfig.linkedinClient && <RuntimeConfigHint text="已检测到 LinkedIn Client 来自环境变量；密钥不会回显，表单留空不会删除环境变量。" />}
          <div className="grid grid-cols-2 gap-4">
            <Field name="linkedinClientId" label="Client ID" defaultValue={st.linkedinClientId} />
            <Field name="linkedinClientSecret" label="Client Secret" defaultValue={st.linkedinClientSecret} type="password" />
          </div>
        </section>

        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-bold text-gray-800">🚚 AfterShip 物流追踪</h2>
            {status(aftershipOk)}
          </div>
          <p className="text-xs text-gray-400 mb-4">配置后可在物流中心或 <code>/api/tracking/sync</code> 同步未签收运单。</p>
          {!dbAftershipOk && runtimeConfig.aftershipApi && <RuntimeConfigHint text="已检测到 AfterShip API Key 来自环境变量；密钥不会回显，表单留空不会删除环境变量。" />}
          <Field name="aftershipApiKey" label="AfterShip API Key" defaultValue={st.aftershipApiKey} type="password" />
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
          {!dbAbOk && runtimeConfig.alibabaOauth && <RuntimeConfigHint text="已检测到阿里 OAuth 凭据来自环境变量；密钥不会回显，表单留空不会删除环境变量。" />}
          <div className="grid grid-cols-2 gap-4">
            <Field name="alibabaAppKey" label="App Key" defaultValue={st.alibabaAppKey} />
            <Field name="alibabaAppSecret" label="App Secret" defaultValue={st.alibabaAppSecret} type="password" />
            <Field name="alibabaAccessToken" label="Access Token" defaultValue={st.alibabaAccessToken} type="password" />
            <Field name="alibabaRefreshToken" label="Refresh Token" defaultValue={st.alibabaRefreshToken} type="password" />
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
          <p className="text-xs text-gray-400 mb-4">亚马逊无消息 webhook，系统每 10 分钟轮询订单/消息。SP-API 正式请求需要 LWA token + AWS SigV4 签名。</p>
          {!dbAmzOk && runtimeConfig.amazonSpApi && <RuntimeConfigHint text="已检测到 Amazon SP-API 凭据来自环境变量；密钥不会回显，表单留空不会删除环境变量。" />}
          <div className="grid grid-cols-2 gap-4">
            <Field name="amazonRefreshToken" label="LWA Refresh Token" defaultValue={st.amazonRefreshToken} type="password" />
            <Field name="amazonLwaClientId" label="LWA Client ID" defaultValue={st.amazonLwaClientId} />
            <Field name="amazonLwaClientSecret" label="LWA Client Secret" defaultValue={st.amazonLwaClientSecret} type="password" />
            <Field name="amazonAwsAccessKeyId" label="AWS Access Key ID" defaultValue={st.amazonAwsAccessKeyId} type="password" />
            <Field name="amazonAwsSecretAccessKey" label="AWS Secret Access Key" defaultValue={st.amazonAwsSecretAccessKey} type="password" />
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
          {!dbSpOk && runtimeConfig.shopeePartner && <RuntimeConfigHint text="已检测到 Shopee Partner 凭据来自环境变量；密钥不会回显，表单留空不会删除环境变量。" />}
          <div className="grid grid-cols-2 gap-4">
            <Field name="shopeePartnerId" label="Partner ID" defaultValue={st.shopeePartnerId} />
            <Field name="shopeePartnerKey" label="Partner Key" defaultValue={st.shopeePartnerKey} type="password" />
            <Field name="shopeeShopId" label="Shop ID" defaultValue={st.shopeeShopId} />
            <Field name="shopeeAccessToken" label="Access Token" defaultValue={st.shopeeAccessToken} type="password" />
            <Field name="shopeeRefreshToken" label="Refresh Token" defaultValue={st.shopeeRefreshToken} type="password" />
          </div>
        </section>

        <button type="submit" className="bg-gray-900 text-white px-6 py-3 rounded-lg font-bold hover:bg-gray-800">
          保存渠道配置
        </button>
      </form>
    </div>
  );
}

type ChannelHealthRow = {
  key: string;
  name: string;
  mode: string;
  status: string;
  tokenLabel: string;
  dataCount: number;
  pendingCount: number;
  lastSeenAt: Date | null;
  lastSeenLabel: string;
  action: string;
  href: string;
  linkLabel: string;
  configured: boolean;
  flowing: boolean;
  fresh: boolean;
  riskLevel: 'ok' | 'warn' | 'risk';
  toneClass: string;
};

type EmailAccountHealth = {
  email: string;
  password: string;
  authType: string;
  oauthRefreshToken: string | null;
  oauthTokenExpiresAt: Date | null;
  imapHost: string;
  isActive: boolean;
  updatedAt: Date;
  _count: { messages: number };
  messages: Array<{ date: Date }>;
};

type SocialAccountHealth = {
  platform: SocialPlatform;
  name: string | null;
  externalId: string;
  expiresAt: Date | null;
  updatedAt: Date;
  _count: { messages: number };
  messages: Array<{ createdAt: Date }>;
};

type InboxTotalHealth = {
  channel: InboxChannel;
  _count: { _all: number };
  _max: { createdAt: Date | null; sentAt: Date | null };
};

type InboxPendingHealth = {
  channel: InboxChannel;
  _count: { _all: number };
};

function buildChannelHealthRows(input: {
  st: any;
  runtimeConfig: RuntimeChannelConfig;
  emailAccounts: EmailAccountHealth[];
  socialAccounts: SocialAccountHealth[];
  inboxTotals: InboxTotalHealth[];
  inboxPending: InboxPendingHealth[];
  trackingEventCount: number;
  latestTrackingAt: Date | null;
  configured: { waOk: boolean; fbOk: boolean; liOk: boolean; aftershipOk: boolean; abOk: boolean; amzOk: boolean; spOk: boolean; ssOk: boolean; cwOk: boolean; googleOk: boolean };
}) {
  const totalMap = new Map<InboxChannel, InboxTotalHealth>();
  const pendingMap = new Map<InboxChannel, number>();
  for (const row of input.inboxTotals) totalMap.set(row.channel, row);
  for (const row of input.inboxPending) pendingMap.set(row.channel, row._count._all);

  const byChannel = (channel: InboxChannel) => {
    const row = totalMap.get(channel);
    return {
      total: row?._count._all || 0,
      pending: pendingMap.get(channel) || 0,
      lastSeenAt: maxDate(row?._max.sentAt || null, row?._max.createdAt || null),
    };
  };

  const facebook = socialSummary(input.socialAccounts, 'FACEBOOK');
  const instagram = socialSummary(input.socialAccounts, 'INSTAGRAM');
  const linkedin = socialSummary(input.socialAccounts, 'LINKEDIN');
  const emailLatest = maxDate(...input.emailAccounts.map((account) => account.messages[0]?.date || null));
  const activeEmailAccounts = input.emailAccounts.filter((account) => account.isActive);
  const oauthEmailCount = activeEmailAccounts.filter((account) => Boolean(account.oauthRefreshToken)).length;
  const appPasswordEmailCount = activeEmailAccounts.filter((account) => Boolean(account.password)).length;
  const emailConfigured = oauthEmailCount > 0 || appPasswordEmailCount > 0;
  const emailDataCount = input.emailAccounts.reduce((sum, account) => sum + account._count.messages, 0);
  const emailChannel = byChannel('EMAIL');
  const whatsapp = byChannel('WHATSAPP');
  const alibaba = byChannel('ALIBABA');
  const amazon = byChannel('AMAZON');
  const shopee = byChannel('SHOPEE');
  const facebookInbox = byChannel('FACEBOOK');
  const instagramInbox = byChannel('INSTAGRAM');
  const linkedinInbox = byChannel('LINKEDIN');
  const salesmartly = byChannel('SALESMARTLY');
  const chatwoot = byChannel('CHATWOOT');
  const googleClientLabel = input.st.googleClientId && input.st.googleClientSecret ? 'CRM 数据库' : input.runtimeConfig.googleClient ? '环境变量' : '';
  const whatsappTokenLabel = input.st.whatsapp360ApiKey
    ? '360dialog 已配置'
    : input.runtimeConfig.whatsapp360
      ? '360dialog 已配置(环境变量)'
      : input.configured.waOk
        ? input.runtimeConfig.whatsappCloud
          ? 'Meta Cloud 已配置(环境变量)'
          : 'Meta Cloud 已配置'
        : '未配置 API Key/Token';
  const salesmartlyTokenLabel = input.st.salesmartlyWebhookKey
    ? input.st.salesmartlyReplyUrl
      ? 'Webhook + 回复地址已配置'
      : 'Webhook 已配置'
    : input.runtimeConfig.salesmartlyWebhook
      ? input.runtimeConfig.salesmartlyReply
        ? 'Webhook + 回复地址已配置(环境变量)'
        : 'Webhook 已配置(环境变量)'
      : '未配置 Webhook Key';
  const chatwootTokenLabel = input.st.chatwootBaseUrl
    ? input.st.chatwootApiToken
      ? 'Base URL + API Token 已配置'
      : 'Base URL 已配置,待 API Token'
    : input.runtimeConfig.chatwootCore
      ? input.runtimeConfig.chatwootReply
        ? 'Base URL + API Token 已配置(环境变量)'
        : 'Webhook 已配置(环境变量),待 API Token'
      : '未配置 Chatwoot';
  const facebookTokenLabel = facebook.accountCount > 0
    ? `${facebook.accountCount} 个账号已授权`
    : input.configured.fbOk
      ? input.runtimeConfig.facebookApp && !(input.st.fbAppId && input.st.fbAppSecret)
        ? 'App 凭据已配置(环境变量)'
        : 'App 凭据已配置'
      : input.runtimeConfig.facebookAppIdOnly
        ? '已配置 App ID,缺 App Secret'
        : '未配置 App 凭据';
  const linkedInTokenLabel = linkedin.accountCount > 0
    ? `${linkedin.accountCount} 个账号已授权`
    : input.configured.liOk
      ? input.runtimeConfig.linkedinClient && !(input.st.linkedinClientId && input.st.linkedinClientSecret)
        ? 'Client 已配置(环境变量)'
        : 'Client 已配置'
      : '未配置 Client';

  return [
    makeChannelRow({
      key: 'email',
      name: 'Gmail / IMAP 邮件',
      mode: `${activeEmailAccounts.length}/${input.emailAccounts.length} 个账号启用 · ${activeEmailAccounts.map((account) => account.imapHost).filter(Boolean).slice(0, 2).join('、') || '未配置 IMAP'}`,
      configured: emailConfigured,
      tokenExpired: false,
      tokenLabel: oauthEmailCount > 0 ? `Google OAuth 已授权 ${oauthEmailCount} 个邮箱` : appPasswordEmailCount > 0 ? `IMAP 授权码已配置 ${appPasswordEmailCount} 个邮箱` : input.configured.googleOk ? `Google Client 已配置(${googleClientLabel}),待一键授权` : input.emailAccounts.length > 0 ? '缺邮箱授权' : '未添加邮箱账号',
      dataCount: emailDataCount,
      pendingCount: emailChannel.pending,
      lastSeenAt: maxDate(emailLatest, emailChannel.lastSeenAt),
      setupAction: input.configured.googleOk ? '点击 Gmail 一键授权,用 Google OAuth 接入邮箱同步。' : '先在渠道设置填写 Google OAuth Client ID/Secret,保存后发起一键授权。',
      emptyAction: '运行邮件同步并检查 Google OAuth、IMAP 主机和 Gmail 安全设置。',
      staleAction: '邮件超过 7 天无新数据,检查 Gmail/IMAP 授权是否失效。',
      pendingAction: '邮件有待回复积压,进入统一收件箱优先清询盘和报价邮件。',
      href: input.configured.googleOk ? '/api/auth/google/start' : '/settings/channels',
      linkLabel: input.configured.googleOk ? '发起 Gmail 授权' : '配置 Google Client',
    }),
    makeChannelRow({
      key: 'whatsapp',
      name: 'WhatsApp / 360dialog',
      mode: 'Webhook + AI 草稿 + 人工确认',
      configured: input.configured.waOk,
      tokenExpired: false,
      tokenLabel: whatsappTokenLabel,
      dataCount: whatsapp.total,
      pendingCount: whatsapp.pending,
      lastSeenAt: whatsapp.lastSeenAt,
      setupAction: '配置 360dialog API Key 或 Meta Token + Phone Number ID,并设置 webhook。',
      emptyAction: '发送一条 WhatsApp 测试消息,确认 webhook 进入统一收件箱。',
      staleAction: 'WhatsApp 超过 7 天无新消息,检查 360dialog/Meta webhook 状态。',
      pendingAction: 'WhatsApp 待回复通常更急,先从统一收件箱清掉。',
      href: '/omnibox',
      linkLabel: '打开统一收件箱',
    }),
    makeChannelRow({
      key: 'salesmartly',
      name: 'SaleSmartly 聚合聊天',
      mode: 'Webhook 入站 + CRM AI 草稿 + 可选回发',
      configured: input.configured.ssOk,
      tokenExpired: false,
      tokenLabel: salesmartlyTokenLabel,
      dataCount: salesmartly.total,
      pendingCount: salesmartly.pending,
      lastSeenAt: salesmartly.lastSeenAt,
      setupAction: '在 SaleSmartly 后台配置 webhook key,并把回调 URL 指向 /api/salesmartly/webhook。',
      emptyAction: '从 SaleSmartly 发一条测试会话,确认消息进入统一收件箱并自动建客户。',
      staleAction: 'SaleSmartly 超过 7 天无新消息,检查 webhook key、回调 URL 和 Max/Enterprise 权限。',
      pendingAction: 'SaleSmartly 待回复消息进入统一收件箱,优先处理高意向询盘。',
      href: '/omnibox?channel=SALESMARTLY',
      linkLabel: '看 SaleSmartly 消息',
    }),
    makeChannelRow({
      key: 'chatwoot',
      name: 'Chatwoot 开源客服',
      mode: 'Webhook 入站 + CRM AI 草稿 + Chatwoot API 回发',
      configured: input.configured.cwOk,
      tokenExpired: false,
      tokenLabel: chatwootTokenLabel,
      dataCount: chatwoot.total,
      pendingCount: chatwoot.pending,
      lastSeenAt: chatwoot.lastSeenAt,
      setupAction: '部署/登录 Chatwoot 后填写 Base URL、Account ID、API Token,并配置 webhook 到 /api/chatwoot/webhook。',
      emptyAction: '在 Chatwoot 发一条测试会话,确认消息进入 CRM 统一收件箱并自动建客户。',
      staleAction: 'Chatwoot 超过 7 天无新消息,检查 webhook、Account ID、API Token 和 Chatwoot 任务队列。',
      pendingAction: 'Chatwoot 待回复会话进入统一收件箱,优先清高意向客户消息。',
      href: '/omnibox?channel=CHATWOOT',
      linkLabel: '看 Chatwoot 消息',
    }),
    makeChannelRow({
      key: 'alibaba',
      name: '阿里巴巴国际站',
      mode: 'OAuth + Webhook / 轮询订单消息',
      configured: input.configured.abOk,
      tokenExpired: isPast(input.st.alibabaTokenExpiresAt),
      tokenLabel: tokenLabel(input.configured.abOk, input.st.alibabaTokenExpiresAt),
      dataCount: alibaba.total,
      pendingCount: alibaba.pending,
      lastSeenAt: alibaba.lastSeenAt,
      setupAction: '先保存 AppKey/AppSecret,再点一键授权完成阿里 OAuth。',
      emptyAction: '完成阿里后台消息推送配置,用测试询盘确认入站。',
      staleAction: '阿里超过 7 天无新消息,检查 token、webhook 和平台权限。',
      pendingAction: '阿里询盘是高价值渠道,优先回复报价/索样/订单状态。',
      href: '/api/auth/alibaba/start',
      linkLabel: '发起阿里授权',
    }),
    makeChannelRow({
      key: 'amazon',
      name: 'Amazon SP-API',
      mode: 'LWA OAuth + SP-API 轮询',
      configured: input.configured.amzOk,
      tokenExpired: false,
      tokenLabel: input.configured.amzOk ? `${input.st.amazonRegion || process.env.AMAZON_REGION || 'na'} · ${input.st.amazonMarketplaceId || process.env.AMAZON_MARKETPLACE_ID || '默认站点'}` : '缺 LWA / AWS 凭据',
      dataCount: amazon.total,
      pendingCount: amazon.pending,
      lastSeenAt: amazon.lastSeenAt,
      setupAction: '补齐 LWA、AWS SigV4、Seller ID 和 Marketplace 后发起授权。',
      emptyAction: '授权后运行渠道轮询,确认 Amazon 订单/消息进入统一收件箱。',
      staleAction: 'Amazon 超过 7 天无新数据,检查 LWA refresh token 和 SP-API 权限。',
      pendingAction: 'Amazon 客户消息待回复,优先确认订单/售后/发货问题。',
      href: '/api/auth/amazon/start',
      linkLabel: '发起 Amazon 授权',
    }),
    makeChannelRow({
      key: 'shopee',
      name: 'Shopee 虾皮',
      mode: '店铺 OAuth + Push Webhook',
      configured: input.configured.spOk,
      tokenExpired: isPast(input.st.shopeeTokenExpiresAt),
      tokenLabel: tokenLabel(input.configured.spOk, input.st.shopeeTokenExpiresAt),
      dataCount: shopee.total,
      pendingCount: shopee.pending,
      lastSeenAt: shopee.lastSeenAt,
      setupAction: '保存 Partner ID/Key 后发起 Shopee 店铺授权。',
      emptyAction: '配置 Shopee Push URL,发送测试聊天确认入站。',
      staleAction: 'Shopee 超过 7 天无新消息,检查 token 刷新和 Push 配置。',
      pendingAction: 'Shopee 待回复消息进入统一收件箱逐条清理。',
      href: '/api/auth/shopee/start',
      linkLabel: '发起 Shopee 授权',
    }),
    makeChannelRow({
      key: 'facebook',
      name: 'Facebook Page / Messenger',
      mode: `${facebook.accountCount} 个 Page/账号 · Graph OAuth`,
      configured: input.configured.fbOk || facebook.accountCount > 0,
      tokenExpired: facebook.expired,
      tokenLabel: facebookTokenLabel,
      dataCount: facebook.dataCount + facebookInbox.total,
      pendingCount: facebookInbox.pending,
      lastSeenAt: maxDate(facebook.lastSeenAt, facebookInbox.lastSeenAt),
      setupAction: '配置 Facebook App 并完成 Page 一键授权。',
      emptyAction: '订阅 Page messages webhook,用 Messenger 测试消息确认入站。',
      staleAction: 'Facebook 超过 7 天无新消息,检查 Page 授权和 webhook 订阅。',
      pendingAction: 'Facebook Messenger 待回复,进入统一收件箱处理。',
      href: '/api/auth/facebook/start',
      linkLabel: '发起 Facebook 授权',
    }),
    makeChannelRow({
      key: 'instagram',
      name: 'Instagram Messaging',
      mode: `${instagram.accountCount} 个账号 · Meta Webhook`,
      configured: instagram.accountCount > 0,
      tokenExpired: instagram.expired,
      tokenLabel: instagram.accountCount > 0 ? `${instagram.accountCount} 个账号已授权` : input.configured.fbOk ? 'Meta App 已配置,待关联 Instagram 专业账号' : input.runtimeConfig.facebookAppIdOnly ? '已配置 Meta App ID,缺 App Secret' : '未配置 Meta App',
      dataCount: instagram.dataCount + instagramInbox.total,
      pendingCount: instagramInbox.pending,
      lastSeenAt: maxDate(instagram.lastSeenAt, instagramInbox.lastSeenAt),
      setupAction: '先将 Instagram 专业账号关联到 Facebook Page,再重新发起 Meta 授权。',
      emptyAction: '关联和授权完成后,用 Instagram 专业账号发送测试私信确认入站。',
      staleAction: 'Instagram 超过 7 天无新消息,检查 Instagram Messaging 权限、账号绑定和 webhook 订阅。',
      pendingAction: 'Instagram 私信待回复,进入统一收件箱处理。',
      href: '/api/auth/facebook/start',
      linkLabel: '重新发起 Meta 授权',
    }),
    makeChannelRow({
      key: 'linkedin',
      name: 'LinkedIn Lead Gen',
      mode: `${linkedin.accountCount} 个账号 · Lead Gen Forms`,
      configured: input.configured.liOk || linkedin.accountCount > 0,
      tokenExpired: linkedin.expired,
      tokenLabel: linkedInTokenLabel,
      dataCount: linkedin.dataCount + linkedinInbox.total,
      pendingCount: linkedinInbox.pending,
      lastSeenAt: maxDate(linkedin.lastSeenAt, linkedinInbox.lastSeenAt),
      setupAction: '配置 LinkedIn Client 并完成组织/Lead Sync 权限授权。',
      emptyAction: 'Lead Sync 权限通过后,拉取表单线索确认入库。',
      staleAction: 'LinkedIn 超过 7 天无新线索,检查产品权限、token 和表单归属。',
      pendingAction: 'LinkedIn 线索待处理,进入统一收件箱或客户列表分配负责人。',
      href: '/api/auth/linkedin/start',
      linkLabel: '发起 LinkedIn 授权',
    }),
    makeChannelRow({
      key: 'aftership',
      name: 'AfterShip 物流追踪',
      mode: 'API Key + 物流事件同步',
      configured: input.configured.aftershipOk,
      tokenExpired: false,
      tokenLabel: input.configured.aftershipOk ? (input.runtimeConfig.aftershipApi && !input.st.aftershipApiKey ? 'API Key 已配置(环境变量)' : 'API Key 已配置') : '未配置 API Key',
      dataCount: input.trackingEventCount,
      pendingCount: 0,
      lastSeenAt: input.latestTrackingAt,
      setupAction: '配置 AfterShip API Key,再同步未签收运单。',
      emptyAction: '运行物流同步,确认运单事件写入物流中心。',
      staleAction: '物流事件超过 7 天无更新,检查 AfterShip API Key 和运单状态。',
      pendingAction: '物流渠道无收件箱积压,关注异常运单即可。',
      href: '/logistics',
      linkLabel: '打开物流中心',
    }),
  ];
}

function summarizeChannelHealth(rows: ChannelHealthRow[]) {
  const total = rows.length;
  const configured = rows.filter((row) => row.configured).length;
  const flowing = rows.filter((row) => row.flowing).length;
  const fresh = rows.filter((row) => row.fresh).length;
  const pending = rows.reduce((sum, row) => sum + row.pendingCount, 0);
  const risks = rows.filter((row) => row.riskLevel === 'risk').length;
  const warnings = rows.filter((row) => row.riskLevel === 'warn').length;
  const healthScore = Math.max(0, Math.min(100, Math.round(100 - risks * 13 - warnings * 6 - Math.min(24, pending))));
  return {
    total,
    configured,
    flowing,
    fresh,
    pending,
    risks,
    healthScore,
    recommendation: channelHealthRecommendation({ total, configured, flowing, fresh, pending, risks, warnings }),
  };
}

function makeChannelRow(input: {
  key: string;
  name: string;
  mode: string;
  configured: boolean;
  tokenExpired: boolean;
  tokenLabel: string;
  dataCount: number;
  pendingCount: number;
  lastSeenAt: Date | null;
  setupAction: string;
  emptyAction: string;
  staleAction: string;
  pendingAction: string;
  href: string;
  linkLabel: string;
}): ChannelHealthRow {
  const fresh = isFresh(input.lastSeenAt, 7);
  const flowing = input.dataCount > 0;
  let riskLevel: ChannelHealthRow['riskLevel'] = 'ok';
  let status = '运行中';
  let action = '保持授权有效,继续监控统一收件箱和同步日志。';

  if (!input.configured) {
    riskLevel = 'risk';
    status = '缺授权';
    action = input.setupAction;
  } else if (input.tokenExpired) {
    riskLevel = 'risk';
    status = '授权过期';
    action = '重新发起 OAuth 授权或刷新平台 token。';
  } else if (!flowing) {
    riskLevel = 'warn';
    status = '待验证';
    action = input.emptyAction;
  } else if (!fresh) {
    riskLevel = 'warn';
    status = '疑似断流';
    action = input.staleAction;
  } else if (input.pendingCount > 0) {
    riskLevel = 'warn';
    status = '有积压';
    action = input.pendingAction;
  }

  return {
    ...input,
    status,
    action,
    flowing,
    fresh,
    riskLevel,
    lastSeenLabel: input.lastSeenAt ? formatShortDate(input.lastSeenAt) : '暂无',
    toneClass: riskLevel === 'ok' ? 'bg-emerald-50 text-emerald-700' : riskLevel === 'warn' ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700',
  };
}

function socialSummary(accounts: SocialAccountHealth[], platform: SocialPlatform) {
  const rows = accounts.filter((account) => account.platform === platform);
  return {
    accountCount: rows.length,
    dataCount: rows.reduce((sum, account) => sum + account._count.messages, 0),
    lastSeenAt: maxDate(...rows.map((account) => account.messages[0]?.createdAt || null)),
    expired: rows.some((account) => isPast(account.expiresAt)),
  };
}

function channelHealthRecommendation(input: { total: number; configured: number; flowing: number; fresh: number; pending: number; risks: number; warnings: number }) {
  if (input.risks > 0) return `还有 ${input.risks} 个渠道缺授权或授权过期。先补齐这些渠道,否则客户消息不会稳定进入 CRM。`;
  if (input.flowing < input.configured) return `已配置 ${input.configured} 个渠道,但只有 ${input.flowing} 个有数据流入。逐个做测试消息/同步验证。`;
  if (input.pending > 0) return `统一收件箱还有 ${input.pending} 条待回复消息。先清 SLA 积压,再继续接新渠道。`;
  if (input.fresh < input.flowing) return '部分渠道超过 7 天没有新数据。检查 webhook、轮询任务和平台授权是否仍有效。';
  if (input.configured === input.total) return '所有核心渠道均已配置并处于可监控状态。继续保持每日巡检和授权到期复核。';
  return '核心渠道健康度可控。下一步补齐未配置渠道,并用测试消息验证入站闭环。';
}

function tokenLabel(configured: boolean, expiresAt: Date | string | null | undefined) {
  if (!configured) return '未授权';
  if (!expiresAt) return '已配置,无到期时间';
  if (isPast(expiresAt)) return `已过期 ${formatShortDate(expiresAt)}`;
  return `到期 ${formatShortDate(expiresAt)}`;
}

function isPast(value: Date | string | null | undefined) {
  if (!value) return false;
  return new Date(value).getTime() < Date.now();
}

function isFresh(value: Date | string | null | undefined, days: number) {
  if (!value) return false;
  return Date.now() - new Date(value).getTime() <= days * 86400000;
}

function maxDate(...values: Array<Date | string | null | undefined>) {
  const times = values
    .filter(Boolean)
    .map((value) => new Date(value as Date | string))
    .filter((value) => Number.isFinite(value.getTime()));
  if (times.length === 0) return null;
  return new Date(Math.max(...times.map((value) => value.getTime())));
}

function formatShortDate(value: Date | string) {
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function ChannelHealthMetric({ label, value, detail, tone }: { label: string; value: number | string; detail: string; tone: 'blue' | 'emerald' | 'amber' | 'rose' | 'slate' }) {
  const color = {
    blue: 'border-blue-100 bg-blue-50 text-blue-800',
    emerald: 'border-emerald-100 bg-emerald-50 text-emerald-800',
    amber: 'border-amber-100 bg-amber-50 text-amber-800',
    rose: 'border-rose-100 bg-rose-50 text-rose-800',
    slate: 'border-slate-100 bg-slate-50 text-slate-800',
  };
  return (
    <div className={`rounded-xl border p-3 ${color[tone]}`}>
      <div className="text-xs font-bold opacity-70">{label}</div>
      <div className="mt-1 text-xl font-black">{value}</div>
      <div className="mt-1 text-[11px] font-bold opacity-70">{detail}</div>
    </div>
  );
}

function RuntimeConfigHint({ text, tone = 'emerald' }: { text: string; tone?: 'emerald' | 'amber' }) {
  const color = tone === 'amber' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700';
  return (
    <div className={`mb-4 rounded-lg border px-3 py-2 text-xs font-semibold ${color}`}>
      {text}
    </div>
  );
}

function Field({ name, label, defaultValue, placeholder, type = 'text' }: { name: string; label: string; defaultValue?: string | null; placeholder?: string; type?: string }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-gray-700 mb-1.5">{label}</label>
      <input
        type={type}
        name={name}
        defaultValue={type === 'password' ? '' : defaultValue || ''}
        placeholder={placeholder || (defaultValue && type === 'password' ? '已配置，留空保持原值' : '')}
        autoComplete="off"
        className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500"
      />
    </div>
  );
}

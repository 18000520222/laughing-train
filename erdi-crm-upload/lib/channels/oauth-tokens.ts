// lib/channels/oauth-tokens.ts — 各渠道 access_token 自动刷新中心
//
// 三家平台的 access_token 都会过期，需要用 refresh_token 续期：
//   - Alibaba: access_token 有效期较长(天级)，refresh_token 续期
//   - Amazon LWA: access_token 1h 过期，refresh_token 长期有效
//   - Shopee: access_token 4h 过期，refresh_token 续期
//
// 统一约定：getXxxAccessToken() 返回一个"保证有效"的 access_token，
// 内部判断是否快过期(留 5 分钟余量)，过期则刷新并回写 SystemSettings。

import { prisma } from '@/lib/prisma';
import crypto from 'crypto';

const SAFETY_WINDOW_MS = 5 * 60 * 1000; // 提前 5 分钟刷新

async function getSettings() {
  return prisma.systemSettings.findUnique({ where: { id: 'default' } });
}

function expired(at: Date | null | undefined): boolean {
  if (!at) return true;
  return at.getTime() - SAFETY_WINDOW_MS <= Date.now();
}

// ---------------- Alibaba ----------------
// 刷新端点(新版国际站网关)：/auth/token/refresh
const ALIBABA_GATEWAY = 'https://openapi-api.alibaba.com/rest';
const ALIBABA_TOKEN_TIMEOUT_MS = 8000;

export async function getAlibabaAccessToken(): Promise<string | null> {
  const s = await getSettings();
  if (!s?.alibabaAppKey || !s?.alibabaAppSecret) return null;
  if (s.alibabaAccessToken && !expired(s.alibabaTokenExpiresAt)) {
    return s.alibabaAccessToken;
  }
  if (!s.alibabaRefreshToken) return s.alibabaAccessToken || null;

  try {
    const apiPath = '/auth/token/refresh';
    const params: Record<string, string> = {
      app_key: s.alibabaAppKey,
      refresh_token: s.alibabaRefreshToken,
      timestamp: String(Date.now()),
      sign_method: 'sha256',
    };
    const sign = aliSign(params, s.alibabaAppSecret, apiPath);
    const res = await fetch(`${ALIBABA_GATEWAY}${apiPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...params, sign }).toString(),
      signal: AbortSignal.timeout(ALIBABA_TOKEN_TIMEOUT_MS),
    });
    const data: any = await res.json();
    const accessToken = data.access_token || data.accessToken;
    if (!accessToken) return s.alibabaAccessToken || null;
    const expiresInSec = Number(data.expires_in || data.expire_time || 86400);
    await prisma.systemSettings.update({
      where: { id: 'default' },
      data: {
        alibabaAccessToken: accessToken,
        alibabaRefreshToken: data.refresh_token || s.alibabaRefreshToken,
        alibabaTokenExpiresAt: new Date(Date.now() + expiresInSec * 1000),
      },
    });
    return accessToken;
  } catch {
    return s.alibabaAccessToken || null;
  }
}

export function aliSign(params: Record<string, string>, appSecret: string, apiPath: string): string {
  const keys = Object.keys(params).sort();
  let base = apiPath;
  for (const k of keys) base += k + params[k];
  return crypto.createHmac('sha256', appSecret).update(base, 'utf8').digest('hex').toUpperCase();
}

// ---------------- Amazon LWA ----------------
const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';

export async function getAmazonAccessToken(): Promise<string | null> {
  const s = await getSettings();
  if (!s?.amazonLwaClientId || !s?.amazonLwaClientSecret || !s?.amazonRefreshToken) return null;
  // LWA access_token 1h 过期，简单做法：每次都换(也可缓存，这里走 refresh 保证有效)
  try {
    const res = await fetch(LWA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: s.amazonRefreshToken,
        client_id: s.amazonLwaClientId,
        client_secret: s.amazonLwaClientSecret,
      }).toString(),
      signal: AbortSignal.timeout(15000),
    });
    const data: any = await res.json();
    return data.access_token || null;
  } catch {
    return null;
  }
}

// ---------------- Shopee ----------------
export async function getShopeeAccessToken(): Promise<string | null> {
  const s = await getSettings();
  if (!s?.shopeePartnerId || !s?.shopeePartnerKey || !s?.shopeeShopId) return null;
  if (s.shopeeAccessToken && !expired(s.shopeeTokenExpiresAt)) {
    return s.shopeeAccessToken;
  }
  if (!s.shopeeRefreshToken) return s.shopeeAccessToken || null;

  try {
    const base = s.shopeeRegion || 'https://partner.shopeemobile.com';
    const apiPath = '/api/v2/auth/access_token/get';
    const ts = Math.floor(Date.now() / 1000);
    const baseString = `${s.shopeePartnerId}${apiPath}${ts}`;
    const sign = crypto.createHmac('sha256', s.shopeePartnerKey).update(baseString, 'utf8').digest('hex');
    const url = `${base}${apiPath}?partner_id=${s.shopeePartnerId}&timestamp=${ts}&sign=${sign}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        partner_id: Number(s.shopeePartnerId),
        shop_id: Number(s.shopeeShopId),
        refresh_token: s.shopeeRefreshToken,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data: any = await res.json();
    const accessToken = data.access_token;
    if (!accessToken) return s.shopeeAccessToken || null;
    const expireSec = Number(data.expire_in || 14400); // 默认 4h
    await prisma.systemSettings.update({
      where: { id: 'default' },
      data: {
        shopeeAccessToken: accessToken,
        shopeeRefreshToken: data.refresh_token || s.shopeeRefreshToken,
        shopeeTokenExpiresAt: new Date(Date.now() + expireSec * 1000),
      },
    });
    return accessToken;
  } catch {
    return s.shopeeAccessToken || null;
  }
}

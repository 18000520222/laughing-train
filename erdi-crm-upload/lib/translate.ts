// lib/translate.ts — LibreTranslate 客户端封装
// 默认调用公共实例 https://libretranslate.com，可在 SystemSettings.libretranslateUrl 配置自建地址

const DEFAULT_URL = process.env.LIBRETRANSLATE_URL || 'https://libretranslate.com';

export interface TranslateResult {
  translatedText: string;
  detectedLanguage?: string;
}

/**
 * 翻译单段文本。失败时返回原文，绝不抛错（避免阻塞主流程，如 webhook 入库）。
 */
export async function translateText(
  text: string,
  target: string = 'zh',
  source: string = 'auto',
  baseUrl: string = DEFAULT_URL
): Promise<TranslateResult> {
  if (!text || text.trim().length === 0) {
    return { translatedText: text };
  }

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: text,
        source,
        target,
        format: 'text',
      }),
      // 防止 webhook 卡住超过 8s
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return { translatedText: text };
    }

    const data = await res.json();
    return {
      translatedText: data.translatedText || text,
      detectedLanguage: data.detectedLanguage?.language,
    };
  } catch (err) {
    console.error('[translate] error:', err);
    return { translatedText: text };
  }
}

/**
 * 批量翻译（顺序调用，避免触发 LibreTranslate rate limit）
 */
export async function translateBatch(
  texts: string[],
  target: string = 'zh'
): Promise<string[]> {
  const out: string[] = [];
  for (const t of texts) {
    const r = await translateText(t, target);
    out.push(r.translatedText);
  }
  return out;
}

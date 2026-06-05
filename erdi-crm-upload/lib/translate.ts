// lib/translate.ts — 多引擎翻译封装
//
// 优先级:有 LLM key → 用 LLM 翻译(外贸语境最佳、任意语种);
//        否则 → 降级 LibreTranslate(免费公共实例)。
// 失败时一律返回原文,绝不抛错(避免阻塞 webhook 等主流程)。
//
// 现有调用方(WhatsApp / Facebook webhook)签名不变,自动升级。

import { chat, isLLMAvailable } from '@/lib/llm';

const DEFAULT_URL = process.env.LIBRETRANSLATE_URL || 'https://libretranslate.com';

// 语言代码 → 自然语言名称(喂给 LLM,比裸代码效果好)
const LANG_NAMES: Record<string, string> = {
  zh: '简体中文',
  en: '英语',
  es: '西班牙语',
  fr: '法语',
  de: '德语',
  ru: '俄语',
  ar: '阿拉伯语',
  pt: '葡萄牙语',
  it: '意大利语',
  ja: '日语',
  ko: '韩语',
  vi: '越南语',
  th: '泰语',
  id: '印尼语',
  tr: '土耳其语',
  nl: '荷兰语',
  auto: '自动检测的源语言',
};

function langName(code: string): string {
  return LANG_NAMES[code] || code;
}

export interface TranslateResult {
  translatedText: string;
  detectedLanguage?: string;
  engine?: 'llm' | 'libre' | 'none';
}

/**
 * 翻译单段文本。target/source 用 ISO 语言代码('auto' 表示自动检测源语言)。
 */
export async function translateText(
  text: string,
  target: string = 'zh',
  source: string = 'auto',
  baseUrl: string = DEFAULT_URL
): Promise<TranslateResult> {
  if (!text || text.trim().length === 0) {
    return { translatedText: text, engine: 'none' };
  }

  if (isLLMAvailable()) {
    try {
      return await translateWithLLM(text, target, source);
    } catch (err) {
      console.error('[translate] LLM failed, falling back to libre:', err);
      // 继续走 LibreTranslate
    }
  }

  return translateWithLibre(text, target, source, baseUrl);
}

async function translateWithLLM(
  text: string,
  target: string,
  source: string
): Promise<TranslateResult> {
  const srcHint =
    source === 'auto' ? '自动检测源语言' : `源语言为${langName(source)}`;

  const system =
    'You are a professional foreign-trade / e-commerce translation engine. ' +
    'Output ONLY the translated text, nothing else. ' +
    'Keep product model numbers, figures and units unchanged. Tone: natural, business, polite.';

  const user =
    `Translate into ${langName(target)} (${srcHint}), output translation only:\n\n${text}`;

  const out = await chat(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { temperature: 0.2, timeoutMs: 15000 }
  );

  return { translatedText: out || text, engine: 'llm' };
}

async function translateWithLibre(
  text: string,
  target: string,
  source: string,
  baseUrl: string
): Promise<TranslateResult> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: text, source, target, format: 'text' }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return { translatedText: text, engine: 'none' };

    const data = await res.json();
    return {
      translatedText: data.translatedText || text,
      detectedLanguage: data.detectedLanguage?.language,
      engine: 'libre',
    };
  } catch (err) {
    console.error('[translate] libre error:', err);
    return { translatedText: text, engine: 'none' };
  }
}

/**
 * 把中文回复翻译成客户的语言(自动回复/发送时用)。
 * targetLang 为空或为 zh 时直接返回原文。
 */
export async function translateReply(
  chineseText: string,
  targetLang: string
): Promise<string> {
  if (!targetLang || targetLang === 'zh' || targetLang === 'auto') {
    return chineseText;
  }
  const r = await translateText(chineseText, targetLang, 'zh');
  return r.translatedText;
}

/**
 * 批量翻译(顺序调用,避免触发限流)。
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

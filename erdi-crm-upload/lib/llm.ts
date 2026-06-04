// lib/llm.ts — 统一 LLM 调用层(多 provider 自动选择 + 降级)
//
// 设计目标:整套自动化(翻译 + AI 回复)只依赖这一个入口。
// 通过环境变量决定用哪家,优先级:OPENAI > DEEPSEEK > GEMINI。
// 任一 key 都没有时,isLLMAvailable() 返回 false,上层据此降级
// (例如翻译降级回 LibreTranslate,自动回复直接跳过)。
//
// 三家都兼容 OpenAI Chat Completions 风格(Gemini 走其 OpenAI 兼容端点),
// 所以只用一套调用代码。

export type LLMProvider = 'openai' | 'deepseek' | 'gemini';

interface ProviderConfig {
  provider: LLMProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
}

/**
 * 根据环境变量解析当前可用的 provider。返回 null 表示没有任何可用 key。
 * 可用 LLM_PROVIDER 环境变量强制指定(openai/deepseek/gemini)。
 */
export function resolveProvider(): ProviderConfig | null {
  const forced = (process.env.LLM_PROVIDER || '').toLowerCase() as LLMProvider | '';

  const openaiKey = process.env.OPENAI_API_KEY;
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  const build = (p: LLMProvider): ProviderConfig | null => {
    switch (p) {
      case 'openai':
        if (!openaiKey) return null;
        return {
          provider: 'openai',
          apiKey: openaiKey,
          baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
          model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        };
      case 'deepseek':
        if (!deepseekKey) return null;
        return {
          provider: 'deepseek',
          apiKey: deepseekKey,
          baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
          model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
        };
      case 'gemini':
        if (!geminiKey) return null;
        return {
          provider: 'gemini',
          apiKey: geminiKey,
          baseUrl:
            process.env.GEMINI_BASE_URL ||
            'https://generativelanguage.googleapis.com/v1beta/openai',
          model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
        };
    }
  };

  if (forced) {
    const c = build(forced);
    if (c) return c;
  }
  return build('openai') || build('deepseek') || build('gemini');
}

export function isLLMAvailable(): boolean {
  return resolveProvider() !== null;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  /** 强制要求模型输出 JSON(用于结构化结果,如意图识别) */
  json?: boolean;
  timeoutMs?: number;
}

/**
 * 统一聊天补全。失败抛错由调用方决定降级策略。
 */
export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  const cfg = resolveProvider();
  if (!cfg) {
    throw new Error('NO_LLM_PROVIDER');
  }

  const body: Record<string, unknown> = {
    model: cfg.model,
    messages,
    temperature: opts.temperature ?? 0.3,
  };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  if (opts.json) body.response_format = { type: 'json_object' };

  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`LLM_HTTP_${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('LLM_EMPTY_RESPONSE');
  }
  return content.trim();
}

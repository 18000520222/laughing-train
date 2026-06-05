// 临时:在生产 runtime 验证 LLM(tommyapi)是否真生效。用完即删。
import { NextResponse } from 'next/server';
import { isLLMAvailable } from '@/lib/llm';
import { translateText } from '@/lib/translate';

const KEY = 'llmcheck-erdi-2026';

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get('key') !== KEY) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const available = isLLMAvailable();
  let result: unknown = null;
  let err = '';
  try {
    result = await translateText('What is the MOQ for your laser rangefinder?', 'zh');
  } catch (e: any) {
    err = String(e?.message || e);
  }
  return NextResponse.json({
    llmAvailable: available,
    model: process.env.OPENAI_MODEL,
    baseUrl: process.env.OPENAI_BASE_URL,
    keyTail: (process.env.OPENAI_API_KEY || '').slice(-6),
    translateResult: result,
    error: err,
  });
}

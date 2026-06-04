// lib/autoreply.ts — AI 自动回复 / 询盘应答
//
// 输入:客户原文(任意语言) + 可选上下文(历史消息、客户/公司信息)
// 输出:意图分类 + 中文回复草稿 + 客户语言回复 + 检测到的客户语言
//
// 无 LLM key 时返回 available=false,上层据此跳过自动回复(只保留翻译)。

import { chat, isLLMAvailable } from '@/lib/llm';
import { translateReply } from '@/lib/translate';

export type Intent =
  | 'PRICE_INQUIRY' // 询价
  | 'PRODUCT_QUESTION' // 产品咨询/规格
  | 'ORDER_STATUS' // 订单/物流状态
  | 'SAMPLE_REQUEST' // 索样
  | 'COMPLAINT' // 投诉/售后
  | 'GREETING' // 寒暄/打招呼
  | 'SPAM' // 垃圾/无关
  | 'OTHER';

export interface AutoReplyContext {
  /** 客户最新一条原文消息 */
  message: string;
  /** 历史对话(可选,按时间正序,每条 "客户: ..." 或 "我方: ...") */
  history?: string[];
  /** 客户/公司背景信息(可选,如公司名、国家、过往订单) */
  contactInfo?: string;
  /** 公司/业务背景(可选,产品线、主营、报价口径) */
  businessInfo?: string;
}

export interface AutoReplyResult {
  available: boolean; // 是否成功生成(无 key 或失败为 false)
  intent: Intent;
  detectedLang: string; // 客户语言 ISO 代码,如 en/es/ar
  confidence: number; // 0-1
  shouldAutoSend: boolean; // 模型建议是否可直接自动发(简单/标准问题为 true)
  replyZh: string; // 中文回复草稿(给业务员看)
  replyCustomer: string; // 译成客户语言的回复(实际发送内容)
  reason?: string; // 简短说明(为何这样回 / 为何不建议自动发)
}

const SYSTEM_PROMPT = `你是 ERDI 外贸公司的资深外贸客服 AI 助手。客户来自全球,使用各种语言。
你的任务:阅读客户消息,判断意图,起草一条专业、礼貌、商务的回复。

要求:
1. 检测客户使用的语言(返回 ISO 639-1 代码,如 en/es/ar/ru/pt/fr/de/vi)。
2. 对意图分类:PRICE_INQUIRY/PRODUCT_QUESTION/ORDER_STATUS/SAMPLE_REQUEST/COMPLAINT/GREETING/SPAM/OTHER。
3. 用中文起草回复内容(replyZh),供中国业务员审阅。
4. 判断这条回复是否适合"全自动直接发送"(shouldAutoSend):
   - 标准寒暄、常规产品介绍、引导提供需求等低风险内容 → true
   - 涉及具体报价/价格承诺、交期承诺、投诉处理、合同条款 → false(必须人工确认)
   - SPAM → false
5. 不要编造价格、库存、交期等具体数字;需要这些时,礼貌引导客户提供详情或表示稍后由专人跟进。

只输出 JSON,字段:
{"detectedLang":"en","intent":"PRICE_INQUIRY","confidence":0.0-1.0,"shouldAutoSend":true/false,"replyZh":"中文回复","reason":"简短说明"}`;

export async function generateAutoReply(ctx: AutoReplyContext): Promise<AutoReplyResult> {
  const fallback: AutoReplyResult = {
    available: false,
    intent: 'OTHER',
    detectedLang: 'auto',
    confidence: 0,
    shouldAutoSend: false,
    replyZh: '',
    replyCustomer: '',
  };

  if (!isLLMAvailable() || !ctx.message?.trim()) {
    return fallback;
  }

  const parts: string[] = [];
  if (ctx.businessInfo) parts.push(`【我方业务背景】\n${ctx.businessInfo}`);
  if (ctx.contactInfo) parts.push(`【客户背景】\n${ctx.contactInfo}`);
  if (ctx.history?.length) {
    parts.push(`【历史对话】\n${ctx.history.slice(-10).join('\n')}`);
  }
  parts.push(`【客户最新消息】\n${ctx.message}`);

  try {
    const raw = await chat(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: parts.join('\n\n') },
      ],
      { temperature: 0.4, json: true, timeoutMs: 25000 }
    );

    const parsed = safeParse(raw);
    if (!parsed) return fallback;

    const detectedLang = String(parsed.detectedLang || 'auto').toLowerCase();
    const replyZh = String(parsed.replyZh || '').trim();
    if (!replyZh) return fallback;

    // 把中文草稿译成客户语言(实际发送内容)
    const replyCustomer = await translateReply(replyZh, detectedLang);

    return {
      available: true,
      intent: normalizeIntent(parsed.intent),
      detectedLang,
      confidence: clamp01(Number(parsed.confidence)),
      shouldAutoSend: Boolean(parsed.shouldAutoSend),
      replyZh,
      replyCustomer,
      reason: parsed.reason ? String(parsed.reason) : undefined,
    };
  } catch (err) {
    console.error('[autoreply] error:', err);
    return fallback;
  }
}

function safeParse(raw: string): any | null {
  try {
    return JSON.parse(raw);
  } catch {
    // 容错:截取第一个 { 到最后一个 }
    const s = raw.indexOf('{');
    const e = raw.lastIndexOf('}');
    if (s >= 0 && e > s) {
      try {
        return JSON.parse(raw.slice(s, e + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeIntent(v: unknown): Intent {
  const valid: Intent[] = [
    'PRICE_INQUIRY',
    'PRODUCT_QUESTION',
    'ORDER_STATUS',
    'SAMPLE_REQUEST',
    'COMPLAINT',
    'GREETING',
    'SPAM',
    'OTHER',
  ];
  const s = String(v || '').toUpperCase() as Intent;
  return valid.includes(s) ? s : 'OTHER';
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

'use client';

import { useState, useMemo } from 'react';

interface Msg {
  id: string;
  channel: string;
  senderId: string;
  senderName?: string | null;
  originalText: string;
  detectedLang?: string | null;
  translatedText?: string | null;
  intent?: string | null;
  aiReplyZh?: string | null;
  aiReplyCustomer?: string | null;
  aiAutoSendable: boolean;
  status: string;
  createdAt: string;
  company?: {
    id: string;
    name: string;
    country?: string | null;
    customerCode?: string | null;
    owner?: { name?: string | null; email?: string | null } | null;
  } | null;
}

const CHANNEL_LABEL: Record<string, string> = {
  EMAIL: '邮件',
  WHATSAPP: 'WhatsApp',
  ALIBABA: '阿里国际站',
  AMAZON: '亚马逊',
  SHOPEE: '虾皮',
  FACEBOOK: 'Facebook',
  LINKEDIN: 'LinkedIn',
};
const CHANNEL_COLOR: Record<string, string> = {
  EMAIL: 'bg-indigo-100 text-indigo-700',
  WHATSAPP: 'bg-green-100 text-green-700',
  ALIBABA: 'bg-orange-100 text-orange-700',
  AMAZON: 'bg-yellow-100 text-yellow-700',
  SHOPEE: 'bg-red-100 text-red-700',
  FACEBOOK: 'bg-blue-100 text-blue-700',
  LINKEDIN: 'bg-sky-100 text-sky-700',
};
const INTENT_LABEL: Record<string, string> = {
  PRICE_INQUIRY: '询价',
  PRODUCT_QUESTION: '产品咨询',
  ORDER_STATUS: '订单状态',
  SAMPLE_REQUEST: '索样',
  COMPLAINT: '投诉',
  GREETING: '寒暄',
  SPAM: '垃圾',
  OTHER: '其他',
};
const STATUS_LABEL: Record<string, string> = {
  NEW: '新消息',
  AI_DRAFTED: 'AI草稿待确认',
  REPLIED: '已回复',
  ARCHIVED: '已归档',
};

export default function OmniboxClient({
  initialMessages,
  counts,
}: {
  initialMessages: Msg[];
  counts: { all: number; NEW: number; AI_DRAFTED: number; REPLIED: number };
}) {
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  const [channelFilter, setChannelFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sending, setSending] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      messages.filter(
        (m) =>
          (!channelFilter || m.channel === channelFilter) &&
          (!statusFilter || m.status === statusFilter)
      ),
    [messages, channelFilter, statusFilter]
  );

  async function send(m: Msg) {
    const replyZh = drafts[m.id] ?? m.aiReplyZh ?? '';
    if (!replyZh.trim()) {
      alert('回复内容不能为空');
      return;
    }
    setSending(m.id);
    try {
      const res = await fetch('/api/omnibox/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inboxId: m.id, replyZh }),
      });
      const data = await res.json();
      if (data.error) {
        alert('发送失败: ' + data.error);
      } else {
        setMessages((prev) =>
          prev.map((x) =>
            x.id === m.id ? { ...x, status: 'REPLIED', aiReplyCustomer: data.sentText, aiReplyZh: replyZh } : x
          )
        );
        alert('已发送(自动译为客户语言):\n' + data.sentText);
      }
    } catch {
      alert('网络错误');
    } finally {
      setSending(null);
    }
  }

  const channels = ['', 'EMAIL', 'WHATSAPP', 'ALIBABA', 'AMAZON', 'SHOPEE', 'FACEBOOK', 'LINKEDIN'];
  const statuses = ['', 'NEW', 'AI_DRAFTED', 'REPLIED'];

  return (
    <div>
      {/* 过滤栏 */}
      <div className="flex flex-wrap gap-2 mb-4">
        {channels.map((c) => (
          <button
            key={c || 'all'}
            onClick={() => setChannelFilter(c)}
            className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${
              channelFilter === c ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            {c ? CHANNEL_LABEL[c] : '全部渠道'}
          </button>
        ))}
        <span className="w-px bg-gray-200 mx-1" />
        {statuses.map((s) => (
          <button
            key={s || 'allstatus'}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${
              statusFilter === s ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            {s ? STATUS_LABEL[s] : '全部状态'}
          </button>
        ))}
      </div>

      {/* 消息列表 */}
      <div className="space-y-4">
        {filtered.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-12 text-center text-gray-500">
            <span className="text-4xl mb-4 block">📭</span>
            暂无消息。客户通过任意渠道发来消息后会自动汇聚到这里。
          </div>
        ) : (
          filtered.map((m) => (
            <div key={m.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              {/* 头部 */}
              <div className="flex justify-between items-start mb-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs font-bold px-2 py-1 rounded ${CHANNEL_COLOR[m.channel] || 'bg-gray-100 text-gray-600'}`}>
                    {CHANNEL_LABEL[m.channel] || m.channel}
                  </span>
                  <span className="text-xs font-mono px-2 py-1 rounded bg-slate-100 text-slate-500">
                    INQ-{new Date(m.createdAt).getFullYear()}-{m.id.slice(-6).toUpperCase()}
                  </span>
                  <span className="font-bold text-gray-800">{m.senderName || m.senderId}</span>
                  {m.company && (
                    <span className="text-xs px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded">
                      🏢 {m.company.customerCode ? `${m.company.customerCode} · ` : ''}{m.company.name}
                    </span>
                  )}
                  {m.company?.owner && (
                    <span className="text-xs px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded">
                      负责人:{m.company.owner.name || m.company.owner.email}
                    </span>
                  )}
                  {m.detectedLang && m.detectedLang !== 'auto' && (
                    <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded uppercase">{m.detectedLang}</span>
                  )}
                  {m.intent && (
                    <span className="text-xs px-2 py-0.5 bg-purple-50 text-purple-600 rounded">
                      {INTENT_LABEL[m.intent] || m.intent}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded ${
                    m.status === 'REPLIED' ? 'bg-green-50 text-green-600'
                    : m.status === 'AI_DRAFTED' ? 'bg-amber-50 text-amber-600'
                    : 'bg-blue-50 text-blue-600'
                  }`}>
                    {STATUS_LABEL[m.status] || m.status}
                  </span>
                  <span className="text-xs text-gray-400">{new Date(m.createdAt).toLocaleString()}</span>
                </div>
              </div>

              {/* 原文 + 中文对照 */}
              <div className="grid md:grid-cols-2 gap-3 mb-3">
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-400 mb-1">客户原文</div>
                  <div className="text-sm text-gray-700 whitespace-pre-wrap">{m.originalText}</div>
                </div>
                <div className="bg-blue-50/50 rounded-lg p-3">
                  <div className="text-xs text-gray-400 mb-1">中文翻译</div>
                  <div className="text-sm text-gray-800 whitespace-pre-wrap">{m.translatedText || '—'}</div>
                </div>
              </div>

              {/* 回复区 */}
              {m.status !== 'REPLIED' ? (
                <div className="border-t border-gray-100 pt-3">
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-xs text-gray-400">
                      AI 回复草稿(中文,可编辑;发送时自动译为客户语言)
                      {m.aiAutoSendable && <span className="ml-2 text-green-600">· AI建议可自动发</span>}
                    </div>
                  </div>
                  <textarea
                    className="w-full text-sm border border-gray-200 rounded-lg p-3 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    rows={3}
                    value={drafts[m.id] ?? m.aiReplyZh ?? ''}
                    placeholder={m.aiReplyZh ? '' : 'AI 未生成草稿(可能无 LLM key 或仅翻译模式),可手动输入中文回复'}
                    onChange={(e) => setDrafts((d) => ({ ...d, [m.id]: e.target.value }))}
                  />
                  {m.aiReplyCustomer && (
                    <div className="text-xs text-gray-400 mt-1">
                      AI 译文预览({m.detectedLang}):{m.aiReplyCustomer}
                    </div>
                  )}
                  <div className="flex justify-end mt-2">
                    <button
                      onClick={() => send(m)}
                      disabled={sending === m.id}
                      className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                      {sending === m.id ? '发送中...' : '确认并发送'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="border-t border-gray-100 pt-3 text-sm">
                  <div className="text-xs text-gray-400 mb-1">已发送回复</div>
                  <div className="text-gray-700">{m.aiReplyZh}</div>
                  {m.aiReplyCustomer && <div className="text-gray-400 text-xs mt-1">→ {m.aiReplyCustomer}</div>}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

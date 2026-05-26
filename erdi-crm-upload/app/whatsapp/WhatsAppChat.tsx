 // app/whatsapp/WhatsAppChat.tsx
'use client';
import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Send, MessageCircle, Languages, Search } from 'lucide-react';

interface Conv {
  phoneNumber: string;
  contactName: string;
  companyId?: string;
  companyName?: string;
  lastMessage: string;
  lastAt: string;
}

interface Msg {
  id: string;
  direction: 'IN' | 'OUT';
  phoneNumber: string;
  body: string;
  translated?: string;
  createdAt: string;
  contactName?: string;
}

export default function WhatsAppChat({
  conversations,
  allMessages,
}: {
  conversations: Conv[];
  allMessages: Msg[];
}) {
  const [activePhone, setActivePhone] = useState<string | null>(conversations[0]?.phoneNumber || null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [showTranslated, setShowTranslated] = useState(true);
  const [search, setSearch] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [showNew, setShowNew] = useState(false);

  const activeMessages = useMemo(() => {
    if (!activePhone) return [];
    return allMessages
      .filter(m => m.phoneNumber === activePhone)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [activePhone, allMessages]);

  const activeConv = conversations.find(c => c.phoneNumber === activePhone);

  const filteredConvs = conversations.filter(c =>
    !search ||
    c.contactName.toLowerCase().includes(search.toLowerCase()) ||
    c.phoneNumber.includes(search)
  );

  async function sendMessage() {
    const phone = activePhone || newPhone;
    if (!phone || !draft.trim()) return;
    setSending(true);
    try {
      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: phone, text: draft }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert('发送失败：' + JSON.stringify(data.error));
      } else {
        setDraft('');
        location.reload();
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <MessageCircle className="text-green-600" size={28} />
          <h1 className="text-xl font-bold text-gray-800">WhatsApp 客户消息</h1>
          <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">自动翻译为中文</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowTranslated(s => !s)}
            className="flex items-center gap-2 px-3 py-1.5 border rounded-lg text-sm hover:bg-gray-50"
          >
            <Languages size={16} />
            {showTranslated ? '显示译文' : '显示原文'}
          </button>
          <Link href="/dashboard" className="text-sm text-gray-600 hover:text-gray-900">← 返回工作台</Link>
        </div>
      </header>

      <div className="flex h-[calc(100vh-65px)]">
        {/* 左侧联系人 */}
        <aside className="w-80 border-r bg-white flex flex-col">
          <div className="p-3 border-b space-y-2">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="搜索联系人或手机号"
                className="w-full pl-9 pr-3 py-2 text-sm border rounded-lg"
              />
            </div>
            <button
              onClick={() => setShowNew(s => !s)}
              className="w-full py-2 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium"
            >
              + 发起新对话
            </button>
            {showNew && (
              <input
                value={newPhone}
                onChange={e => setNewPhone(e.target.value)}
                placeholder="国际格式手机号，如 +14155552671"
                className="w-full px-3 py-2 text-sm border rounded-lg"
              />
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {filteredConvs.length === 0 && (
              <div className="p-6 text-center text-gray-400 text-sm">暂无对话</div>
            )}
            {filteredConvs.map(c => (
              <button
                key={c.phoneNumber}
                onClick={() => setActivePhone(c.phoneNumber)}
                className={`w-full text-left p-4 border-b hover:bg-gray-50 ${activePhone === c.phoneNumber ? 'bg-green-50 border-l-4 border-l-green-500' : ''}`}
              >
                <div className="flex justify-between items-center mb-1">
                  <span className="font-medium text-gray-900 truncate">{c.contactName}</span>
                  <span className="text-xs text-gray-400">{new Date(c.lastAt).toLocaleDateString()}</span>
                </div>
                <div className="text-xs text-gray-500">{c.phoneNumber}</div>
                {c.companyName && <div className="text-xs text-blue-600 mt-0.5">🏢 {c.companyName}</div>}
                <div className="text-sm text-gray-600 truncate mt-1">{c.lastMessage}</div>
              </button>
            ))}
          </div>
        </aside>

        {/* 右侧聊天窗 */}
        <main className="flex-1 flex flex-col bg-[url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')] bg-repeat">
          {activeConv ? (
            <>
              <div className="bg-white border-b px-6 py-3 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-gray-900">{activeConv.contactName}</div>
                  <div className="text-xs text-gray-500">{activeConv.phoneNumber}</div>
                </div>
                {activeConv.companyId && (
                  <Link href={`/customers/${activeConv.companyId}`} className="text-sm text-blue-600 hover:underline">
                    查看客户档案 →
                  </Link>
                )}
              </div>
              <div className="flex-1 overflow-y-auto p-6 space-y-3">
                {activeMessages.map(m => (
                  <div key={m.id} className={`flex ${m.direction === 'OUT' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-md px-4 py-2 rounded-lg shadow-sm ${m.direction === 'OUT' ? 'bg-green-100' : 'bg-white'}`}>
                      <div className="text-sm text-gray-800 whitespace-pre-wrap break-words">
                        {showTranslated && m.translated && m.direction === 'IN' ? m.translated : m.body}
                      </div>
                      {showTranslated && m.translated && m.direction === 'IN' && m.body !== m.translated && (
                        <div className="text-[11px] text-gray-400 mt-1 italic border-t pt-1">原文: {m.body}</div>
                      )}
                      <div className="text-[10px] text-gray-400 mt-1 text-right">{new Date(m.createdAt).toLocaleString('zh-CN')}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="bg-white border-t p-4">
                <div className="flex gap-2">
                  <textarea
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    placeholder="输入消息（可使用中文，发送前请自行翻译为英文）..."
                    rows={2}
                    className="flex-1 px-3 py-2 border rounded-lg text-sm resize-none"
                    onKeyDown={e => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendMessage();
                    }}
                  />
                  <button
                    onClick={sendMessage}
                    disabled={sending || !draft.trim()}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50 flex items-center gap-2"
                  >
                    <Send size={16} />
                    {sending ? '发送中...' : '发送'}
                  </button>
                </div>
                <div className="text-[11px] text-gray-400 mt-2">⌘+Enter 快速发送 · 通过 Meta WhatsApp Cloud API 发送</div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              {showNew ? '请在左上方输入对方手机号并直接发起消息' : '选择左侧对话开始聊天'}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

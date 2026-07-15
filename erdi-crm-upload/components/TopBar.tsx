// components/TopBar.tsx — 全局搜索 (Cmd+K) + 通知 Bell
'use client';
import { useState, useEffect, useRef } from 'react';
import { Search, Bell, X } from 'lucide-react';
import Link from 'next/link';

interface Notif {
  id: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
  isRead: boolean;
  createdAt: string;
}

export default function TopBar({ userName, role }: { userName: string; role: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [bellOpen, setBellOpen] = useState(false);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    fetchNotifs();
    const t = setInterval(fetchNotifs, 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!q) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`)
        .then(r => r.json())
        .then(d => setResults(d.results || []));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  async function fetchNotifs() {
    try {
      const r = await fetch('/api/notifications');
      const d = await r.json();
      setNotifs(d.items || []);
      setUnread(d.unread || 0);
    } catch {}
  }

  async function markAllRead() {
    await fetch('/api/notifications', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ markAllRead: true }) });
    fetchNotifs();
  }

  return (
    <>
      <div className="fixed top-3 right-4 z-40 flex items-center gap-2">
        <span className="hidden lg:block rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-gray-500 shadow-sm border" title={role}>{userName}</span>
        <button
          onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 50); }}
          className="flex items-center gap-2 px-3 py-1.5 bg-white border rounded-lg text-sm text-gray-500 hover:text-gray-800 shadow-sm"
        >
          <Search size={14} /> 搜索 <kbd className="ml-2 text-[10px] px-1.5 py-0.5 bg-gray-100 rounded border">⌘K</kbd>
        </button>
        <button
          onClick={() => setBellOpen(v => !v)}
          className="relative p-2 bg-white border rounded-lg shadow-sm hover:bg-gray-50"
        >
          <Bell size={16} className="text-gray-600" />
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
      </div>

      {/* 通知抽屉 */}
      {bellOpen && (
        <div className="fixed top-14 right-4 z-50 w-96 max-h-[70vh] bg-white border rounded-xl shadow-2xl overflow-hidden">
          <div className="flex justify-between items-center px-4 py-3 border-b">
            <span className="font-semibold">通知 ({unread})</span>
            <div className="flex gap-2">
              <button onClick={markAllRead} className="text-xs text-blue-600 hover:underline">全部已读</button>
              <button onClick={() => setBellOpen(false)}><X size={16} /></button>
            </div>
          </div>
          <div className="overflow-y-auto max-h-[60vh]">
            {notifs.length === 0 && <div className="p-8 text-center text-gray-400 text-sm">暂无通知</div>}
            {notifs.map(n => (
              <Link
                key={n.id}
                href={n.link || '#'}
                onClick={() => fetch(`/api/notifications/${n.id}`, { method: 'PATCH' })}
                className={`block px-4 py-3 border-b hover:bg-gray-50 ${!n.isRead ? 'bg-blue-50/30' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{n.title}</div>
                    {n.body && <div className="text-xs text-gray-500 truncate">{n.body}</div>}
                  </div>
                  <span className="text-[10px] text-gray-400 whitespace-nowrap">{new Date(n.createdAt).toLocaleString('zh-CN')}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* 搜索弹窗 */}
      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center pt-24" onClick={() => setOpen(false)}>
          <div className="w-full max-w-xl bg-white rounded-xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-3 border-b flex items-center gap-3">
              <Search size={18} className="text-gray-400" />
              <input
                ref={inputRef}
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="搜索客户、商机、产品、运单号..."
                className="flex-1 outline-none text-base"
              />
              <kbd className="text-xs text-gray-400">ESC</kbd>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {results.length === 0 && q && <div className="p-8 text-center text-gray-400 text-sm">未找到匹配项</div>}
              {results.map((r, i) => (
                <Link key={i} href={r.link} onClick={() => setOpen(false)} className="flex items-center gap-3 px-4 py-3 border-b hover:bg-gray-50">
                  <span className="text-xs text-gray-400 w-20">{labelFor(r.type)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{r.title}</div>
                    {r.subtitle && <div className="text-xs text-gray-500 truncate">{r.subtitle}</div>}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function labelFor(t: string) {
  return { customer: '👥 客户', opportunity: '💼 商机', product: '🛒 产品', shipment: '🚚 发货' }[t] || t;
}

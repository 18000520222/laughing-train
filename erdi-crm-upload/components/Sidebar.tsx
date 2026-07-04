'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  {
    title: '工作台',
    items: [
      { href: '/dashboard', label: '业务看板', icon: '📊' },
      { href: '/analytics', label: '数据分析', icon: '📈' },
    ],
  },
  {
    title: '客户与商机',
    items: [
      { href: '/customers', label: '客户管理', icon: '👥' },
      { href: '/sales-command', label: '销售指挥台', icon: '🎯' },
      { href: '/sales-kpi', label: '销售KPI', icon: '🏁' },
      { href: '/tasks', label: '销售任务', icon: '✅' },
      { href: '/omnibox', label: '统一收件箱', icon: '📥' },
      { href: '/automation', label: '自动化流程', icon: '🤖' },
      { href: '/products', label: '产品库', icon: '🛒' },
      { href: '/suppliers', label: '供应商', icon: '🏭' },
    ],
  },
  {
    title: '单据与履约',
    items: [
      { href: '/documents', label: '单据中心', icon: '📄' },
      { href: '/logistics', label: '物流中心', icon: '🚚' },
      { href: '/finance', label: '财务中心', icon: '💰' },
    ],
  },
  {
    title: '渠道',
    items: [
      { href: '/whatsapp', label: 'WhatsApp', icon: '💬' },
      { href: '/social', label: '社媒消息', icon: '📱' },
      { href: '/settings/channels', label: '渠道接入', icon: '🔌' },
    ],
  },
  {
    title: '系统',
    items: [
      { href: '/users', label: '员工管理', icon: '🪪' },
      { href: '/settings', label: '系统设置', icon: '⚙️' },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname() || '';
  const [collapsed, setCollapsed] = useState(false);

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + '/');

  return (
    <aside
      className={`fixed left-0 top-0 z-30 h-screen bg-gray-900 text-gray-300 flex flex-col transition-all duration-200 ${
        collapsed ? 'w-16' : 'w-56'
      }`}
    >
      {/* Logo */}
      <div className="flex items-center justify-between px-4 h-16 border-b border-gray-800 shrink-0">
        {!collapsed && (
          <Link href="/dashboard" className="text-white font-black tracking-tight text-lg">
            ERDI<span className="text-indigo-400"> CRM</span>
          </Link>
        )}
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="text-gray-500 hover:text-white p-1"
          title={collapsed ? '展开' : '收起'}
        >
          {collapsed ? '»' : '«'}
        </button>
      </div>

      {/* 导航 */}
      <nav className="flex-1 overflow-y-auto py-4">
        {GROUPS.map((g) => (
          <div key={g.title} className="mb-4">
            {!collapsed && (
              <div className="px-4 mb-1 text-[10px] font-bold uppercase tracking-widest text-gray-600">
                {g.title}
              </div>
            )}
            {g.items.map((it) => {
              const active = isActive(it.href);
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  title={it.label}
                  className={`flex items-center gap-3 px-4 py-2 text-sm font-medium transition-colors ${
                    active
                      ? 'bg-indigo-600 text-white'
                      : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                  }`}
                >
                  <span className="text-base shrink-0">{it.icon}</span>
                  {!collapsed && <span className="truncate">{it.label}</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* 退出 */}
      <div className="border-t border-gray-800 p-3 shrink-0">
        <a
          href="/api/auth/logout"
          className="flex items-center gap-3 px-2 py-2 text-sm text-gray-400 hover:text-red-400 transition-colors"
          title="退出登录"
        >
          <span className="text-base">🚪</span>
          {!collapsed && <span>退出登录</span>}
        </a>
      </div>
    </aside>
  );
}

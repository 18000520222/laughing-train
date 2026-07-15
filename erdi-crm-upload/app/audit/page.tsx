import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission('audit.read');
  const query = await searchParams;
  const q = typeof query.q === 'string' ? query.q.trim() : '';
  const page = Math.max(1, Number(typeof query.page === 'string' ? query.page : 1) || 1);
  const where = q ? {
    OR: [
      { action: { contains: q, mode: 'insensitive' as const } },
      { actorEmail: { contains: q, mode: 'insensitive' as const } },
      { entityType: { contains: q, mode: 'insensitive' as const } },
      { entityId: { contains: q, mode: 'insensitive' as const } },
      { summary: { contains: q, mode: 'insensitive' as const } },
    ],
  } : {};
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [logs, total, failedLogins24h, lockedUsers] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    prisma.auditLog.count({ where }),
    prisma.loginAttempt.count({ where: { success: false, createdAt: { gte: since } } }),
    prisma.user.count({ where: { lockedUntil: { gt: new Date() } } }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="min-h-screen bg-slate-50 p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div><p className="text-sm font-bold text-slate-500">只读安全记录</p><h1 className="text-2xl font-black text-slate-950">审计日志</h1></div>
          <Link href="/users" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white">员工与权限</Link>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          <Stat label="审计记录" value={total} />
          <Stat label="24小时登录失败" value={failedLogins24h} warning={failedLogins24h > 0} />
          <Stat label="当前锁定账号" value={lockedUsers} warning={lockedUsers > 0} />
        </section>

        <form className="flex gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <input name="q" defaultValue={q} placeholder="搜索操作、员工邮箱、对象或摘要" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-4 py-2" />
          <button className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-bold text-white">搜索</button>
        </form>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-600"><tr><th className="p-4">时间</th><th className="p-4">员工</th><th className="p-4">操作</th><th className="p-4">对象</th><th className="p-4">摘要</th><th className="p-4">来源</th></tr></thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-t border-slate-100 align-top">
                    <td className="whitespace-nowrap p-4 text-xs text-slate-500">{log.createdAt.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</td>
                    <td className="p-4"><p className="font-bold text-slate-800">{log.actorEmail || 'SYSTEM'}</p><p className="text-xs text-slate-400">{log.actorRole || '-'}</p></td>
                    <td className="p-4 font-mono text-xs font-bold text-indigo-700">{log.action}</td>
                    <td className="p-4 text-xs"><p>{log.entityType || '-'}</p><p className="font-mono text-slate-400">{log.entityId || ''}</p></td>
                    <td className="max-w-md p-4 text-slate-700">{log.summary || '-'}</td>
                    <td className="p-4 text-xs text-slate-400"><p>{log.ipAddress || '-'}</p><p className="max-w-xs truncate" title={log.userAgent || ''}>{log.userAgent || ''}</p></td>
                  </tr>
                ))}
                {logs.length === 0 && <tr><td colSpan={6} className="p-12 text-center text-slate-400">没有匹配记录</td></tr>}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && <div className="flex items-center justify-center gap-3 border-t border-slate-100 p-4"><PageLink page={page - 1} q={q} disabled={page <= 1}>上一页</PageLink><span className="text-sm text-slate-500">{page} / {totalPages}</span><PageLink page={page + 1} q={q} disabled={page >= totalPages}>下一页</PageLink></div>}
        </section>
      </div>
    </main>
  );
}

function Stat({ label, value, warning = false }: { label: string; value: number; warning?: boolean }) {
  return <div className={`rounded-xl border p-5 shadow-sm ${warning ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-200 bg-white text-slate-900'}`}><p className="text-sm font-bold">{label}</p><p className="mt-2 text-3xl font-black">{value}</p></div>;
}

function PageLink({ page, q, disabled, children }: { page: number; q: string; disabled: boolean; children: React.ReactNode }) {
  if (disabled) return <span className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-300">{children}</span>;
  return <Link href={`/audit?page=${page}${q ? `&q=${encodeURIComponent(q)}` : ''}`} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-bold text-slate-700">{children}</Link>;
}

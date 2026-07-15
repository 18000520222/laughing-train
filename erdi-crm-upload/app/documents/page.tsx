import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { requirePermission } from '@/lib/permissions';
import { opportunityAccessWhere } from '@/lib/data-access';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

const STAGE_LABEL: Record<string, string> = {
  UNPROCESSED: '未处理',
  REPLIED: '已回复',
  QUOTING: '报价中',
  NEGOTIATING: '谈判中',
  SPEC_CONFIRMING: '确认规格',
  CLOSED_WON: '已成交',
  CLOSED_LOST: '已流失',
};

const STAGE_COLOR: Record<string, string> = {
  CLOSED_WON: 'bg-green-50 text-green-700',
  CLOSED_LOST: 'bg-red-50 text-red-600',
  NEGOTIATING: 'bg-orange-50 text-orange-700',
  QUOTING: 'bg-amber-50 text-amber-700',
};

function DocLink({ href, label, version }: { href: string; label: string; version?: number }) {
  return (
    <Link
      href={href}
      className={`px-2 py-1 rounded text-xs font-bold transition-colors ${
        version
          ? 'bg-indigo-600 text-white hover:bg-indigo-500'
          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
      }`}
      title={version ? `当前正式版 V${version}` : '实时草稿预览'}
    >
      {label}{version ? ` V${version}` : ''}
    </Link>
  );
}

export default async function DocumentsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requirePermission('documents.read');

  const sp = searchParams ? await searchParams : {};
  const q = String(sp.q || '').trim();
  const onlyWon = String(sp.won || '') === '1';
  const page = Math.max(1, parseInt(String(sp.page || '1'), 10) || 1);

  const where: any = opportunityAccessWhere(session);
  if (onlyWon) where.stage = 'CLOSED_WON';
  if (q) {
    where.AND = [{ OR: [
      { title: { contains: q, mode: 'insensitive' } },
      { opportunityCode: { contains: q, mode: 'insensitive' } },
      { company: { name: { contains: q, mode: 'insensitive' } } },
    ] }];
  }

  const [total, opps] = await Promise.all([
    prisma.opportunity.count({ where }),
    prisma.opportunity.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        company: true,
        tradeDocuments: { where: { status: 'ISSUED' }, select: { type: true, version: true } },
      },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const mkHref = (p: number) =>
    `/documents?${q ? `q=${encodeURIComponent(q)}&` : ''}${onlyWon ? 'won=1&' : ''}page=${p}`;

  return (
    <div className="min-h-screen bg-gray-50 p-6 md:p-8">
      <header className="mb-6 flex flex-wrap justify-between items-center gap-4 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 tracking-tight">📄 单据中心</h1>
          <p className="text-sm text-gray-500 mt-1">
            PI 形式发票 · CI 商业发票 · PL 装箱单 · 销售合同 · 报关单 — 共 {total} 笔商机
          </p>
        </div>
      </header>

      {/* 筛选 */}
      <div className="mb-6 flex flex-wrap gap-3 items-center">
        <form action="/documents" method="get" className="flex gap-3 flex-1 min-w-[300px]">
          {onlyWon && <input type="hidden" name="won" value="1" />}
          <input
            name="q"
            defaultValue={q}
            placeholder="搜索商机标题 / 编号 / 客户公司…"
            className="flex-1 bg-white border-2 border-gray-200 rounded-xl px-4 py-3 text-gray-800 focus:border-indigo-500 focus:outline-none"
          />
          <button type="submit" className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-6 rounded-xl">
            搜索
          </button>
        </form>
        <Link
          href={onlyWon ? `/documents${q ? `?q=${encodeURIComponent(q)}` : ''}` : `/documents?won=1${q ? `&q=${encodeURIComponent(q)}` : ''}`}
          className={`px-4 py-3 rounded-xl font-bold text-sm border-2 ${
            onlyWon ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-200 hover:border-green-400'
          }`}
        >
          {onlyWon ? '✓ 仅看已成交' : '只看已成交'}
        </Link>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100 text-sm">
              <th className="p-4 font-bold text-gray-600">商机 / 客户</th>
              <th className="p-4 font-bold text-gray-600">阶段</th>
              <th className="p-4 font-bold text-gray-600">金额</th>
              <th className="p-4 font-bold text-gray-600">单据</th>
            </tr>
          </thead>
          <tbody>
            {opps.map((op) => {
              const versions = new Map(op.tradeDocuments.map((document) => [document.type, document.version]));
              return (
                <tr key={op.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="p-4">
                    <Link href={`/opportunity/${op.id}`} className="font-bold text-gray-800 hover:text-indigo-600 hover:underline">
                      {op.title}
                    </Link>
                    <div className="text-xs text-gray-400 mt-1">
                      {op.opportunityCode || op.id.slice(0, 8)}
                      {op.company ? ` · ${op.company.name}` : ''}
                    </div>
                  </td>
                  <td className="p-4">
                    <span className={`px-2 py-1 rounded text-xs font-bold ${STAGE_COLOR[op.stage] || 'bg-gray-100 text-gray-600'}`}>
                      {STAGE_LABEL[op.stage] || op.stage}
                    </span>
                  </td>
                  <td className="p-4 font-semibold text-gray-700 text-sm">
                    {op.amountUSD ? `$${op.amountUSD.toLocaleString()}` : '-'}
                  </td>
                  <td className="p-4">
                    <div className="flex flex-wrap gap-1.5">
                      <DocLink href={`/pi/${op.id}`} label="PI" version={versions.get('PI')} />
                      <DocLink href={`/ci/${op.id}`} label="CI" version={versions.get('CI')} />
                      <DocLink href={`/pl/${op.id}`} label="PL" version={versions.get('PL')} />
                      <DocLink href={`/contract/${op.id}`} label="合同" version={versions.get('CONTRACT')} />
                      <DocLink href={`/customs/${op.id}`} label="报关" version={versions.get('CUSTOMS')} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {opps.length === 0 && (
          <div className="p-20 text-center text-gray-400">
            {q ? `📭 没有匹配 “${q}” 的商机` : '📭 暂无商机单据'}
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-2">
          {page > 1 && (
            <Link href={mkHref(page - 1)} className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium hover:bg-gray-50">
              上一页
            </Link>
          )}
          <span className="px-4 py-2 text-sm text-gray-500">第 {page} / {totalPages} 页</span>
          {page < totalPages && (
            <Link href={mkHref(page + 1)} className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium hover:bg-gray-50">
              下一页
            </Link>
          )}
        </div>
      )}

      <p className="mt-4 text-xs text-gray-400 text-center">
        蓝色单据 = 当前正式签发版本；灰色 = 实时草稿预览。正式版只能新增版本或作废，不能覆盖修改。
      </p>
    </div>
  );
}

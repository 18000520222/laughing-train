'use client';

import { useState } from 'react';

type Result = {
  ok?: boolean; total?: number; created?: number; updated?: number; skipped?: number;
  errorCount?: number; errors?: { row: number; reason: string }[]; error?: string;
};

const CUSTOMER_TEMPLATE = '客户编号,公司名称,客户类型,国家,行业,官网,联系人名,联系人姓,职位,邮箱,电话\n,示例科技有限公司,潜在客户,中国,激光光电,https://example.com,三,张,采购经理,buyer@example.com,+86 138...\n';
const PRODUCT_TEMPLATE = 'SKU,中文品名,英文品名,分类,售价USD,HS编码,规格型号,波长,材质,用途,品牌,产地,单位\nLR20M3,激光测距模块,Laser Rangefinder Module,激光测距,199,9013801000,量程20km,1550nm,光学玻璃,军用/测绘,ERDI,中国,台\n';

function downloadCsv(filename: string, content: string) {
  const blob = new Blob(['\ufeff' + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function ImportPanel({ kind, endpoint, template }: { kind: string; endpoint: string; template: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<'skip' | 'update'>('skip');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function submit() {
    if (!file) { alert('请先选择 CSV 文件'); return; }
    setLoading(true); setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('mode', mode);
      const res = await fetch(endpoint, { method: 'POST', body: fd });
      const json = await res.json();
      setResult(json);
    } catch (e: any) {
      setResult({ error: String(e?.message || e) });
    } finally {
      setLoading(false);
    }
  }

  function downloadErrors() {
    if (!result?.errors?.length) return;
    const csv = '行号,原因\n' + result.errors.map(e => `${e.row},"${e.reason.replace(/"/g, '""')}"`).join('\n');
    downloadCsv(`${kind}-import-errors.csv`, csv);
  }

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 20, background: '#fff', marginBottom: 24 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>{kind === 'customers' ? '👥 客户批量导入' : '📦 产品批量导入'}</h2>

      <div style={{ marginBottom: 12 }}>
        <button onClick={() => downloadCsv(`${kind}-template.csv`, template)}
          style={{ padding: '6px 14px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 8, cursor: 'pointer', fontSize: 14 }}>
          ⬇ 下载导入模板
        </button>
        <span style={{ marginLeft: 10, color: '#6b7280', fontSize: 13 }}>用 Excel 填好后另存为 CSV（UTF-8）再上传</span>
      </div>

      <div style={{ marginBottom: 12 }}>
        <input type="file" accept=".csv,text/csv" onChange={e => setFile(e.target.files?.[0] || null)} />
      </div>

      <div style={{ marginBottom: 12, fontSize: 14 }}>
        <label style={{ marginRight: 16 }}>
          <input type="radio" checked={mode === 'skip'} onChange={() => setMode('skip')} /> 已存在则跳过
        </label>
        <label>
          <input type="radio" checked={mode === 'update'} onChange={() => setMode('update')} /> 已存在则更新
        </label>
      </div>

      <button onClick={submit} disabled={loading}
        style={{ padding: '8px 20px', background: loading ? '#9ca3af' : '#2563eb', color: '#fff', border: 'none', borderRadius: 8, cursor: loading ? 'default' : 'pointer', fontSize: 14, fontWeight: 600 }}>
        {loading ? '导入中…' : '开始导入'}
      </button>

      {result && (
        <div style={{ marginTop: 16, padding: 14, background: '#f9fafb', borderRadius: 8, fontSize: 14 }}>
          {result.error ? (
            <div style={{ color: '#dc2626' }}>❌ {result.error}</div>
          ) : (
            <>
              <div>共 <b>{result.total}</b> 行：新增 <b style={{ color: '#16a34a' }}>{result.created}</b>，更新 <b style={{ color: '#2563eb' }}>{result.updated}</b>，跳过 <b style={{ color: '#ca8a04' }}>{result.skipped}</b>，失败 <b style={{ color: '#dc2626' }}>{result.errorCount}</b></div>
              {!!result.errorCount && (
                <button onClick={downloadErrors}
                  style={{ marginTop: 10, padding: '5px 12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: '#dc2626' }}>
                  ⬇ 下载失败行明细
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

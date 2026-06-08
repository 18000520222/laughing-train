// 纯手写 CSV 解析/生成（零依赖）。支持引号、逗号、换行、双引号转义。
// Excel 可直接打开 .csv（UTF-8 BOM 防中文乱码）。

export function parseCsv(text: string): string[][] {
  // 去掉 BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
  }
  // 收尾最后一个字段/行
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  // 去掉完全空白的尾行
  return rows.filter(r => !(r.length === 1 && r[0].trim() === ''));
}

function escapeField(v: any): string {
  const s = v === null || v === undefined ? '' : String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// rows: 第一行表头，其余数据行
export function toCsv(headers: string[], rows: (any[])[]): string {
  const lines = [headers.map(escapeField).join(',')];
  for (const r of rows) lines.push(r.map(escapeField).join(','));
  return '\ufeff' + lines.join('\r\n'); // BOM
}

// 把解析出的二维数组转成对象数组（用表头做 key）
export function rowsToObjects(rows: string[][]): Record<string, string>[] {
  if (rows.length < 1) return [];
  const headers = rows[0].map(h => h.trim());
  const out: Record<string, string>[] = [];
  for (let i = 1; i < rows.length; i++) {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => { obj[h] = (rows[i][idx] ?? '').trim(); });
    out.push(obj);
  }
  return out;
}

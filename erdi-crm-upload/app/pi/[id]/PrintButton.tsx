'use client';

import { Printer } from 'lucide-react';

export default function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      title="打印或导出 PDF"
      className="fixed bottom-6 right-6 z-50 inline-flex h-11 items-center gap-2 rounded-md bg-gray-900 px-4 text-sm font-semibold text-white shadow-lg transition hover:bg-gray-700 print:hidden"
    >
      <Printer className="h-4 w-4" aria-hidden="true" />
      打印或导出 PDF
    </button>
  );
}

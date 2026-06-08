import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import ImportPanel from './ImportPanel';

export const dynamic = 'force-dynamic';

const CUSTOMER_TEMPLATE = '客户编号,公司名称,客户类型,国家,行业,官网,联系人名,联系人姓,职位,邮箱,电话\n,示例科技有限公司,潜在客户,中国,激光光电,https://example.com,三,张,采购经理,buyer@example.com,+86 138...\n';
const PRODUCT_TEMPLATE = 'SKU,中文品名,英文品名,分类,售价USD,HS编码,规格型号,波长,材质,用途,品牌,产地,单位\nLR20M3,激光测距模块,Laser Rangefinder Module,激光测距,199,9013801000,量程20km,1550nm,光学玻璃,军用/测绘,ERDI,中国,台\n';

export default function ImportPage() {
  const role = (cookies().get('auth_role')?.value || '').toUpperCase();
  if (!role) redirect('/');

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex justify-between items-center mb-8 bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h1 className="text-2xl font-bold text-gray-800">📥 批量导入</h1>
          <Link href="/dashboard" className="text-blue-600 hover:bg-blue-50 px-4 py-2 rounded-lg font-medium transition-colors">← 返回看板</Link>
        </div>

        <ImportPanel kind="customers" endpoint="/api/customers/import" template={CUSTOMER_TEMPLATE} />
        <ImportPanel kind="products" endpoint="/api/products/import" template={PRODUCT_TEMPLATE} />

        <div className="text-sm text-gray-500 bg-white rounded-xl border border-gray-200 p-5">
          <p className="font-semibold mb-2 text-gray-700">说明</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>客户按「客户编号 / 公司名称」去重；客户编号留空会自动生成 <span className="font-mono">CUST-年-序号</span>。</li>
            <li>联系人按「邮箱」去重，已存在的邮箱不会重复创建。</li>
            <li>产品按「SKU」去重（必填）。</li>
            <li>「已存在则更新」会覆盖原有字段；「已存在则跳过」只新增不改动。</li>
            <li>客户类型可填中文（新客户/老客户/潜在客户/重点客户/流失客户）或英文枚举值。</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

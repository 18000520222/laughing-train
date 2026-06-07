import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

// 旧的邮件原始视图已并入统一收件箱(/omnibox)，此处永久重定向避免功能重叠。
export default function InboxPage() {
  redirect('/omnibox');
}

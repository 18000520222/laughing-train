import { redirect } from 'next/navigation';
import { getSession, type SessionPayload } from '@/lib/auth';
import { can, type Permission } from '@/lib/permissions-shared';

export { can, permissionsFor } from '@/lib/permissions-shared';
export type { Permission } from '@/lib/permissions-shared';

export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) redirect('/');
  return session;
}

export async function requirePermission(permission: Permission): Promise<SessionPayload> {
  const session = await requireSession();
  if (!can(session.role, permission)) redirect('/dashboard?error=unauthorized');
  return session;
}

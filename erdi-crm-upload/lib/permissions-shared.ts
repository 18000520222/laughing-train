import type { Role } from '@/lib/auth';

export type Permission =
  | 'dashboard.read'
  | 'analytics.read'
  | 'customers.read'
  | 'customers.write'
  | 'customers.export'
  | 'sales.manage'
  | 'inbox.manage'
  | 'automation.manage'
  | 'products.read'
  | 'products.write'
  | 'suppliers.manage'
  | 'documents.read'
  | 'documents.write'
  | 'logistics.manage'
  | 'finance.read'
  | 'finance.manage'
  | 'channels.use'
  | 'channels.configure'
  | 'users.manage'
  | 'settings.manage'
  | 'audit.read';

const ALL: Permission[] = [
  'dashboard.read', 'analytics.read', 'customers.read', 'customers.write', 'customers.export',
  'sales.manage', 'inbox.manage', 'automation.manage', 'products.read', 'products.write',
  'suppliers.manage', 'documents.read', 'documents.write', 'logistics.manage', 'finance.read',
  'finance.manage', 'channels.use', 'channels.configure', 'users.manage', 'settings.manage', 'audit.read',
];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  SUPER_ADMIN: ALL,
  ADMIN: ALL.filter((permission) => permission !== 'audit.read'),
  SALES: [
    'dashboard.read', 'analytics.read', 'customers.read', 'customers.write', 'customers.export',
    'sales.manage', 'inbox.manage', 'automation.manage', 'products.read', 'documents.read',
    'documents.write', 'logistics.manage', 'finance.read', 'channels.use',
  ],
  PURCHASING: [
    'dashboard.read', 'analytics.read', 'customers.read', 'products.read', 'products.write',
    'suppliers.manage', 'documents.read', 'logistics.manage',
  ],
  FINANCE: [
    'dashboard.read', 'analytics.read', 'customers.read', 'customers.export', 'documents.read',
    'documents.write', 'logistics.manage', 'finance.read', 'finance.manage',
  ],
  DOCUMENT: [
    'dashboard.read', 'customers.read', 'products.read', 'documents.read', 'documents.write',
    'logistics.manage', 'finance.read',
  ],
  OPERATIONS: [
    'dashboard.read', 'analytics.read', 'customers.read', 'inbox.manage', 'products.read',
    'products.write', 'suppliers.manage', 'documents.read', 'documents.write', 'logistics.manage',
    'channels.use',
  ],
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsFor(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

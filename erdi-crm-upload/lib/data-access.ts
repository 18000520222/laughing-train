import type { Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth';

export function canReadAllSalesData(session: SessionPayload): boolean {
  return session.role !== 'SALES';
}

export function companyAccessWhere(session: SessionPayload): Prisma.CompanyWhereInput {
  if (canReadAllSalesData(session)) return {};
  return { OR: [{ ownerId: session.userId }, { isPublic: true }] };
}

export function opportunityAccessWhere(session: SessionPayload): Prisma.OpportunityWhereInput {
  if (canReadAllSalesData(session)) return {};
  return { OR: [{ ownerId: session.userId }, { company: { isPublic: true } }] };
}

export function companyIsAccessible(session: SessionPayload, company: { ownerId: string | null; isPublic: boolean }): boolean {
  return canReadAllSalesData(session) || company.ownerId === session.userId || company.isPublic;
}

export function inboxAccessWhere(session: SessionPayload): Prisma.InboxMessageWhereInput {
  if (canReadAllSalesData(session)) return {};
  return {
    OR: [
      { companyId: null },
      { company: { ownerId: session.userId } },
      { company: { isPublic: true } },
    ],
  };
}

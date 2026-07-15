import type { Prisma } from '@prisma/client';
import { headers } from 'next/headers';
import { prisma } from '@/lib/prisma';
import type { SessionPayload } from '@/lib/auth';

type AuditInput = {
  action: string;
  entityType?: string;
  entityId?: string;
  summary?: string;
  metadata?: Prisma.InputJsonValue;
};

export async function writeAuditLog(session: SessionPayload | null, input: AuditInput): Promise<void> {
  const requestHeaders = await headers();
  const forwarded = requestHeaders.get('x-forwarded-for');
  const ipAddress = forwarded?.split(',')[0]?.trim() || requestHeaders.get('x-real-ip') || undefined;
  const userAgent = requestHeaders.get('user-agent')?.slice(0, 500) || undefined;

  await prisma.auditLog.create({
    data: {
      actorId: session?.userId,
      actorEmail: session?.email,
      actorRole: session?.role,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      summary: input.summary?.slice(0, 1000),
      metadata: input.metadata,
      ipAddress,
      userAgent,
    },
  });
}

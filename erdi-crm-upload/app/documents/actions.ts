'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { requirePermission } from '@/lib/permissions';
import { opportunityAccessWhere } from '@/lib/data-access';
import { writeAuditLog } from '@/lib/audit';
import {
  issueTradeDocumentSnapshot,
  parseTradeDocumentType,
  TRADE_DOCUMENT_ROUTES,
} from '@/lib/trade-documents';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '单据操作失败';
}

export async function issueTradeDocument(formData: FormData) {
  const session = await requirePermission('documents.write');
  const opportunityId = String(formData.get('opportunityId') || '');
  const type = parseTradeDocumentType(formData.get('type'));
  if (!opportunityId || !type) redirect('/documents?error=invalid_document');
  const route = TRADE_DOCUMENT_ROUTES[type];

  let documentId = '';
  try {
    const document = await issueTradeDocumentSnapshot(session, opportunityId, type);
    documentId = document.id;
    await writeAuditLog(session, {
      action: 'trade_document.issue',
      entityType: 'TradeDocument',
      entityId: document.id,
      summary: `${document.documentNumber} 正式签发`,
      metadata: { type, opportunityId, version: document.version },
    });
  } catch (error) {
    redirect(`/${route}/${opportunityId}?error=${encodeURIComponent(errorMessage(error))}`);
  }

  revalidatePath(`/${route}/${opportunityId}`);
  revalidatePath('/documents');
  redirect(`/${route}/${opportunityId}?issued=${encodeURIComponent(documentId)}`);
}

export async function voidTradeDocument(formData: FormData) {
  const session = await requirePermission('documents.write');
  if (!['SUPER_ADMIN', 'ADMIN', 'DOCUMENT'].includes(session.role)) redirect('/dashboard?error=unauthorized');
  const documentId = String(formData.get('documentId') || '');
  const reason = String(formData.get('reason') || '').trim();
  if (!documentId || reason.length < 5) return;

  const document = await prisma.tradeDocument.findFirst({
    where: {
      id: documentId,
      status: 'ISSUED',
      opportunity: opportunityAccessWhere(session),
    },
    select: { id: true, opportunityId: true, type: true, documentNumber: true },
  });
  if (!document) return;

  await prisma.tradeDocument.update({
    where: { id: document.id },
    data: { status: 'VOID', voidedAt: new Date(), voidReason: reason },
  });
  await writeAuditLog(session, {
    action: 'trade_document.void',
    entityType: 'TradeDocument',
    entityId: document.id,
    summary: `${document.documentNumber} 作废：${reason}`,
  });
  const route = TRADE_DOCUMENT_ROUTES[document.type];
  revalidatePath(`/${route}/${document.opportunityId}`);
  revalidatePath('/documents');
  redirect(`/${route}/${document.opportunityId}?voided=1`);
}

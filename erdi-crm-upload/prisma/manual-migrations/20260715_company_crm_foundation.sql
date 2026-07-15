-- ERDI CRM company-wide foundation.
-- Incremental only: no DROP, TRUNCATE, reset, or destructive type conversion.

BEGIN;

DO $$ BEGIN
  CREATE TYPE "TradeDocumentType" AS ENUM ('PI', 'CI', 'PL', 'CONTRACT', 'CUSTOMS');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "TradeDocumentStatus" AS ENUM ('ISSUED', 'SUPERSEDED', 'VOID');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE "TradeDocumentStatus" ADD VALUE IF NOT EXISTS 'SUPERSEDED';

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "failedLoginCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lockedUntil" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordChangedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sessionVersion" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "AuditLog" (
  "id" TEXT NOT NULL,
  "actorId" TEXT,
  "actorEmail" TEXT,
  "actorRole" TEXT,
  "action" TEXT NOT NULL,
  "entityType" TEXT,
  "entityId" TEXT,
  "summary" TEXT,
  "metadata" JSONB,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LoginAttempt" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "ipAddress" TEXT,
  "success" BOOLEAN NOT NULL DEFAULT false,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TradeDocument" (
  "id" TEXT NOT NULL,
  "type" "TradeDocumentType" NOT NULL,
  "status" "TradeDocumentStatus" NOT NULL DEFAULT 'ISSUED',
  "documentNumber" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "data" JSONB NOT NULL,
  "opportunityId" TEXT NOT NULL,
  "issuedById" TEXT,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "voidedAt" TIMESTAMP(3),
  "voidReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TradeDocument_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "packages" INTEGER;
ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "grossWeightKg" DOUBLE PRECISION;
ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "netWeightKg" DOUBLE PRECISION;
ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "lengthCm" DOUBLE PRECISION;
ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "widthCm" DOUBLE PRECISION;
ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "heightCm" DOUBLE PRECISION;
ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "incoterm" TEXT;
ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "originCountry" TEXT;
ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "shippingAddress" JSONB;
ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "notes" TEXT;

ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "opportunityId" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "paymentTerms" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "expectedAt" TIMESTAMP(3);
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "createdById" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "approvedById" TEXT;

CREATE TABLE IF NOT EXISTS "PurchaseOrderLineItem" (
  "id" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "productId" TEXT,
  "productName" TEXT NOT NULL,
  "sku" TEXT,
  "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "unitPriceCNY" DOUBLE PRECISION NOT NULL,
  "totalAmountCNY" DOUBLE PRECISION NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PurchaseOrderLineItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TradeDocument_documentNumber_key" ON "TradeDocument"("documentNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "TradeDocument_opportunityId_type_version_key" ON "TradeDocument"("opportunityId", "type", "version");
CREATE INDEX IF NOT EXISTS "TradeDocument_opportunityId_type_status_issuedAt_idx" ON "TradeDocument"("opportunityId", "type", "status", "issuedAt");
CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");
CREATE INDEX IF NOT EXISTS "LoginAttempt_email_createdAt_idx" ON "LoginAttempt"("email", "createdAt");
CREATE INDEX IF NOT EXISTS "LoginAttempt_ipAddress_createdAt_idx" ON "LoginAttempt"("ipAddress", "createdAt");
CREATE INDEX IF NOT EXISTS "PurchaseOrder_supplierId_status_createdAt_idx" ON "PurchaseOrder"("supplierId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "PurchaseOrder_opportunityId_idx" ON "PurchaseOrder"("opportunityId");
CREATE INDEX IF NOT EXISTS "PurchaseOrderLineItem_purchaseOrderId_idx" ON "PurchaseOrderLineItem"("purchaseOrderId");
CREATE INDEX IF NOT EXISTS "PurchaseOrderLineItem_productId_idx" ON "PurchaseOrderLineItem"("productId");

DO $$ BEGIN
  ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "TradeDocument" ADD CONSTRAINT "TradeDocument_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "TradeDocument" ADD CONSTRAINT "TradeDocument_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "PurchaseOrderLineItem" ADD CONSTRAINT "PurchaseOrderLineItem_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "PurchaseOrderLineItem" ADD CONSTRAINT "PurchaseOrderLineItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;

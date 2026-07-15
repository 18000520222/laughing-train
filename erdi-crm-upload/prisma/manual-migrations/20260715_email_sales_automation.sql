BEGIN;

DO $$ BEGIN
  CREATE TYPE "PaymentRecordStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REFUNDED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "EmailProcessingState" AS ENUM ('RAW', 'IGNORED', 'INGESTED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "domainNormalized" TEXT;
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "emailNormalized" TEXT;
ALTER TABLE "EmailAccount" ADD COLUMN IF NOT EXISTS "lastAttemptAt" TIMESTAMP(3);
ALTER TABLE "EmailAccount" ADD COLUMN IF NOT EXISTS "lastError" TEXT;
ALTER TABLE "EmailAccount" ADD COLUMN IF NOT EXISTS "lastSuccessAt" TIMESTAMP(3);
ALTER TABLE "EmailMessage" ADD COLUMN IF NOT EXISTS "direction" TEXT NOT NULL DEFAULT 'IN';
ALTER TABLE "EmailMessage" ADD COLUMN IF NOT EXISTS "imapUid" TEXT;
ALTER TABLE "EmailMessage" ADD COLUMN IF NOT EXISTS "ingestedAt" TIMESTAMP(3);
ALTER TABLE "EmailMessage" ADD COLUMN IF NOT EXISTS "lastError" TEXT;
ALTER TABLE "EmailMessage" ADD COLUMN IF NOT EXISTS "mailbox" TEXT NOT NULL DEFAULT 'INBOX';
ALTER TABLE "EmailMessage" ADD COLUMN IF NOT EXISTS "nextRetryAt" TIMESTAMP(3);
ALTER TABLE "EmailMessage" ADD COLUMN IF NOT EXISTS "processingState" "EmailProcessingState" NOT NULL DEFAULT 'RAW';
ALTER TABLE "EmailMessage" ADD COLUMN IF NOT EXISTS "retryCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "EmailMessage" ADD COLUMN IF NOT EXISTS "salesProcessedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "OpportunityLineItem" (
  "id" TEXT NOT NULL,
  "opportunityId" TEXT NOT NULL,
  "productId" TEXT,
  "productName" TEXT NOT NULL,
  "sku" TEXT,
  "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "unitPrice" DOUBLE PRECISION,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "totalAmount" DOUBLE PRECISION,
  "source" TEXT NOT NULL DEFAULT 'MANUAL',
  "sourceRef" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OpportunityLineItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "BankAccount" (
  "id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "bankName" TEXT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "accountNo" TEXT,
  "swift" TEXT,
  "beneficiary" TEXT,
  "bankAddress" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PaymentRecord" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "opportunityId" TEXT,
  "emailMessageId" TEXT,
  "bankAccountId" TEXT,
  "amount" DOUBLE PRECISION,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "status" "PaymentRecordStatus" NOT NULL DEFAULT 'PENDING',
  "method" TEXT,
  "reference" TEXT,
  "paidAt" TIMESTAMP(3),
  "source" TEXT NOT NULL DEFAULT 'MANUAL',
  "sourceRef" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "EmailFolderCursor" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "mailbox" TEXT NOT NULL,
  "direction" TEXT NOT NULL DEFAULT 'IN',
  "uidValidity" TEXT,
  "lastUid" TEXT,
  "oldestUid" TEXT,
  "historyComplete" BOOLEAN NOT NULL DEFAULT false,
  "lastSuccessAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailFolderCursor_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OpportunityLineItem_opportunityId_idx" ON "OpportunityLineItem"("opportunityId");
CREATE INDEX IF NOT EXISTS "OpportunityLineItem_source_sourceRef_idx" ON "OpportunityLineItem"("source", "sourceRef");
CREATE INDEX IF NOT EXISTS "BankAccount_isActive_isDefault_idx" ON "BankAccount"("isActive", "isDefault");
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentRecord_sourceRef_key" ON "PaymentRecord"("sourceRef");
CREATE INDEX IF NOT EXISTS "PaymentRecord_companyId_createdAt_idx" ON "PaymentRecord"("companyId", "createdAt");
CREATE INDEX IF NOT EXISTS "PaymentRecord_opportunityId_idx" ON "PaymentRecord"("opportunityId");
CREATE INDEX IF NOT EXISTS "PaymentRecord_status_paidAt_idx" ON "PaymentRecord"("status", "paidAt");
CREATE INDEX IF NOT EXISTS "EmailFolderCursor_accountId_direction_idx" ON "EmailFolderCursor"("accountId", "direction");
CREATE UNIQUE INDEX IF NOT EXISTS "EmailFolderCursor_accountId_mailbox_key" ON "EmailFolderCursor"("accountId", "mailbox");
CREATE INDEX IF NOT EXISTS "Company_domainNormalized_idx" ON "Company"("domainNormalized");
CREATE UNIQUE INDEX IF NOT EXISTS "Contact_emailNormalized_key" ON "Contact"("emailNormalized");
CREATE INDEX IF NOT EXISTS "EmailMessage_processingState_nextRetryAt_date_idx" ON "EmailMessage"("processingState", "nextRetryAt", "date");
CREATE UNIQUE INDEX IF NOT EXISTS "EmailMessage_accountId_mailbox_imapUid_key" ON "EmailMessage"("accountId", "mailbox", "imapUid");

DO $$ BEGIN
  ALTER TABLE "OpportunityLineItem" ADD CONSTRAINT "OpportunityLineItem_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "OpportunityLineItem" ADD CONSTRAINT "OpportunityLineItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_emailMessageId_fkey" FOREIGN KEY ("emailMessageId") REFERENCES "EmailMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "PaymentRecord" ADD CONSTRAINT "PaymentRecord_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "EmailFolderCursor" ADD CONSTRAINT "EmailFolderCursor_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "EmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;

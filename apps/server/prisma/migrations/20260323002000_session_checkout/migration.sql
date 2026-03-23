-- AlterTable
ALTER TABLE "Session"
ADD COLUMN "checkedOutById" TEXT,
ADD COLUMN "checkoutExpiresAt" TIMESTAMP(3);

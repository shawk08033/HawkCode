-- CreateTable
CREATE TABLE "UserAgentSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "codexPath" TEXT,
    "codexModel" TEXT,
    "openrouterApiKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserAgentSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserAgentSettings_userId_provider_key" ON "UserAgentSettings"("userId", "provider");

-- AddForeignKey
ALTER TABLE "UserAgentSettings" ADD CONSTRAINT "UserAgentSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SEC-07: single-use cache of outbound SAML AuthnRequest IDs (InResponseTo
-- validation + replay protection).
CREATE TABLE "SamlRequestId" (
    "id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SamlRequestId_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SamlRequestId_createdAt_idx" ON "SamlRequestId"("createdAt");

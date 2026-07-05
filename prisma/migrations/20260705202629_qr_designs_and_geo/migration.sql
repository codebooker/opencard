-- DropForeignKey
ALTER TABLE "DirectoryConfig" DROP CONSTRAINT "DirectoryConfig_orgId_fkey";

-- DropForeignKey
ALTER TABLE "SamlConfig" DROP CONSTRAINT "SamlConfig_orgId_fkey";

-- AlterTable
ALTER TABLE "AnalyticsEvent" ADD COLUMN     "assetId" TEXT,
ADD COLUMN     "campaignId" TEXT,
ADD COLUMN     "geoCity" TEXT,
ADD COLUMN     "geoCountry" TEXT,
ADD COLUMN     "geoRegion" TEXT,
ALTER COLUMN "cardId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "qrDesign" TEXT;

-- AlterTable
ALTER TABLE "Brand" ADD COLUMN     "qrDesign" TEXT;

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "qrDesign" TEXT;

-- AlterTable
ALTER TABLE "Card" ADD COLUMN     "qrDesign" TEXT;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "geoCity" TEXT,
ADD COLUMN     "geoCountry" TEXT,
ADD COLUMN     "geoRegion" TEXT;

-- AlterTable
ALTER TABLE "SamlConfig" ALTER COLUMN "id" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "AnalyticsEvent_assetId_type_idx" ON "AnalyticsEvent"("assetId", "type");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_campaignId_type_idx" ON "AnalyticsEvent"("campaignId", "type");

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SamlConfig" ADD CONSTRAINT "SamlConfig_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectoryConfig" ADD CONSTRAINT "DirectoryConfig_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Platform-wide settings editable by OpenCard staff (single fixed-id row).
CREATE TABLE "PlatformConfig" (
    "id" TEXT NOT NULL DEFAULT 'platform',
    "signupPlan" TEXT NOT NULL DEFAULT 'starter',
    "signupTrialDays" INTEGER NOT NULL DEFAULT 30,

    CONSTRAINT "PlatformConfig_pkey" PRIMARY KEY ("id")
);

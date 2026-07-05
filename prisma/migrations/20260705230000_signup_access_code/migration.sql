-- Private-beta gate: public signup requires this code/phrase when set.
ALTER TABLE "PlatformConfig" ADD COLUMN "signupAccessCode" TEXT NOT NULL DEFAULT '';

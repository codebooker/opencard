-- Terms-of-service acceptance recorded at self-service signup.
ALTER TABLE "Org" ADD COLUMN "tosAcceptedAt" TIMESTAMP(3);
ALTER TABLE "Org" ADD COLUMN "tosVersion" TEXT;

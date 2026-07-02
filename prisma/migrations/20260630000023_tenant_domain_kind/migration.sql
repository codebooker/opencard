-- Domain type: which portal a custom domain lands on (employee vs admin). Lets a
-- brand/rooftop register both an admin domain and an employee domain.
ALTER TABLE "TenantDomain" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'user';

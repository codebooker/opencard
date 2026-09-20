import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./db";
import { setTenantDomain, TenantDomainConflictError } from "./routes/admin/context";

function stubDomainStore(overrides: {
  current?: any;
  claimed?: any;
  canonicalOwner?: any;
}) {
  const originals = {
    findFirst: prisma.tenantDomain.findFirst,
    findUnique: prisma.tenantDomain.findUnique,
    findMany: prisma.tenantDomain.findMany,
    delete: prisma.tenantDomain.delete,
    deleteMany: prisma.tenantDomain.deleteMany,
    create: prisma.tenantDomain.create,
    orgFindFirst: prisma.org.findFirst,
    orgFindUnique: prisma.org.findUnique,
    transaction: prisma.$transaction,
  };
  let created: any = null;
  (prisma.tenantDomain as any).findFirst = async () => overrides.current ?? null;
  (prisma.tenantDomain as any).findUnique = async () => overrides.claimed ?? null;
  (prisma.tenantDomain as any).findMany = async () => [];
  (prisma.tenantDomain as any).delete = async () => ({});
  (prisma.tenantDomain as any).deleteMany = async () => ({});
  (prisma.tenantDomain as any).create = async (args: any) => {
    created = args.data;
    return args.data;
  };
  (prisma.org as any).findFirst = async () => overrides.canonicalOwner ?? null;
  (prisma.org as any).findUnique = async () => ({
    plan: "multi_location_brand",
    customDomain: null,
  });
  (prisma as any).$transaction = async (arg: any) => {
    if (typeof arg === "function") {
      return arg({ $executeRaw: async () => 1 });
    }
    return Promise.all(arg);
  };
  return {
    created: () => created,
    restore() {
      (prisma.tenantDomain as any).findFirst = originals.findFirst;
      (prisma.tenantDomain as any).findUnique = originals.findUnique;
      (prisma.tenantDomain as any).findMany = originals.findMany;
      (prisma.tenantDomain as any).delete = originals.delete;
      (prisma.tenantDomain as any).deleteMany = originals.deleteMany;
      (prisma.tenantDomain as any).create = originals.create;
      (prisma.org as any).findFirst = originals.orgFindFirst;
      (prisma.org as any).findUnique = originals.orgFindUnique;
      (prisma as any).$transaction = originals.transaction;
    },
  };
}

test("a domain already claimed by another scope cannot be reassigned", async () => {
  const stub = stubDomainStore({ claimed: { id: "victim-domain" } });
  try {
    await assert.rejects(
      () => setTenantDomain("attacker-org", { brandId: "attacker-brand" }, "admin", "login.victim.example"),
      TenantDomainConflictError
    );
    assert.equal(stub.created(), null);
  } finally {
    stub.restore();
  }
});

test("a new domain claim stays pending and unapproved until DNS verification", async () => {
  const stub = stubDomainStore({});
  try {
    await setTenantDomain("org1", { brandId: "brand1" }, "user", "Cards.Customer.Example.");
    assert.deepEqual(stub.created(), {
      host: "cards.customer.example",
      orgId: "org1",
      kind: "user",
      brandId: "brand1",
      locationId: null,
      approved: false,
      verifyState: "pending",
      verifiedAt: null,
    });
  } finally {
    stub.restore();
  }
});

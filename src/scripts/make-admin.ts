import crypto from "crypto";
import { prisma } from "../db";
import { hashPassword } from "../security";
import { defaultOrgId } from "../tenant";

// Shell-only admin bootstrap / recovery for the single local workspace.
//
//   node dist/scripts/make-admin.js <email> [name] [role]
//
// - Creates the account if new, or resets its password + reactivates it if it
//   exists. Prints a one-time random password to log in with (change it after).
// - Clears MFA on a reset so a lost authenticator can't lock you out here.
// - Default role: org_owner.

const VALID_ROLES = new Set([
  "org_owner",
  "org_admin",
  "brand_admin",
  "location_admin",
]);

async function main() {
  const [, , emailArg, nameArg, roleArg] = process.argv;
  const email = (emailArg || "").toLowerCase().trim();
  if (!email || !email.includes("@")) {
    console.error("Usage: node dist/scripts/make-admin.js <email> [name] [role]");
    process.exit(1);
  }
  if (roleArg && !VALID_ROLES.has(roleArg)) throw new Error(`Unsupported role: ${roleArg}`);
  const role = roleArg || "org_owner";
  const name = nameArg || email.split("@")[0];
  const orgId = await defaultOrgId();

  // Readable but strong one-time password.
  const tempPassword = crypto.randomBytes(12).toString("base64url");
  const passwordHash = hashPassword(tempPassword);

  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) {
    await prisma.adminUser.update({
      where: { email },
      data: { passwordHash, active: true, role, orgId, mfaEnabled: false, mfaSecret: null },
    });
    console.log(`Reset existing account ${email} (role ${role}, MFA cleared).`);
  } else {
    await prisma.adminUser.create({
      data: { email, name, role, orgId, passwordHash, active: true, emailVerifiedAt: new Date() },
    });
    console.log(`Created account ${email} (role ${role}).`);
  }

  console.log("");
  console.log("  One-time password: " + tempPassword);
  console.log("  Sign in at /admin, then change it under Security immediately.");
  console.log("");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("make-admin failed:", e?.message || e);
  await prisma.$disconnect();
  process.exit(1);
});

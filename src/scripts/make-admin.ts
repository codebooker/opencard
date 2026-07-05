import crypto from "crypto";
import { prisma } from "../db";
import { hashPassword } from "../security";

// Shell-only admin bootstrap / recovery. Replaces the removed ADMIN_TOKEN
// break-glass: creating or resetting a platform admin now requires access to
// the box (SSH), not a static internet-reachable token.
//
//   node dist/scripts/make-admin.js <email> [name] [role]
//
// - Creates the account if new, or resets its password + reactivates it if it
//   exists. Prints a one-time random password to log in with (change it after).
// - Clears MFA on a reset so a lost authenticator can't lock you out here.
// - Default role: platform_owner.

const VALID_ROLES = new Set([
  "platform_owner",
  "platform_admin",
  "platform_staff",
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
  const role = roleArg && VALID_ROLES.has(roleArg) ? roleArg : "platform_owner";
  const name = nameArg || email.split("@")[0];

  // Readable but strong one-time password.
  const tempPassword = crypto.randomBytes(12).toString("base64url");
  const passwordHash = hashPassword(tempPassword);

  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) {
    await prisma.adminUser.update({
      where: { email },
      data: { passwordHash, active: true, role, mfaEnabled: false, mfaSecret: null },
    });
    console.log(`Reset existing account ${email} (role ${role}, MFA cleared).`);
  } else {
    await prisma.adminUser.create({
      data: { email, name, role, passwordHash, active: true, emailVerifiedAt: new Date() },
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

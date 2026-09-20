import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  // Demo/dev data (brands, cards, sample admins) is only seeded when SEED_DEMO=1.
  // Production gets one clean workspace. Demo data is opt-in only.
  const seedDemo = process.env.SEED_DEMO === "1";

  if (!seedDemo) {
    const existing = await prisma.org.findMany({ take: 2 });
    if (existing.length > 1) throw new Error("This installation contains multiple workspaces. Export/migrate them before running single-company OpenCard; no data was deleted.");
    if (!existing.length) {
      await prisma.org.create({ data: { name: process.env.COMPANY_NAME?.trim() || "My Company", vertical: "general" } });
      console.log("Seed: created clean bootstrap org (SEED_DEMO not set).");
    } else {
      console.log("Seed: org exists, nothing to do (SEED_DEMO not set).");
    }
    return;
  }

  // Never insert demo people, accounts, or edits into an existing workspace.
  // This also makes container restarts with SEED_DEMO=1 idempotent.
  const existingOrg = await prisma.org.findFirst({ orderBy: { createdAt: "asc" } });
  if (existingOrg) {
    console.log("Seed: workspace already exists, no sample content inserted.");
    return;
  }

  // Demo admin accounts (SSO-only; sign in via dev-login to test each role).
  // All scoped to the given org so isolation behaves like a real tenant.
  async function ensureAdmin(
    orgId: string,
    email: string,
    role: string,
    scope?: { brandId?: string; locationId?: string }
  ) {
    if (await prisma.adminUser.findUnique({ where: { email } })) return;
    await prisma.adminUser.create({
      data: { email, role, orgId, name: email.split("@")[0], scopes: scope ? { create: [scope] } : undefined },
    });
  }
  async function seedDemoAdmins(orgId: string) {
    const mw = await prisma.brand.findFirst({ where: { name: "Maplewood Real Estate" } });
    const mwDt = await prisma.location.findFirst({ where: { code: "MW-DT" } });
    await ensureAdmin(orgId, "owner@yourco.com", "org_owner");
    await ensureAdmin(orgId, "general@yourco.com", "org_admin");
    if (mw) await ensureAdmin(orgId, "brandadmin@maplewood.ca", "brand_admin", { brandId: mw.id });
    if (mwDt) await ensureAdmin(orgId, "storeadmin@maplewood.ca", "location_admin", { locationId: mwDt.id });
  }

  const org = await prisma.org.create({
    data: {
      name: "Maplewood Group",
      vertical: "general",
    },
  });

  // ---- Brand 1: Maplewood Real Estate (green, wave) ----
  const maplewood = await prisma.brand.create({
    data: {
      orgId: org.id,
      name: "Maplewood Real Estate",
      primaryColor: "#1f6f43",
      layout: "wave",
      defaultDomain: "cards.maplewoodrealestate.ca",
    },
  });
  const mwDowntown = await prisma.location.create({
    data: {
      brandId: maplewood.id,
      orgId: org.id,
      name: "Downtown Office",
      code: "MW-DT",
      address: { line1: "100 King St", city: "Toronto", region: "ON", postal: "M5H 1A1", country: "Canada" },
    },
  });
  const mwNorth = await prisma.location.create({
    data: {
      brandId: maplewood.id,
      orgId: org.id,
      name: "North Branch",
      code: "MW-N",
      primaryColor: "#2563eb", // this office uses a blue accent instead of green
      address: { line1: "55 Yonge St", city: "Toronto", region: "ON", postal: "M2N 5V7", country: "Canada" },
    },
  });

  await prisma.card.create({
    data: {
      locationId: mwDowntown.id,
      orgId: org.id,
      slug: "john-smith",
      ownerEmail: "john.smith@maplewoodrealestate.ca",
      prefix: "Mr.",
      firstName: "John",
      lastName: "Smith",
      pronouns: "He/Him",
      title: "President",
      company: "Maplewood Real Estate",
      bio: "Leading the company's strategic vision and growth.",
      phones: [{ label: "Work", value: "+1 555 123 4567" }],
      emails: [{ label: "Work", value: "john.smith@maplewoodrealestate.ca" }],
      websites: [{ label: "Company", value: "https://maplewoodrealestate.ca" }],
      socials: [{ type: "linkedin", value: "https://linkedin.com/in/johnsmith" }],
    },
  });
  await prisma.card.create({
    data: {
      locationId: mwNorth.id,
      orgId: org.id,
      slug: "james-chen",
      ownerEmail: "james.chen@maplewoodrealestate.ca",
      prefix: "Mr.",
      firstName: "James",
      lastName: "Chen",
      pronouns: "He/Him",
      title: "IT Manager",
      department: "IT",
      company: "Maplewood Real Estate",
      bio: "Managing the company's technology infrastructure and systems.",
      phones: [{ label: "Work", value: "+1 555 678 9012" }],
      emails: [{ label: "Work", value: "james.chen@maplewoodrealestate.ca" }],
      websites: [{ label: "Company", value: "https://maplewoodrealestate.ca" }],
    },
  });

  // ---- Brand 2: Maplewood Commercial — a related brand with its own design ----
  const commercial = await prisma.brand.create({
    data: {
      orgId: org.id,
      name: "Maplewood Commercial",
      primaryColor: "#6d5bd0",
      layout: "banner",
    },
  });
  const commercialOffice = await prisma.location.create({
    data: {
      brandId: commercial.id,
      orgId: org.id,
      name: "Commercial Office",
      code: "MW-COM",
      address: { line1: "200 Bay St", city: "Toronto", region: "ON", postal: "M5J 2J2", country: "Canada" },
    },
  });
  await prisma.card.create({
    data: {
      locationId: commercialOffice.id,
      orgId: org.id,
      slug: "max-mcgonagall",
      ownerEmail: "max.m@maplewoodrealestate.ca",
      firstName: "Max",
      lastName: "McGonagall",
      pronouns: "he/him",
      title: "Commercial Leasing Director",
      company: "Maplewood Commercial",
      bio: "Helping businesses find practical spaces to grow.",
      phones: [{ label: "Work", value: "+1 555 397 4687" }],
      emails: [{ label: "Work", value: "max.m@maplewoodrealestate.ca" }],
      websites: [{ label: "Company", value: "https://maplewoodrealestate.ca" }],
      socials: [
        { type: "linkedin", value: "https://linkedin.com/in/maxmcgonagall" },
      ],
    },
  });

  await seedDemoAdmins(org.id);

  console.log("Seed complete: 1 workspace, 2 related brands, 3 locations, 3 cards.");
  console.log("  Maplewood Real Estate: /c/john-smith (green), /c/james-chen (north office, blue accent)");
  console.log("  Maplewood Commercial: /c/max-mcgonagall (purple, banner layout)");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

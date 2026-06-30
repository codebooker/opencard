import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const dealershipTerminology = {
  brandSingular: "Brand",
  brandPlural: "Brands",
  locationSingular: "Rooftop",
  locationPlural: "Rooftops",
  locationCodeLabel: "Rooftop code",
  cardSingular: "Card",
  cardPlural: "Cards",
  leadSingular: "Customer lead",
  leadPlural: "Customer leads",
};

async function main() {
  // Idempotent backfill so self-service works on pre-existing demo data too.
  const demoOwners: [string, string][] = [
    ["john-smith", "john.smith@maplewoodrealestate.ca"],
    ["james-chen", "james.chen@maplewoodrealestate.ca"],
    ["max-mcgonagall", "max.m@briskmotors.com"],
  ];
  for (const [slug, ownerEmail] of demoOwners) {
    await prisma.card.updateMany({ where: { slug, ownerEmail: null }, data: { ownerEmail } });
  }

  // Demo admin accounts (SSO-only; sign in via dev-login to test each role).
  async function ensureAdmin(
    email: string,
    role: string,
    scope?: { brandId?: string; locationId?: string }
  ) {
    if (await prisma.adminUser.findUnique({ where: { email } })) return;
    await prisma.adminUser.create({
      data: { email, role, name: email.split("@")[0], scopes: scope ? { create: [scope] } : undefined },
    });
  }
  const mw = await prisma.brand.findFirst({ where: { name: "Maplewood Real Estate" } });
  const mwDt = await prisma.location.findFirst({ where: { code: "MW-DT" } });
  await ensureAdmin("general@yourco.com", "general_admin");
  if (mw) await ensureAdmin("brandadmin@maplewood.ca", "brand_admin", { brandId: mw.id });
  if (mwDt) await ensureAdmin("storeadmin@maplewood.ca", "location_admin", { locationId: mwDt.id });

  if (await prisma.org.findFirst()) {
    await prisma.org.updateMany({
      where: { vertical: "general" },
      data: { vertical: "dealership", terminology: dealershipTerminology },
    });
    console.log("Seed: org already exists, skipping (owner emails + demo admins backfilled).");
    return;
  }

  const org = await prisma.org.create({
    data: { name: "Demo Dealer Group", vertical: "dealership", terminology: dealershipTerminology },
  });

  // ---- Brand 1: Maplewood Real Estate (green, classic) ----
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
      name: "Downtown Office",
      code: "MW-DT",
      address: { line1: "100 King St", city: "Toronto", region: "ON", postal: "M5H 1A1", country: "Canada" },
    },
  });
  const mwNorth = await prisma.location.create({
    data: {
      brandId: maplewood.id,
      name: "North Branch",
      code: "MW-N",
      primaryColor: "#2563eb", // this store uses a blue accent instead of green
      address: { line1: "55 Yonge St", city: "Toronto", region: "ON", postal: "M2N 5V7", country: "Canada" },
    },
  });

  await prisma.card.create({
    data: {
      locationId: mwDowntown.id,
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

  // ---- Brand 2: Brisk Motors (purple, banner) — different design + logo ----
  const brisk = await prisma.brand.create({
    data: {
      orgId: org.id,
      name: "Brisk Motors",
      primaryColor: "#6d5bd0",
      layout: "banner",
    },
  });
  const briskHQ = await prisma.location.create({
    data: {
      brandId: brisk.id,
      name: "HQ Showroom",
      code: "BM-HQ",
      address: { line1: "1 Speedway Blvd", city: "Austin", region: "TX", postal: "78701", country: "USA" },
    },
  });
  await prisma.card.create({
    data: {
      locationId: briskHQ.id,
      slug: "max-mcgonagall",
      ownerEmail: "max.m@briskmotors.com",
      firstName: "Max",
      lastName: "McGonagall",
      pronouns: "he/him",
      title: "Chief Sales Officer",
      company: "Brisk Motors",
      bio: "I drive global sales growth and align revenue goals with company vision.",
      phones: [{ label: "Personal", value: "+1 911 397 4687" }],
      emails: [{ label: "Personal", value: "max.m@briskmotors.com" }],
      websites: [{ label: "Work", value: "https://www.briskmotors.com" }],
      socials: [
        { type: "facebook", value: "https://facebook.com/briskmotors" },
        { type: "twitter", value: "https://twitter.com/briskmotors" },
        { type: "instagram", value: "https://instagram.com/briskmotors" },
      ],
    },
  });

  console.log("Seed complete: 1 org, 2 brands, 3 stores, 3 cards.");
  console.log("  Maplewood: /c/john-smith (green), /c/james-chen (north store, blue accent)");
  console.log("  Brisk Motors: /c/max-mcgonagall (purple, banner layout)");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

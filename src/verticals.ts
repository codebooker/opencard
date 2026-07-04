import type { Terminology } from "./terminology";

// Vertical packs (Phase 15 Stage 2): everything a business type customizes,
// in one data bundle. Adding a vertical = adding a pack here — the signup
// "Business type" dropdown, terminology, lead-form catalog, department and
// role suggestions, CTA button labels, the location editor's profile section
// and example copy all derive from this registry. No other file should
// hardcode a vertical check.
//
// NOTE on lead fields: packs pick from the FIXED field catalog in leadform.ts
// (those are real Lead columns). A future pack that needs a brand-new field
// adds the column + catalog entry first, then references it here.

export type CtaLabels = { sales: string; service: string; call: string; site: string };

export type VerticalPack = {
  key: string; // Org.vertical value
  label: string; // customer-facing "Business type" option
  terminology: Omit<Terminology, "vertical">;
  // Department suggestions offered when a location has none yet.
  departments: string[];
  // Role-template name suggestions (datalist in the template editor).
  roleSuggestions: string[];
  // Lead-form field keys that belong to THIS pack (hidden from other packs).
  extraLeadFieldKeys: string[];
  // The built-in default lead-form field set.
  defaultLeadFields: string[];
  // Labels for the location-level CTA buttons on public cards.
  ctaLabels: CtaLabels;
  // The location editor's vertical profile section.
  locationEditor: {
    heading: string;
    blurb: string;
    showOemBrands: boolean;
    showSalesServiceUrls: boolean;
  };
  // Example copy on the events page.
  eventsExamples: string;
};

const COMMON_TERMS = {
  brandSingular: "Brand",
  brandPlural: "Brands",
  cardSingular: "Card",
  cardPlural: "Cards",
};

export const VERTICAL_PACKS: VerticalPack[] = [
  {
    key: "general",
    label: "General business",
    terminology: {
      ...COMMON_TERMS,
      locationSingular: "Location",
      locationPlural: "Locations",
      locationCodeLabel: "Location code",
      leadSingular: "Lead",
      leadPlural: "Leads",
    },
    departments: [],
    roleSuggestions: ["Account Executive", "Sales Manager", "Consultant", "Office Manager", "Owner"],
    extraLeadFieldKeys: [],
    defaultLeadFields: ["email", "phone", "note", "consent"],
    ctaLabels: { sales: "See what's available", service: "Book an appointment", call: "Call us", site: "Visit website" },
    locationEditor: {
      heading: "Contact",
      blurb: "Shown on this location's cards as click-to-call and website buttons.",
      showOemBrands: false,
      showSalesServiceUrls: false,
    },
    eventsExamples: "Trade shows, open houses, hiring events",
  },
  {
    key: "dealership",
    label: "Car dealership",
    terminology: {
      ...COMMON_TERMS,
      locationSingular: "Rooftop",
      locationPlural: "Rooftops",
      locationCodeLabel: "Rooftop code",
      leadSingular: "Customer lead",
      leadPlural: "Customer leads",
    },
    departments: ["Sales", "Service", "Parts", "Finance", "BDC", "Management"],
    roleSuggestions: [
      "Sales Consultant",
      "Sales Manager",
      "Service Advisor",
      "Parts Advisor",
      "Finance Manager",
      "BDC Representative",
      "General Manager",
    ],
    extraLeadFieldKeys: ["vehicleInterest", "tradeIn", "serviceNeed"],
    defaultLeadFields: ["email", "phone", "vehicleInterest", "note", "consent"],
    ctaLabels: { sales: "View inventory", service: "Schedule service", call: "Call the dealership", site: "Visit website" },
    locationEditor: {
      heading: "Dealership profile",
      blurb: "Shown on this rooftop's cards as click-to-call and Sales/Service buttons.",
      showOemBrands: true,
      showSalesServiceUrls: true,
    },
    eventsExamples: "Auto shows, tent sales, hiring events",
  },
];

const byKey = new Map(VERTICAL_PACKS.map((p) => [p.key, p]));

// Every lookup falls back to the general pack — an unknown vertical value can
// never crash a page.
export function packFor(vertical?: string | null): VerticalPack {
  return byKey.get(String(vertical || "general")) || byKey.get("general")!;
}

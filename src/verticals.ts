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
  // The location editor's vertical profile section. Packs that show the two
  // CTA URL inputs can relabel them (they map to Location.salesUrl /
  // serviceUrl and drive the pack's sales/service card buttons).
  locationEditor: {
    heading: string;
    blurb: string;
    showOemBrands: boolean;
    showSalesServiceUrls: boolean;
    salesUrlLabel?: string;
    serviceUrlLabel?: string;
    salesUrlPlaceholder?: string;
    serviceUrlPlaceholder?: string;
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
  {
    key: "realestate",
    label: "Real estate brokerage",
    terminology: {
      ...COMMON_TERMS,
      locationSingular: "Office",
      locationPlural: "Offices",
      locationCodeLabel: "Office code",
      leadSingular: "Client lead",
      leadPlural: "Client leads",
    },
    departments: ["Residential", "Commercial", "Rentals", "Property Management", "New Development"],
    roleSuggestions: [
      "Real Estate Agent",
      "Broker",
      "Managing Broker",
      "Listing Specialist",
      "Buyer's Agent",
      "Transaction Coordinator",
    ],
    extraLeadFieldKeys: [],
    defaultLeadFields: ["email", "phone", "preferredContact", "note", "consent"],
    ctaLabels: { sales: "View listings", service: "Book a showing", call: "Call the office", site: "Visit website" },
    locationEditor: {
      heading: "Office profile",
      blurb: "Shown on this office's cards as click-to-call, listings and showing buttons.",
      showOemBrands: false,
      showSalesServiceUrls: true,
      salesUrlLabel: "Listings URL",
      serviceUrlLabel: "Book-a-showing URL",
      salesUrlPlaceholder: "acmerealty.com/listings",
      serviceUrlPlaceholder: "acmerealty.com/schedule",
    },
    eventsExamples: "Open houses, broker tours, community events",
  },
  {
    key: "homeservices",
    label: "Home services (HVAC, plumbing, electrical…)",
    terminology: {
      ...COMMON_TERMS,
      locationSingular: "Branch",
      locationPlural: "Branches",
      locationCodeLabel: "Branch code",
      leadSingular: "Service lead",
      leadPlural: "Service leads",
    },
    departments: ["HVAC", "Plumbing", "Electrical", "Roofing", "Dispatch", "Sales"],
    roleSuggestions: ["Service Technician", "Field Supervisor", "Estimator", "Dispatcher", "Sales Representative"],
    // Shares "serviceNeed" with the dealership pack — claimed fields appear
    // for every pack that claims them, and stay hidden from the rest.
    extraLeadFieldKeys: ["serviceNeed"],
    defaultLeadFields: ["email", "phone", "serviceNeed", "appointmentRequest", "consent"],
    ctaLabels: { sales: "Request a quote", service: "Book a service call", call: "Call us", site: "Visit website" },
    locationEditor: {
      heading: "Branch profile",
      blurb: "Shown on this branch's cards as click-to-call, quote and booking buttons.",
      showOemBrands: false,
      showSalesServiceUrls: true,
      salesUrlLabel: "Quote request URL",
      serviceUrlLabel: "Booking URL",
      salesUrlPlaceholder: "acmehvac.com/quote",
      serviceUrlPlaceholder: "acmehvac.com/book",
    },
    eventsExamples: "Home shows, trade expos, community fairs",
  },
  {
    key: "retail",
    label: "Franchise retail",
    terminology: {
      ...COMMON_TERMS,
      locationSingular: "Store",
      locationPlural: "Stores",
      locationCodeLabel: "Store code",
      leadSingular: "Lead",
      leadPlural: "Leads",
    },
    departments: ["Sales Floor", "Customer Service", "Management"],
    roleSuggestions: ["Store Manager", "Assistant Manager", "Sales Associate", "Customer Service Lead"],
    extraLeadFieldKeys: [],
    defaultLeadFields: ["email", "phone", "note", "consent"],
    ctaLabels: { sales: "Shop online", service: "Book an appointment", call: "Call the store", site: "Visit website" },
    locationEditor: {
      heading: "Store profile",
      blurb: "Shown on this store's cards as click-to-call, shop and appointment buttons.",
      showOemBrands: false,
      showSalesServiceUrls: true,
      salesUrlLabel: "Online shop URL",
      serviceUrlLabel: "Appointment URL",
      salesUrlPlaceholder: "acmestore.com/shop",
      serviceUrlPlaceholder: "acmestore.com/book",
    },
    eventsExamples: "Grand openings, seasonal sales, hiring events",
  },
  {
    key: "insurance",
    label: "Insurance agency",
    terminology: {
      ...COMMON_TERMS,
      locationSingular: "Office",
      locationPlural: "Offices",
      locationCodeLabel: "Office code",
      leadSingular: "Quote request",
      leadPlural: "Quote requests",
    },
    departments: ["Personal Lines", "Commercial Lines", "Life & Health", "Claims"],
    roleSuggestions: ["Insurance Agent", "Agency Owner", "Producer", "Account Manager", "Claims Specialist"],
    extraLeadFieldKeys: [],
    defaultLeadFields: ["email", "phone", "preferredContact", "note", "consent"],
    ctaLabels: { sales: "Get a quote", service: "File a claim", call: "Call the agency", site: "Visit website" },
    locationEditor: {
      heading: "Agency profile",
      blurb: "Shown on this office's cards as click-to-call, quote and claims buttons.",
      showOemBrands: false,
      showSalesServiceUrls: true,
      salesUrlLabel: "Quote URL",
      serviceUrlLabel: "Claims URL",
      salesUrlPlaceholder: "acmeinsurance.com/quote",
      serviceUrlPlaceholder: "acmeinsurance.com/claims",
    },
    eventsExamples: "Community events, benefits fairs, open enrollment",
  },
];

const byKey = new Map(VERTICAL_PACKS.map((p) => [p.key, p]));

// Every lookup falls back to the general pack — an unknown vertical value can
// never crash a page.
export function packFor(vertical?: string | null): VerticalPack {
  return byKey.get(String(vertical || "general")) || byKey.get("general")!;
}

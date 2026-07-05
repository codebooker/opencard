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
  {
    key: "lawfirm",
    label: "Law firm",
    terminology: {
      ...COMMON_TERMS,
      locationSingular: "Office",
      locationPlural: "Offices",
      locationCodeLabel: "Office code",
      leadSingular: "Consultation request",
      leadPlural: "Consultation requests",
    },
    departments: ["Family Law", "Corporate", "Litigation", "Real Estate Law", "Estate Planning"],
    roleSuggestions: ["Attorney", "Partner", "Associate Attorney", "Paralegal", "Legal Assistant", "Office Manager"],
    extraLeadFieldKeys: [],
    defaultLeadFields: ["email", "phone", "preferredContact", "note", "consent"],
    ctaLabels: { sales: "Practice areas", service: "Book a consultation", call: "Call the office", site: "Visit website" },
    locationEditor: {
      heading: "Office profile",
      blurb: "Shown on this office's cards as click-to-call, practice-area and consultation buttons.",
      showOemBrands: false,
      showSalesServiceUrls: true,
      salesUrlLabel: "Practice areas URL",
      serviceUrlLabel: "Consultation booking URL",
      salesUrlPlaceholder: "acmelaw.com/practice-areas",
      serviceUrlPlaceholder: "acmelaw.com/consultation",
    },
    eventsExamples: "Legal clinics, seminars, networking events",
  },
  {
    key: "medical",
    label: "Medical & dental practice",
    terminology: {
      ...COMMON_TERMS,
      locationSingular: "Clinic",
      locationPlural: "Clinics",
      locationCodeLabel: "Clinic code",
      leadSingular: "Appointment request",
      leadPlural: "Appointment requests",
    },
    departments: ["General Care", "Specialty Care", "Front Office", "Billing"],
    roleSuggestions: ["Physician", "Dentist", "Hygienist", "Nurse Practitioner", "Practice Manager", "Patient Coordinator"],
    extraLeadFieldKeys: [],
    defaultLeadFields: ["email", "phone", "appointmentRequest", "note", "consent"],
    ctaLabels: { sales: "Our services", service: "Book an appointment", call: "Call the clinic", site: "Visit website" },
    locationEditor: {
      heading: "Clinic profile",
      blurb: "Shown on this clinic's cards as click-to-call, services and appointment buttons.",
      showOemBrands: false,
      showSalesServiceUrls: true,
      salesUrlLabel: "Services URL",
      serviceUrlLabel: "Appointment booking URL",
      salesUrlPlaceholder: "acmeclinic.com/services",
      serviceUrlPlaceholder: "acmeclinic.com/book",
    },
    eventsExamples: "Health fairs, open houses, community screenings",
  },
  {
    key: "salon",
    label: "Salon & spa",
    terminology: {
      ...COMMON_TERMS,
      locationSingular: "Salon",
      locationPlural: "Salons",
      locationCodeLabel: "Salon code",
      leadSingular: "Booking request",
      leadPlural: "Booking requests",
    },
    departments: ["Hair", "Nails", "Skincare", "Massage"],
    roleSuggestions: ["Stylist", "Colorist", "Esthetician", "Massage Therapist", "Salon Manager"],
    extraLeadFieldKeys: [],
    defaultLeadFields: ["email", "phone", "appointmentRequest", "note", "consent"],
    ctaLabels: { sales: "View services", service: "Book an appointment", call: "Call the salon", site: "Visit website" },
    locationEditor: {
      heading: "Salon profile",
      blurb: "Shown on this salon's cards as click-to-call, services and booking buttons.",
      showOemBrands: false,
      showSalesServiceUrls: true,
      salesUrlLabel: "Services URL",
      serviceUrlLabel: "Booking URL",
      salesUrlPlaceholder: "acmesalon.com/services",
      serviceUrlPlaceholder: "acmesalon.com/book",
    },
    eventsExamples: "Open houses, bridal expos, pop-ups",
  },
  {
    key: "fitness",
    label: "Gym & fitness",
    terminology: {
      ...COMMON_TERMS,
      locationSingular: "Gym",
      locationPlural: "Gyms",
      locationCodeLabel: "Gym code",
      leadSingular: "Membership inquiry",
      leadPlural: "Membership inquiries",
    },
    departments: ["Personal Training", "Group Fitness", "Membership", "Front Desk"],
    roleSuggestions: ["Personal Trainer", "Group Instructor", "Membership Advisor", "General Manager"],
    extraLeadFieldKeys: [],
    defaultLeadFields: ["email", "phone", "note", "consent"],
    ctaLabels: { sales: "Join now", service: "Book a class", call: "Call the gym", site: "Visit website" },
    locationEditor: {
      heading: "Gym profile",
      blurb: "Shown on this gym's cards as click-to-call, membership and class buttons.",
      showOemBrands: false,
      showSalesServiceUrls: true,
      salesUrlLabel: "Membership URL",
      serviceUrlLabel: "Class schedule URL",
      salesUrlPlaceholder: "acmefit.com/join",
      serviceUrlPlaceholder: "acmefit.com/classes",
    },
    eventsExamples: "Open houses, fitness challenges, community events",
  },
  {
    key: "hospitality",
    label: "Restaurant & hospitality",
    terminology: {
      ...COMMON_TERMS,
      locationSingular: "Venue",
      locationPlural: "Venues",
      locationCodeLabel: "Venue code",
      leadSingular: "Event inquiry",
      leadPlural: "Event inquiries",
    },
    departments: ["Front of House", "Kitchen", "Events & Catering", "Management"],
    roleSuggestions: ["General Manager", "Executive Chef", "Events Coordinator", "Catering Manager"],
    extraLeadFieldKeys: [],
    defaultLeadFields: ["email", "phone", "preferredContact", "note", "consent"],
    ctaLabels: { sales: "View menu", service: "Book a table", call: "Call the venue", site: "Visit website" },
    locationEditor: {
      heading: "Venue profile",
      blurb: "Shown on this venue's cards as click-to-call, menu and reservation buttons.",
      showOemBrands: false,
      showSalesServiceUrls: true,
      salesUrlLabel: "Menu URL",
      serviceUrlLabel: "Reservations URL",
      salesUrlPlaceholder: "acmebistro.com/menu",
      serviceUrlPlaceholder: "acmebistro.com/reserve",
    },
    eventsExamples: "Tastings, private events, seasonal promotions",
  },
  {
    key: "mortgage",
    label: "Mortgage & lending",
    terminology: {
      ...COMMON_TERMS,
      locationSingular: "Branch",
      locationPlural: "Branches",
      locationCodeLabel: "Branch code",
      leadSingular: "Loan inquiry",
      leadPlural: "Loan inquiries",
    },
    departments: ["Purchase", "Refinance", "Processing", "Underwriting"],
    roleSuggestions: ["Loan Officer", "Branch Manager", "Loan Processor", "Underwriter"],
    extraLeadFieldKeys: [],
    defaultLeadFields: ["email", "phone", "preferredContact", "note", "consent"],
    ctaLabels: { sales: "Apply now", service: "Schedule a consultation", call: "Call the branch", site: "Visit website" },
    locationEditor: {
      heading: "Branch profile",
      blurb: "Shown on this branch's cards as click-to-call, application and consultation buttons.",
      showOemBrands: false,
      showSalesServiceUrls: true,
      salesUrlLabel: "Application URL",
      serviceUrlLabel: "Consultation URL",
      salesUrlPlaceholder: "acmelending.com/apply",
      serviceUrlPlaceholder: "acmelending.com/consult",
    },
    eventsExamples: "Homebuyer seminars, realtor events, community fairs",
  },
  {
    key: "staffing",
    label: "Staffing & recruiting",
    terminology: {
      ...COMMON_TERMS,
      locationSingular: "Office",
      locationPlural: "Offices",
      locationCodeLabel: "Office code",
      leadSingular: "Inquiry",
      leadPlural: "Inquiries",
    },
    departments: ["Recruiting", "Sales", "Payroll"],
    roleSuggestions: ["Recruiter", "Account Manager", "Branch Manager", "Talent Coordinator"],
    extraLeadFieldKeys: [],
    defaultLeadFields: ["email", "phone", "company", "note", "consent"],
    ctaLabels: { sales: "Browse open jobs", service: "Request talent", call: "Call the office", site: "Visit website" },
    locationEditor: {
      heading: "Office profile",
      blurb: "Shown on this office's cards as click-to-call, job board and request-talent buttons.",
      showOemBrands: false,
      showSalesServiceUrls: true,
      salesUrlLabel: "Job board URL",
      serviceUrlLabel: "Request-talent URL",
      salesUrlPlaceholder: "acmestaffing.com/jobs",
      serviceUrlPlaceholder: "acmestaffing.com/hire",
    },
    eventsExamples: "Job fairs, hiring events, campus visits",
  },
  {
    key: "autoservices",
    label: "Auto repair & tire shop",
    terminology: {
      ...COMMON_TERMS,
      locationSingular: "Shop",
      locationPlural: "Shops",
      locationCodeLabel: "Shop code",
      leadSingular: "Service lead",
      leadPlural: "Service leads",
    },
    departments: ["Service", "Tires", "Parts", "Front Desk"],
    roleSuggestions: ["Service Advisor", "Technician", "Shop Manager"],
    // Shares the service-need field with dealerships and home services.
    extraLeadFieldKeys: ["serviceNeed"],
    defaultLeadFields: ["email", "phone", "serviceNeed", "appointmentRequest", "consent"],
    ctaLabels: { sales: "Shop tires & services", service: "Book a repair", call: "Call the shop", site: "Visit website" },
    locationEditor: {
      heading: "Shop profile",
      blurb: "Shown on this shop's cards as click-to-call, services and booking buttons.",
      showOemBrands: false,
      showSalesServiceUrls: true,
      salesUrlLabel: "Services URL",
      serviceUrlLabel: "Booking URL",
      salesUrlPlaceholder: "acmeauto.com/services",
      serviceUrlPlaceholder: "acmeauto.com/book",
    },
    eventsExamples: "Car care clinics, seasonal tire events",
  },
];

const byKey = new Map(VERTICAL_PACKS.map((p) => [p.key, p]));

// Every lookup falls back to the general pack — an unknown vertical value can
// never crash a page.
export function packFor(vertical?: string | null): VerticalPack {
  return byKey.get(String(vertical || "general")) || byKey.get("general")!;
}

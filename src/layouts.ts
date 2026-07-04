// Card layout registry (single source of truth — preview route, card
// renderer validation, and the design editor thumbs all import from here)
// plus the starter template gallery presets.

export const CARD_LAYOUTS = ["classic", "banner", "minimal", "wave", "split", "spotlight", "frame"] as const;
export type CardLayout = (typeof CARD_LAYOUTS)[number];

export function isCardLayout(v: unknown): v is CardLayout {
  return (CARD_LAYOUTS as readonly string[]).includes(String(v));
}

// Starter gallery: one-click template presets so a new org never designs from
// a blank form. Kept deliberately opinionated — a good default beats options.
export type TemplatePreset = {
  key: string;
  name: string;
  description: string;
  layout: CardLayout;
  primaryColor: string;
  textColor: string;
  bgColor: string;
  font: string;
};

export const TEMPLATE_PRESETS: TemplatePreset[] = [
  {
    key: "showroom",
    name: "Showroom",
    description: "Bold color banner, centered avatar — the confident default.",
    layout: "classic",
    primaryColor: "#1F5BEA",
    textColor: "#111827",
    bgColor: "#ffffff",
    font: "grotesk",
  },
  {
    key: "editorial",
    name: "Editorial",
    description: "Framed, serif, understated — for principals and partners.",
    layout: "frame",
    primaryColor: "#8a6d3b",
    textColor: "#1f2937",
    bgColor: "#fffdf8",
    font: "serif",
  },
  {
    key: "spotlight",
    name: "Spotlight",
    description: "Full-bleed photo with the name overlaid — personality first.",
    layout: "spotlight",
    primaryColor: "#0f766e",
    textColor: "#111827",
    bgColor: "#ffffff",
    font: "system",
  },
  {
    key: "midnight",
    name: "Midnight",
    description: "Dark background, electric accent — high-contrast and modern.",
    layout: "split",
    primaryColor: "#6366f1",
    textColor: "#e5e7eb",
    bgColor: "#0f1117",
    font: "grotesk",
  },
  {
    key: "coastal",
    name: "Coastal",
    description: "The wave layout in fresh blues — friendly and relaxed.",
    layout: "wave",
    primaryColor: "#0284c7",
    textColor: "#0f172a",
    bgColor: "#ffffff",
    font: "rounded",
  },
  {
    key: "monochrome",
    name: "Monochrome",
    description: "Minimal, black on white, zero decoration — lets the person speak.",
    layout: "minimal",
    primaryColor: "#111827",
    textColor: "#111827",
    bgColor: "#ffffff",
    font: "system",
  },
];

export function presetByKey(key: string): TemplatePreset | null {
  return TEMPLATE_PRESETS.find((p) => p.key === key) || null;
}

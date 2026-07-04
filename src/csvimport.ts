import type { ImportCandidate } from "./dirimport";

// CSV employee import (Phase 14): the on-ramp for orgs without a directory.
// Shares the preview / selective-apply machinery with the Graph wizard —
// this module only turns a CSV into the same ImportCandidate shape.

// ---- RFC 4180-ish parser: quotes, escaped quotes, CR/LF, no dependencies ----
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const src = text.replace(/^﻿/, ""); // strip BOM
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.length > 1 || row[0] !== "") rows.push(row);
  return rows;
}

// ---- column mapping ----
// Targets the wizard understands. "name" is a full-name column that gets split.
export const CSV_TARGETS = [
  ["", "— ignore —"],
  ["email", "Email (required)"],
  ["firstName", "First name"],
  ["lastName", "Last name"],
  ["name", "Full name (will be split)"],
  ["title", "Job title"],
  ["department", "Department"],
  ["phoneWork", "Phone (work)"],
  ["phoneMobile", "Phone (mobile)"],
  ["location", "Location (code or name)"],
] as const;
export type CsvTarget = (typeof CSV_TARGETS)[number][0];

// Guess a target for each header — exact-ish matches on common column names.
export function guessMapping(headers: string[]): CsvTarget[] {
  const guess = (h: string): CsvTarget => {
    const k = h.toLowerCase().replace(/[^a-z]/g, "");
    if (/^(email|emailaddress|workemail|mail)$/.test(k)) return "email";
    if (/^(firstname|first|givenname)$/.test(k)) return "firstName";
    if (/^(lastname|last|surname|familyname)$/.test(k)) return "lastName";
    if (/^(name|fullname|displayname|employee|employeename)$/.test(k)) return "name";
    if (/^(title|jobtitle|position|role)$/.test(k)) return "title";
    if (/^(department|dept|team)$/.test(k)) return "department";
    if (/^(mobile|mobilephone|cell|cellphone)$/.test(k)) return "phoneMobile";
    if (/^(phone|phonenumber|workphone|telephone|officephone|directline)$/.test(k)) return "phoneWork";
    if (/^(location|store|rooftop|office|branch|site|locationcode|storecode)$/.test(k)) return "location";
    return "";
  };
  return headers.map(guess);
}

// Map one data row through the chosen column mapping. Returns null when
// there's no usable email (same contract as mapGraphUser).
export function mapCsvRow(mapping: CsvTarget[], row: string[]): ImportCandidate | null {
  const get = (t: CsvTarget) => {
    const i = mapping.indexOf(t);
    return i >= 0 ? String(row[i] ?? "").trim() : "";
  };
  const email = get("email").toLowerCase();
  if (!email || !email.includes("@")) return null;
  const full = get("name");
  const firstName = get("firstName") || full.split(" ")[0] || email.split("@")[0];
  const lastName = get("lastName") || full.split(" ").slice(1).join(" ") || "";
  const phones: { label: string; value: string }[] = [];
  if (get("phoneWork")) phones.push({ label: "Work", value: get("phoneWork") });
  if (get("phoneMobile")) phones.push({ label: "Mobile", value: get("phoneMobile") });
  return {
    email,
    firstName,
    lastName,
    title: get("title") || null,
    department: get("department") || null,
    locationHint: get("location") || null,
    phones,
    enabled: true, // a CSV has no notion of disabled accounts
  };
}

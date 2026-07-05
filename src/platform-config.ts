import { prisma } from "./db";
import { isPlanKey, DEFAULT_PLAN } from "./plans";

// Platform-wide settings (staff-editable, single fixed-id row). Reads fall
// back to defaults when the row doesn't exist yet; the first save creates it.

const ROW_ID = "platform";

export type PlatformConfigValues = {
  signupPlan: string;
  signupTrialDays: number;
  // Private-beta gate: when non-empty, public signup requires this code/phrase.
  signupAccessCode: string;
};

export const PLATFORM_DEFAULTS: PlatformConfigValues = {
  signupPlan: DEFAULT_PLAN,
  signupTrialDays: 30,
  signupAccessCode: "",
};

export async function getPlatformConfig(): Promise<PlatformConfigValues> {
  const row = await prisma.platformConfig.findUnique({ where: { id: ROW_ID } });
  if (!row) return { ...PLATFORM_DEFAULTS };
  return {
    signupPlan: isPlanKey(row.signupPlan) ? row.signupPlan : PLATFORM_DEFAULTS.signupPlan,
    signupTrialDays: clampTrialDays(row.signupTrialDays),
    signupAccessCode: (row.signupAccessCode || "").trim(),
  };
}

export async function updatePlatformConfig(v: {
  signupPlan?: string;
  signupTrialDays?: number;
  signupAccessCode?: string;
}): Promise<PlatformConfigValues> {
  const data: Partial<PlatformConfigValues> = {};
  if (v.signupPlan !== undefined && isPlanKey(v.signupPlan)) data.signupPlan = v.signupPlan;
  if (v.signupTrialDays !== undefined && Number.isFinite(v.signupTrialDays)) {
    data.signupTrialDays = clampTrialDays(v.signupTrialDays);
  }
  if (v.signupAccessCode !== undefined) data.signupAccessCode = String(v.signupAccessCode).trim().slice(0, 200);
  const row = await prisma.platformConfig.upsert({
    where: { id: ROW_ID },
    create: { id: ROW_ID, ...PLATFORM_DEFAULTS, ...data },
    update: data,
  });
  return {
    signupPlan: row.signupPlan,
    signupTrialDays: row.signupTrialDays,
    signupAccessCode: (row.signupAccessCode || "").trim(),
  };
}

// Signup-gate check: case-insensitive, forgiving of surrounding whitespace.
// An empty configured code means the gate is off.
export function signupCodeOk(configured: string, supplied: unknown): boolean {
  const want = (configured || "").trim().toLowerCase();
  if (!want) return true;
  return String(supplied ?? "").trim().toLowerCase() === want;
}

// Keep the trial in a sane range: 1..365 days.
export function clampTrialDays(n: number): number {
  if (!Number.isFinite(n)) return PLATFORM_DEFAULTS.signupTrialDays;
  return Math.min(365, Math.max(1, Math.round(n)));
}

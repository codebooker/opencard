import { prisma } from "./db";
import { isPlanKey, DEFAULT_PLAN } from "./plans";

// Platform-wide settings (staff-editable, single fixed-id row). Reads fall
// back to defaults when the row doesn't exist yet; the first save creates it.

const ROW_ID = "platform";

export type PlatformConfigValues = {
  signupPlan: string;
  signupTrialDays: number;
};

export const PLATFORM_DEFAULTS: PlatformConfigValues = {
  signupPlan: DEFAULT_PLAN,
  signupTrialDays: 30,
};

export async function getPlatformConfig(): Promise<PlatformConfigValues> {
  const row = await prisma.platformConfig.findUnique({ where: { id: ROW_ID } });
  if (!row) return { ...PLATFORM_DEFAULTS };
  return {
    signupPlan: isPlanKey(row.signupPlan) ? row.signupPlan : PLATFORM_DEFAULTS.signupPlan,
    signupTrialDays: clampTrialDays(row.signupTrialDays),
  };
}

export async function updatePlatformConfig(v: { signupPlan?: string; signupTrialDays?: number }): Promise<PlatformConfigValues> {
  const data: Partial<PlatformConfigValues> = {};
  if (v.signupPlan !== undefined && isPlanKey(v.signupPlan)) data.signupPlan = v.signupPlan;
  if (v.signupTrialDays !== undefined && Number.isFinite(v.signupTrialDays)) {
    data.signupTrialDays = clampTrialDays(v.signupTrialDays);
  }
  const row = await prisma.platformConfig.upsert({
    where: { id: ROW_ID },
    create: { id: ROW_ID, ...PLATFORM_DEFAULTS, ...data },
    update: data,
  });
  return { signupPlan: row.signupPlan, signupTrialDays: row.signupTrialDays };
}

// Keep the trial in a sane range: 1..365 days.
export function clampTrialDays(n: number): number {
  if (!Number.isFinite(n)) return PLATFORM_DEFAULTS.signupTrialDays;
  return Math.min(365, Math.max(1, Math.round(n)));
}

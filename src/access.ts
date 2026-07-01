// Pure workspace access logic — decides whether a tenant may keep using the
// product, from its billing mode, subscription status, and trial/demo deadline.
// No runtime deps, so it is unit-testable in isolation.

export type BillingMode = "standard" | "demo" | "free";

export interface AccessInput {
  billingMode: string;
  subscriptionStatus: string; // trialing | active | past_due | canceled
  trialEndsAt: Date | string | null;
  now?: Date;
}

export type AccessReason =
  | "free" // permanent comp account
  | "subscribed" // active paid subscription
  | "trial" // standard plan, inside trial window
  | "demo" // demo comp, inside window
  | "trial_expired"
  | "demo_expired"
  | "past_due"
  | "canceled";

export interface AccessState {
  active: boolean;
  reason: AccessReason;
  daysLeft: number | null; // whole days remaining in a trial/demo window (if any)
}

const DAY = 24 * 60 * 60 * 1000;

function daysUntil(end: Date, now: Date): number {
  return Math.ceil((end.getTime() - now.getTime()) / DAY);
}

export function accessState(o: AccessInput): AccessState {
  const now = o.now ?? new Date();

  // Permanent comp accounts always have access.
  if (o.billingMode === "free") return { active: true, reason: "free", daysLeft: null };

  // A live paid subscription grants access regardless of any trial window.
  if (o.subscriptionStatus === "active") return { active: true, reason: "subscribed", daysLeft: null };

  const end = o.trialEndsAt ? new Date(o.trialEndsAt) : null;
  const withinWindow = end ? end.getTime() > now.getTime() : false;
  const daysLeft = end && withinWindow ? daysUntil(end, now) : null;

  if (o.billingMode === "demo") {
    return withinWindow
      ? { active: true, reason: "demo", daysLeft }
      : { active: false, reason: "demo_expired", daysLeft: null };
  }

  // standard billing
  if (o.subscriptionStatus === "trialing") {
    return withinWindow
      ? { active: true, reason: "trial", daysLeft }
      : { active: false, reason: "trial_expired", daysLeft: null };
  }
  if (o.subscriptionStatus === "past_due") return { active: false, reason: "past_due", daysLeft: null };
  return { active: false, reason: "canceled", daysLeft: null };
}

// Short human summary for banners / the plan page.
export function accessSummary(s: AccessState): string {
  switch (s.reason) {
    case "free":
      return "Free account";
    case "subscribed":
      return "Subscription active";
    case "trial":
      return `Trial — ${s.daysLeft} day${s.daysLeft === 1 ? "" : "s"} left`;
    case "demo":
      return `Demo — ${s.daysLeft} day${s.daysLeft === 1 ? "" : "s"} left`;
    case "trial_expired":
      return "Trial ended — subscribe to continue";
    case "demo_expired":
      return "Demo ended — subscribe to continue";
    case "past_due":
      return "Payment past due — update billing to continue";
    case "canceled":
      return "Subscription canceled";
  }
}

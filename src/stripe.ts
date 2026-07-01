import Stripe from "stripe";
import { Request, Response } from "express";
import { prisma } from "./db";
import { config, stripeEnabled } from "./config";
import { isPlanKey, PlanKey } from "./plans";

// The Stripe client is only constructed when a secret key is present; otherwise
// every billing entry point degrades gracefully (checkout 503s, webhook 503s,
// and the UI hides the pay buttons).
export const stripe: Stripe | null = stripeEnabled ? new Stripe(config.stripe.secretKey) : null;
export { stripeEnabled };

// Reverse-map a Stripe Price id back to our plan key.
export function planForPrice(priceId: string | null | undefined): PlanKey | null {
  if (!priceId) return null;
  for (const [key, id] of Object.entries(config.stripe.prices)) {
    if (id && id === priceId && isPlanKey(key)) return key;
  }
  return null;
}

// Map a Stripe subscription's status to the value we store on the Org.
function normalizeStatus(status: string): string {
  if (status === "active" || status === "trialing") return "active";
  if (status === "past_due" || status === "unpaid" || status === "incomplete") return "past_due";
  return "canceled"; // canceled | incomplete_expired | paused
}

async function applySubscription(sub: any): Promise<void> {
  const orgId: string | undefined = sub?.metadata?.orgId;
  const customerId: string | undefined = typeof sub?.customer === "string" ? sub.customer : sub?.customer?.id;
  const where = orgId ? { id: orgId } : customerId ? { stripeCustomerId: customerId } : null;
  if (!where) return;

  const priceId = sub?.items?.data?.[0]?.price?.id;
  const planKey = sub?.metadata?.plan && isPlanKey(sub.metadata.plan) ? sub.metadata.plan : planForPrice(priceId);
  const data: any = {
    stripeSubscriptionId: sub.id,
    subscriptionStatus: normalizeStatus(String(sub.status)),
    cancelAtPeriodEnd: !!sub.cancel_at_period_end,
    billingMode: "standard",
  };
  if (customerId) data.stripeCustomerId = customerId;
  if (planKey) data.plan = planKey;
  if (sub.current_period_end) data.currentPeriodEnd = new Date(sub.current_period_end * 1000);
  await prisma.org.updateMany({ where, data });
}

// Public webhook endpoint. Mounted with a raw body parser so the signature can
// be verified. Never throws into Express.
export async function handleStripeWebhook(req: Request, res: Response): Promise<void> {
  if (!stripe) {
    res.status(503).json({ error: "billing_not_configured" });
    return;
  }
  let event: Stripe.Event;
  try {
    const sig = req.headers["stripe-signature"] as string;
    event = stripe.webhooks.constructEvent(req.body, sig, config.stripe.webhookSecret);
  } catch (err: any) {
    res.status(400).send(`Webhook signature verification failed: ${err?.message || "error"}`);
    return;
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session: any = event.data.object;
        const orgId = session?.metadata?.orgId;
        const customerId = typeof session?.customer === "string" ? session.customer : session?.customer?.id;
        if (orgId && customerId) {
          await prisma.org.updateMany({ where: { id: orgId }, data: { stripeCustomerId: customerId } });
        }
        // The subscription.created/updated event carries full plan+status detail.
        if (session?.subscription && typeof session.subscription !== "string") {
          await applySubscription(session.subscription);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
        await applySubscription(event.data.object as any);
        break;
      case "customer.subscription.deleted": {
        const sub: any = event.data.object;
        const customerId = typeof sub?.customer === "string" ? sub.customer : sub?.customer?.id;
        const where = sub?.metadata?.orgId ? { id: sub.metadata.orgId } : customerId ? { stripeCustomerId: customerId } : null;
        if (where) await prisma.org.updateMany({ where, data: { subscriptionStatus: "canceled" } });
        break;
      }
      case "invoice.payment_failed": {
        const inv: any = event.data.object;
        const customerId = typeof inv?.customer === "string" ? inv.customer : inv?.customer?.id;
        if (customerId) await prisma.org.updateMany({ where: { stripeCustomerId: customerId }, data: { subscriptionStatus: "past_due" } });
        break;
      }
      default:
        break;
    }
    res.json({ received: true });
  } catch (err: any) {
    // Log and 200 so Stripe doesn't hammer retries on a non-signature error;
    // the next lifecycle event will reconcile state.
    console.error("stripe webhook handler error:", err?.message || err);
    res.json({ received: true });
  }
}

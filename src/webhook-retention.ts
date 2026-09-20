import { prisma } from "./db";

export function webhookDeliveryCutoff(retentionDays: number, now = new Date()): Date {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}

// Delivery inspector payloads may contain lead/contact data. Remove the entire
// row after the configured troubleshooting window instead of retaining a
// replayable request body and signature indefinitely.
export async function pruneWebhookDeliveries(retentionDays: number, now = new Date()): Promise<number> {
  const result = await prisma.webhookDelivery.deleteMany({
    where: { createdAt: { lt: webhookDeliveryCutoff(retentionDays, now) } },
  });
  return result.count;
}

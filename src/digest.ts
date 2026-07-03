// Pure manager-digest helpers — no db/mail. Recipient parsing, cadence/due logic,
// and the digest subject + plain-text body. The route/scheduler sends it.

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function parseDigestEmails(raw: string | null | undefined): string[] {
  return String(raw || "")
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter((e) => EMAIL.test(e));
}

// Is a weekly digest due? (off = never; weekly = never sent or 7+ days ago.)
export function digestDue(cadence: string, lastSentAt: Date | string | null | undefined, now: Date = new Date()): boolean {
  if (cadence !== "weekly") return false;
  if (!lastSentAt) return true;
  return now.getTime() - new Date(lastSentAt).getTime() >= 7 * 86400000;
}

export type DigestMetrics = {
  views: number;
  vcards: number;
  clicks: number;
  assetScans: number;
  leads: number;
  conversion: number;
  topRooftops: { name: string; leads: number }[];
  topSources: { key: string; count: number }[];
};

export function buildDigest(orgName: string, rangeLabel: string, m: DigestMetrics): { subject: string; text: string } {
  const subject = `${orgName} — OpenCard digest (${rangeLabel})`;
  const lines = [
    `${orgName} — activity ${rangeLabel.toLowerCase()}`,
    "",
    `Card views:       ${m.views}`,
    `Contacts saved:   ${m.vcards}`,
    `Link clicks:      ${m.clicks}`,
    `QR asset scans:   ${m.assetScans}`,
    `Leads captured:   ${m.leads}`,
    `View → lead rate: ${m.conversion}%`,
    "",
    "Top rooftops by leads:",
    ...(m.topRooftops.length ? m.topRooftops.map((r, i) => `  ${i + 1}. ${r.name} — ${r.leads}`) : ["  (none)"]),
    "",
    "Top lead sources:",
    ...(m.topSources.length ? m.topSources.map((s) => `  - ${s.key}: ${s.count}`) : ["  (none)"]),
    "",
    "— OpenCard",
  ];
  return { subject, text: lines.join("\n") };
}

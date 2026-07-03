// Pure audit helpers — no db. Action catalog + human labels + actor formatting.
// The recording (db) lives in audit-log.ts.

export const AUDIT_ACTIONS: Record<string, string> = {
  "login.success": "Signed in",
  "login.failed": "Failed sign-in",
  "login.token": "Break-glass token sign-in",
  "admin.create": "Added admin",
  "admin.update": "Updated admin",
  "admin.delete": "Removed admin",
  "staff.create": "Added OpenCard staff",
  "staff.update": "Updated OpenCard staff",
  "staff.delete": "Removed OpenCard staff",
  "apikey.create": "Created API key",
  "apikey.revoke": "Revoked API key",
  "webhook.create": "Added webhook",
  "webhook.delete": "Deleted webhook",
  "crm.create": "Added CRM integration",
  "crm.delete": "Removed CRM integration",
  "billing.plan": "Changed plan / billing",
  "sso.update": "Updated SSO config",
  "scim.token": "Generated SCIM token",
  "domain.add": "Added custom domain",
  "domain.remove": "Removed custom domain",
  "brand.delete": "Deleted brand",
  "card.delete": "Deleted / offboarded card",
  "data.export": "Exported org data",
  "data.delete": "Deleted data",
};

export function auditLabel(action: string): string {
  return AUDIT_ACTIONS[action] || action;
}

// Human label for who performed an action (email, or a system/token marker).
export function formatAuditActor(email: string | null | undefined, role: string | null | undefined): string {
  if (email) return email;
  return role ? `${role} (token)` : "System / token";
}

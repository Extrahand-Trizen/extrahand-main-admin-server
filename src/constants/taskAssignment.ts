/**
 * Only these 3 operations admins receive task_posted in-app notifications (round-robin).
 * No email is sent for task assignment — dashboard bell only.
 */
export const TASK_POSTED_ROUND_ROBIN_EMAILS = [
  'santhoshu@cognitbotz.com',
  'durgamshiva@cognitbotz.com',
  'tadembharat@cognitbotz.com',
] as const;

export const TASK_ASSIGNED_EMAIL_TO_NAME: Record<string, string> = {
  'santhoshu@cognitbotz.com': 'santhosh reddy',
  'durgamshiva@cognitbotz.com': 'durgamshiva',
  'tadembharat@cognitbotz.com': 'tadembharath',
};

export const TASK_ASSIGNED_EMAILS = Object.keys(TASK_ASSIGNED_EMAIL_TO_NAME);

export function normalizeAdminEmail(email?: string): string {
  return String(email || '').trim().toLowerCase();
}

export function resolveAssignedDisplayName(email?: string, fallbackName?: string): string {
  const normalized = normalizeAdminEmail(email);
  return TASK_ASSIGNED_EMAIL_TO_NAME[normalized] || fallbackName || normalized || 'Unknown';
}

export function normalizeTaskIdForAssignment(raw: unknown): string {
  if (!raw) return '';
  if (typeof raw === 'object' && raw !== null) {
    const oid = (raw as { $oid?: string }).$oid;
    if (oid) return String(oid).trim();
    const id = (raw as { _id?: unknown })._id;
    if (id) return normalizeTaskIdForAssignment(id);
  }
  return String(raw).trim();
}

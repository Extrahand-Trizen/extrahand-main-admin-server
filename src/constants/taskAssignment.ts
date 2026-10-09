/**
 * These 4 operations admins receive task_posted in-app notifications (round-robin).
 * No email is sent for task assignment — dashboard bell only.
 * Round-robin order: durgamshiva → shivakumar → bandelabharathreddy → saikumar
 */
export const TASK_POSTED_ROUND_ROBIN_EMAILS = [
  'durgamshiva@cognitbotz.com',
  'shivakumar@cognitbotz.com',
  'bharatr@cognitbotz.com',
  'saikumarn@cognitbotz.com',
] as const;

export const TASK_POSTED_EMAIL_RECIPIENTS = [
  'harishv@cognitbotz.com',
  'nukaraju@trizenventures.com',
  'durgamshiva@cognitbotz.com',
  'shivakumar@cognitbotz.com',
  'bharatr@cognitbotz.com',
  'saikumarn@cognitbotz.com',
  'avvaruasishvenkat.22.cse@anits.edu.in',
  'vinayreddy@cognitbotz.com',
] as const;

export const TASK_ASSIGNED_EMAIL_TO_NAME: Record<string, string> = {
  'durgamshiva@cognitbotz.com': 'durgamshiva',
  'shivakumar@cognitbotz.com': 'shivakumar',
  'bharatr@cognitbotz.com': 'bandelabharathreddy',
  'saikumarn@cognitbotz.com': 'saikumar',
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
    const buffer = (raw as { buffer?: Uint8Array; toString?: () => string }).buffer;
    if (buffer && buffer.length === 12) {
      return Array.from(buffer)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }
    if (typeof (raw as { toString?: () => string }).toString === 'function') {
      const asString = (raw as { toString: () => string }).toString();
      if (/^[a-f0-9]{24}$/i.test(asString)) return asString;
    }
    const id = (raw as { _id?: unknown })._id;
    if (id) return normalizeTaskIdForAssignment(id);
  }
  const text = String(raw).trim();
  const hexMatch = text.match(/[a-f0-9]{24}/i);
  return hexMatch ? hexMatch[0] : text;
}

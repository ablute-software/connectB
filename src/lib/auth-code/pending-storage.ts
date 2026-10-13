// Prompt 911 — "the form is not lost between Create account and the code". Once a code has been sent, the page writes what the
// person typed (everything EXCEPT the password) here, and a reload comes back to the code box for that email with the form
// still filled in. Same idea and same storage as the magic-link guard (src/lib/magic-link-storage.ts) — localStorage, so it
// also survives reopening the tab while waiting for the email — but it carries the form, and is namespaced per flow so
// /signup, a team invite and an incubator invite never read each other's.
//
// The password is NEVER stored: after a reload the code box asks for it again. Entries die with the code (30 minutes).
export const PENDING_TTL_MS = 30 * 60 * 1000;

export type PendingFlow = 'signup' | 'invite' | 'member';
export interface PendingSignup {
  flow: PendingFlow;
  /** What the entry belongs to: 'signup' for /signup, the invite token for the invite pages. A different scope is not ours. */
  scope: string;
  email: string;
  sentAt: number;
  /** The non-secret fields of the form, by name. */
  fields: Record<string, string | boolean>;
}

const key = (flow: PendingFlow) => `sd-code-signup-pending:${flow}`;

export function readPending(flow: PendingFlow, scope: string, now: number = Date.now()): PendingSignup | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key(flow));
    if (!raw) return null;
    const p = JSON.parse(raw) as PendingSignup;
    if (!p || p.flow !== flow || p.scope !== scope || typeof p.email !== 'string' || !p.email || typeof p.sentAt !== 'number') return null;
    const age = now - p.sentAt;
    if (!(age >= 0) || age > PENDING_TTL_MS) { window.localStorage.removeItem(key(flow)); return null; }
    return { ...p, fields: p.fields && typeof p.fields === 'object' ? p.fields : {} };
  } catch { return null; }
}

export function writePending(p: PendingSignup): void {
  if (typeof window === 'undefined') return;
  try {
    // Defence in depth: whatever the caller passes, a field called like a secret is dropped.
    const fields = Object.fromEntries(Object.entries(p.fields).filter(([k]) => !/pass(word)?|secret|token/i.test(k)));
    window.localStorage.setItem(key(p.flow), JSON.stringify({ ...p, fields }));
  } catch { /* private window / blocked storage: the flow still works, it just does not survive a reload */ }
}

export function clearPending(flow: PendingFlow): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(key(flow)); } catch { /* ignore */ }
}

// Prompt 918 (I3) — "Possible duplicate" (spec §15). The platform NEVER blocks on a suspicion: it tells the person who runs the call which applications of the SAME call share something, and why, and
// that person decides (two brands of one legal entity are one entity but different projects). Pure: the route gathers the facts, this compares them. Only applications of one call are ever compared.
import { normalizeName } from './doc-analysis';

export const SIGNALS = ['same_name', 'same_website', 'same_email_domain', 'same_person', 'same_tax_id'] as const;
export type DuplicateSignal = (typeof SIGNALS)[number];

export const SIGNAL_TEXT: Record<DuplicateSignal, string> = {
  same_name: 'the same company name', same_website: 'the same website', same_email_domain: 'the same email domain', same_person: 'the same person in both', same_tax_id: 'the same tax ID',
};

/** Mailbox providers whose domain says nothing about the company. */
export const GENERIC_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.pt', 'outlook.com', 'outlook.pt', 'live.com', 'live.pt', 'msn.com', 'yahoo.com', 'yahoo.pt', 'ymail.com', 'icloud.com', 'me.com', 'mac.com',
  'proton.me', 'protonmail.com', 'aol.com', 'gmx.com', 'gmx.net', 'mail.com', 'sapo.pt', 'netcabo.pt', 'clix.pt', 'iol.pt', 'zoho.com', 'yandex.com', 'pm.me', 'tutanota.com',
]);

export interface DuplicateFacts {
  applicationId: string;
  reference: string | null;
  startup: string;
  website: string | null;
  /** The email addresses of the people of the applying startup. */
  emails: string[];
  /** The people (user ids) of the applying startup. */
  people: string[];
  /** The tax ID declared in the application, when the call asks for it. */
  taxId: string | null;
}

/** "https://www.Acme.pt/about" → "acme.pt". */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  const raw = url.trim().toLowerCase();
  if (!raw) return null;
  try {
    const host = new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./, '');
    return host.includes('.') ? host : null;
  } catch { return null; }
}
export const domainOf = (email: string): string | null => { const d = email.split('@')[1]?.trim().toLowerCase(); return d && d.includes('.') ? d : null; };
const digits = (s: string | null): string => (s ?? '').replace(/\D/g, '');

export interface PossibleDuplicate { applicationId: string; reference: string | null; startup: string; signals: DuplicateSignal[] }

/** For each application, the others of the same call that share a signal with it. Applications with nothing in common are absent. */
export function findPossibleDuplicates(apps: DuplicateFacts[]): Map<string, PossibleDuplicate[]> {
  const out = new Map<string, PossibleDuplicate[]>();
  const n = apps.map((a) => ({
    a, name: normalizeName(a.startup), host: hostOf(a.website),
    domains: new Set(a.emails.map(domainOf).filter((d): d is string => !!d && !GENERIC_EMAIL_DOMAINS.has(d))),
    people: new Set(a.people), tax: digits(a.taxId).length === 9 ? digits(a.taxId) : '',
  }));
  for (let i = 0; i < n.length; i++) {
    for (let j = i + 1; j < n.length; j++) {
      const x = n[i]; const y = n[j];
      const signals: DuplicateSignal[] = [];
      if (x.name && x.name === y.name) signals.push('same_name');
      if (x.host && x.host === y.host) signals.push('same_website');
      if ([...x.domains].some((d) => y.domains.has(d))) signals.push('same_email_domain');
      if ([...x.people].some((p) => y.people.has(p))) signals.push('same_person');
      if (x.tax && x.tax === y.tax) signals.push('same_tax_id');
      if (signals.length === 0) continue;
      const push = (from: typeof x, to: typeof x) => out.set(from.a.applicationId, [...(out.get(from.a.applicationId) ?? []), { applicationId: to.a.applicationId, reference: to.a.reference, startup: to.a.startup, signals }]);
      push(x, y); push(y, x);
    }
  }
  return out;
}

export const duplicateSentence = (d: PossibleDuplicate): string => `${d.startup}${d.reference ? ` (${d.reference})` : ''}: ${d.signals.map((s) => SIGNAL_TEXT[s]).join(', ')}.`;

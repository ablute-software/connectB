// Prompt 284 §1 — pure helpers for the "Domain mismatch" backoffice queue.
// Real case that prompted this: Nalka Invest had email_domain
// "nalkainvest.com" (a typo/guess) while the real site is nalka.com, team
// fully published there, emails included. Measured in production: 54
// entities had email_domain with no relation to website; NOT a bulk-fix —
// three distinct groups (obvious junk, a wrong-domain typo like Nalka, and
// legitimate cases where email genuinely uses a different domain on
// purpose, e.g. a parent company) — hence suggest, never auto-apply.
export interface DomainMismatchSuggestion {
  kind: 'suggest_domain' | 'probably_intentional' | 'none';
  domain?: string;
}

// Same test Nuno used in production (`position(lower(email_domain) in
// lower(website)) = 0`): does email_domain appear anywhere in website as a
// substring — website is a full URL ("https://nalka.com"), email_domain is
// a bare domain ("nalkainvest.com"), so substring, not equality, is correct.
export function hasDomainMismatch(website: string | null | undefined, emailDomain: string | null | undefined): boolean {
  if (!website || !emailDomain) return false;
  return !website.toLowerCase().includes(emailDomain.toLowerCase());
}

export function emailDomainOf(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf('@');
  if (at === -1 || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase().trim() || null;
}

// Evidence-based suggestion, only from data already sitting on the same
// row — never a web lookup, this is a review queue, not a re-enrichment.
// If `email`'s own domain disagrees with email_domain too, that's real
// evidence of what the right value probably is (the 33N case: email is
// info@33n.vc, email_domain is gmail.com — email_domain is obviously wrong).
// If they agree, the mismatch vs website is probably intentional (Crista
// Galli: email uses ipqcap.com, the parent IPQ Capital — a real, deliberate
// choice, not an error) — flagged for a human to confirm, never assumed.
export function suggestDomainFix(email: string | null | undefined, emailDomain: string | null | undefined): DomainMismatchSuggestion {
  const fromEmail = emailDomainOf(email);
  if (!fromEmail) return { kind: 'none' };
  if (fromEmail === (emailDomain ?? '').toLowerCase().trim()) return { kind: 'probably_intentional' };
  return { kind: 'suggest_domain', domain: fromEmail };
}

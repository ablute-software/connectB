// "Claim this profile" — investor_entity_claims domain verification.
//
// The one hard rule from the prompt: domain comparison is by REGISTRABLE
// domain (eTLD+1) with EXACT equality, using a real public-suffix list
// (psl) — never endsWith/includes. "xnorthbridge.com".endsWith("northbridge.com")
// is true; that's the exact impersonation this function must never allow.
// A subdomain (mail.entity.com) still matches because its eTLD+1 IS
// entity.com — psl.get() resolves both to the same string, and the
// comparison after that is plain ===, nothing string-prefix/suffix based.
//
// Deliberately a SEPARATE function from investor-domain-match.ts's
// domainMatchesEntity() (used by the unrelated investor_access_requests
// lead-form flow) rather than a shared rewrite — that flow's own
// dot-prefixed endsWith check is a different, narrower call site this
// item wasn't asked to touch, and reusing normalizeDomain (host
// extraction only, no eTLD+1 resolution) from catalog-dedupe.ts is as far
// as this borrows from it.
import psl from 'psl';
import { normalizeDomain } from './catalog-dedupe';

// Same freemail set the prompt names explicitly (§2.4) — a provider
// anyone can register an address at, so it can never be proof of
// affiliation with a specific firm regardless of what the firm's own
// catalog_entities.website/email resolve to.
const FREEMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com', 'protonmail.com', 'proton.me', 'icloud.com', 'me.com', 'sapo.pt', 'mail.com', 'gmx.com', 'gmx.net',
]);

// §3.7 — a role mailbox (info@, contact@, office@) at the RIGHT domain is
// still a valid match (someone at the firm controls that inbox), but the
// prompt wants it flagged for the reviewing admin to look twice — an
// intern with inbox access isn't a partner.
const ROLE_MAILBOX_LOCAL_PARTS = new Set(['info', 'contact', 'office', 'hello', 'team', 'admin', 'support', 'general']);

export function registrableDomain(input: string | null | undefined): string | null {
  const host = normalizeDomain(input);
  if (!host) return null;
  // psl.get returns null for a bare public suffix itself (e.g. "co.uk"
  // with nothing in front) or an unparseable host — both correctly treated
  // as "no usable domain to match against" rather than a false match.
  return psl.get(host);
}

// Exact equality only — this is the whole security property. No
// startsWith/endsWith/includes call exists anywhere in this comparison.
export function domainsMatch(a: string | null, b: string | null): boolean {
  return !!a && !!b && a === b;
}

export function isFreemailDomain(domain: string | null): boolean {
  return !!domain && FREEMAIL_DOMAINS.has(domain);
}

export function isRoleMailboxEmail(email: string): boolean {
  const local = email.split('@')[0]?.toLowerCase().trim();
  return !!local && ROLE_MAILBOX_LOCAL_PARTS.has(local);
}

export interface ClaimDomainVerdict {
  claimantDomain: string | null;
  entityDomain: string | null;
  domainMatch: boolean;
  // §3.5 — domainMatch alone is never the decision, only evidence a human
  // reviews; these two flags are additional context in that same evidence,
  // not additional gates.
  entityDomainIsFreemail: boolean;
  roleMailbox: boolean;
}

// entityWebsite/entityEmail: catalog_entities' OWN registered values —
// never anything the claimant supplies. entityEmail is the fallback per
// §2.2 ("fallback: domínio de catalog_entities.email") when website is
// unset or unparseable.
export function evaluateClaimDomain(opts: {
  claimantEmail: string;
  entityWebsite: string | null;
  entityEmail: string | null;
}): ClaimDomainVerdict {
  const claimantDomain = registrableDomain(opts.claimantEmail.includes('@') ? `https://${opts.claimantEmail.split('@')[1]}` : null);
  const entityDomain = registrableDomain(opts.entityWebsite) ?? registrableDomain(opts.entityEmail);
  const entityDomainIsFreemail = isFreemailDomain(entityDomain);
  // §2.4 — a freemail entity domain (bad/thin catalog data, e.g. a solo
  // angel whose "website" field was never filled and only an email is on
  // file) can NEVER auto-match, regardless of what the claimant's own
  // email domain is — anyone can register firm@gmail.com.
  const domainMatch = !entityDomainIsFreemail && domainsMatch(claimantDomain, entityDomain);
  return {
    claimantDomain, entityDomain, domainMatch, entityDomainIsFreemail,
    roleMailbox: isRoleMailboxEmail(opts.claimantEmail),
  };
}

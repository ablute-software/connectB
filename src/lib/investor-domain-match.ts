// Investor claim/access-request domain verification (Anexo B, claim-decision
// matrix): a self-declared "I work at X" is not proof of affiliation — the
// registration email's domain must match the claimed entity's own official
// domain (root or subdomain) for V1 automatic eligibility. Anything else —
// generic freemail, a domain that doesn't match, an entity with no website
// on file, or a firm name that doesn't resolve to a catalog entity at all —
// always falls to manual review, regardless of LinkedIn or a filled-in name
// (Anexo B: those are supporting signals, never sufficient proof alone).
//
// Reuses normalizeDomain/normalizeName from catalog-dedupe.ts — the same
// domain-extraction and fuzzy-name-matching already used for catalog
// duplicate detection, rather than reimplementing either.
import { normalizeDomain, normalizeName, type Alias, type CatalogRow } from './catalog-dedupe';

// Common freemail/webmail providers — never a legitimate "official entity
// domain" match even in the freak case a catalog row's website happens to
// resolve to one of these (bad data entry), per Anexo B: "Gmail ... nunca
// aprovar automaticamente".
const GENERIC_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com', 'icloud.com', 'me.com', 'aol.com', 'protonmail.com', 'proton.me', 'gmx.com',
]);

export type DomainMatchVerdict =
  | { kind: 'match'; entityId: string; entityName: string; entityDomain: string; emailDomain: string }
  | { kind: 'mismatch'; entityId: string; entityName: string; entityDomain: string; emailDomain: string }
  | { kind: 'generic_email'; emailDomain: string }
  | { kind: 'no_entity_website'; entityId: string; entityName: string; emailDomain: string }
  | { kind: 'no_entity_match'; firmName: string | null; emailDomain: string | null };

export function domainMatchesEntity(emailDomain: string, entityDomain: string): boolean {
  return emailDomain === entityDomain || emailDomain.endsWith(`.${entityDomain}`);
}

// Best-effort name→catalog-entity resolution: exact match (after
// normalization) against the entity's own name or any of its aliases. Not
// fuzzy/substring — an ambiguous or partial match is exactly the kind of
// unproven claim this check exists to catch, so it falls through to
// no_entity_match (manual review) rather than guessing.
export function resolveClaimedEntity(
  firmName: string | null | undefined,
  entities: CatalogRow[],
  aliases: Alias[] = [],
): CatalogRow | null {
  if (!firmName?.trim()) return null;
  const target = normalizeName(firmName);
  if (!target) return null;

  const aliasEntityIds = new Set(aliases.filter((a) => normalizeName(a.alias) === target).map((a) => a.catalog_id));
  const matches = entities.filter((e) => normalizeName(e.name) === target || aliasEntityIds.has(e.id));
  // More than one distinct entity resolves to the same normalized name —
  // ambiguous, don't guess which one is being claimed.
  return matches.length === 1 ? matches[0] : null;
}

export function checkInvestorDomainMatch(opts: {
  email: string;
  firmName: string | null | undefined;
  entities: CatalogRow[];
  aliases?: Alias[];
}): DomainMatchVerdict {
  const emailDomain = normalizeDomain(opts.email.includes('@') ? `https://${opts.email.split('@')[1]}` : null);

  const entity = resolveClaimedEntity(opts.firmName, opts.entities, opts.aliases ?? []);
  if (!entity) return { kind: 'no_entity_match', firmName: opts.firmName ?? null, emailDomain };

  if (emailDomain && GENERIC_EMAIL_DOMAINS.has(emailDomain)) return { kind: 'generic_email', emailDomain };

  const entityDomain = normalizeDomain(entity.website);
  if (!entityDomain) return { kind: 'no_entity_website', entityId: entity.id, entityName: entity.name, emailDomain: emailDomain ?? '' };

  if (!emailDomain) return { kind: 'no_entity_match', firmName: opts.firmName ?? null, emailDomain: null };

  if (domainMatchesEntity(emailDomain, entityDomain)) {
    return { kind: 'match', entityId: entity.id, entityName: entity.name, entityDomain, emailDomain };
  }
  return { kind: 'mismatch', entityId: entity.id, entityName: entity.name, entityDomain, emailDomain };
}

// True only for the one verdict kind that's eligible for V1 automatic
// approval, subject to the caller's other checks (e.g. no conflicting claim
// already active on the same entity) — this function only answers the
// domain-verification question, nothing else in the matrix.
export function isAutoEligible(verdict: DomainMatchVerdict): boolean {
  return verdict.kind === 'match';
}

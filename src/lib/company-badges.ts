// Prompt 326 — badges/awards with AI-assisted verification. Pure rules
// only; I/O (web search, PDF read, Storage, DB) lives in the API routes
// and company-badge-verify-core.ts, same pure/adapter split as company-gaps.ts.
//
// Prompt 918 — the rule INVERTED. Prompt 326 §E showed an unverified badge to
// the investor greyed out ("never hide an unverified claim"). From 918 on an
// investor sees ONLY a badge Sherlock confirmed against a public source, with
// that source attached; the founder may record anything, and what is not
// verified stays private. Why (Nuno, 15/10/2026): a badge with nothing behind
// it, even greyed, is a statement without a source on the profile — it
// contradicts "facts, not text". See DECISIONS.md, Prompt 918.
import { findDuplicateCandidate } from './company-claims';
import type { CompanyClaim } from './types';

export type BadgeVerificationStatus = 'unverified' | 'verified' | 'disputed';

// What kind of thing it is — picks the fallback icon and the label the investor sees.
export const BADGE_KINDS = ['award', 'certification', 'programme', 'recognition'] as const;
export type BadgeKind = (typeof BADGE_KINDS)[number];
export const BADGE_KIND_LABEL: Record<BadgeKind, string> = {
  award: 'Award', certification: 'Certification', programme: 'Programme', recognition: 'Recognition',
};
export function parseBadgeKind(value: unknown): BadgeKind {
  return (BADGE_KINDS as readonly string[]).includes(value as string) ? (value as BadgeKind) : 'award';
}

export type BadgeSourceFoundBy = 'founder' | 'sherlock';

/** The row as the founder sees it (their own data about their own company — includes the verification note). */
export interface CompanyBadge {
  id: string; name: string; description: string | null; year: number | null; kind: BadgeKind;
  logo_storage_path: string | null; logo_url: string | null; evidence_document_id: string | null;
  verification_status: BadgeVerificationStatus; verification_note: string | null; verified_at: string | null;
  source_url: string | null; source_title: string | null; source_found_by: BadgeSourceFoundBy | null;
  /** Moves on every edit and every verification: the card appends it to the logo URL so a new logo is never shown from the browser's cache. */
  updated_at?: string | null;
}

// Notes the system writes itself. The first one is ALSO written by the 918 migration's backfill (same words, on purpose).
export const REVERIFY_TO_ATTACH_SOURCE_NOTE = 'Re-verify to attach a public source';
export const NO_STABLE_SOURCE_NOTE = 'Confirmed in search but no stable public source — add a link';
export const EDITED_NOTE = 'Edited — verify again to show it to investors';

// ---------------------------------------------------------------------------------------------------------------------
// The source link

const MAX_URL_LENGTH = 2000;

/**
 * A link the founder (or the verification) can attach as the public source of a badge: a real http(s) page on a real host name.
 * Returns the cleaned URL, or null when it is not one. This is a SYNTAX check (no credentials, no localhost, no IP literals, no
 * fragment); whether the address resolves to somewhere private is decided at fetch time, by the safe fetcher, never here.
 */
export function normalizeSourceUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let text = raw.trim();
  if (!text || text.length > MAX_URL_LENGTH) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;
  let url: URL;
  try { url = new URL(text); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || host.startsWith('[') || /^\d+(\.\d+){3}$/.test(host)) return null; // a name, not an IP literal
  if (host === 'localhost' || /\.(local|localhost|internal|lan|home|corp)$/.test(host)) return null;
  url.hash = '';
  return url.toString();
}

/** "altice.pt" for "https://www.altice.pt/premios/2023" — what the founder and the investor read next to "source:". */
export function sourceDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
}

// ---------------------------------------------------------------------------------------------------------------------
// The verdict

// Pedido B (326) + 918 B.3 — verified only on real confirmation AND a public source to point at; disputed only on an ACTIVE
// contradiction the AI found; everything else (including "found nothing") stays unverified indefinitely — the founder can ask
// again. Never automated escalation, never a default-to-verified fallback. A confirmation with no source worth storing is NOT
// a verification: there would be nothing to show the investor next to the badge.
export function resolveBadgeVerification(params: {
  foundCredibleConfirmation: boolean; foundContradiction: boolean; note: string; sourceUrl: string | null;
}): { status: BadgeVerificationStatus; note: string } {
  if (params.foundContradiction) return { status: 'disputed', note: params.note };
  if (params.foundCredibleConfirmation) {
    if (normalizeSourceUrl(params.sourceUrl)) return { status: 'verified', note: params.note };
    return { status: 'unverified', note: NO_STABLE_SOURCE_NOTE };
  }
  return { status: 'unverified', note: params.note };
}

// ---------------------------------------------------------------------------------------------------------------------
// Editing a badge

export interface BadgeBeforeEdit {
  name: string; year: number | null; source_url: string | null;
  verification_status: BadgeVerificationStatus; source_found_by: BadgeSourceFoundBy | null;
}
export interface BadgeEditBody {
  name?: string; description?: string | null; year?: number | null; kind?: unknown; sourceUrl?: string | null;
  logoStoragePath?: string | null; evidenceDocumentId?: string | null; linkedClaimId?: string | null;
}

/**
 * The columns a founder's edit writes, and whether it sends the badge back to "unverified". What was verified is a statement about
 * ONE name, ONE year and ONE source: change any of the three and the old verdict no longer describes what is on the page, so the
 * badge goes private again until it is verified again (918 B.5). Description, kind, logo, document and claim links do not touch it.
 * The verdict's own fields (note, date, title, found logo) are never settable from here — only a verification writes them.
 */
export function buildBadgePatch(before: BadgeBeforeEdit, body: BadgeEditBody): { patch: Record<string, unknown>; resetsVerification: boolean } {
  const patch: Record<string, unknown> = {};
  let identityChanged = false;

  if (body.name !== undefined) {
    const name = body.name.trim();
    patch.name = name;
    if (name !== before.name) identityChanged = true;
  }
  if (body.year !== undefined) {
    patch.year = body.year;
    if (body.year !== before.year) identityChanged = true;
  }
  if (body.sourceUrl !== undefined) {
    const url = body.sourceUrl === null ? null : normalizeSourceUrl(body.sourceUrl);
    // The form always sends the link it shows; an unchanged one must not touch who found it (a link Sherlock found stays Sherlock's,
    // exactly as the database guard keeps it). Only a different link is the founder's.
    if (url !== before.source_url) {
      patch.source_url = url;
      patch.source_found_by = url ? 'founder' : null;
      identityChanged = true;
    }
  }
  if (body.description !== undefined) patch.description = body.description?.trim() || null;
  if (body.kind !== undefined) patch.kind = parseBadgeKind(body.kind);
  if (body.logoStoragePath !== undefined) patch.logo_storage_path = body.logoStoragePath;
  if (body.evidenceDocumentId !== undefined) patch.evidence_document_id = body.evidenceDocumentId;
  if (body.linkedClaimId !== undefined) patch.linked_claim_id = body.linkedClaimId;

  const resetsVerification = identityChanged && before.verification_status !== 'unverified';
  if (resetsVerification) {
    patch.verification_status = 'unverified';
    patch.verified_at = null;
    patch.verification_note = EDITED_NOTE;
    patch.source_title = null;
    patch.logo_url = null;
  }
  return { patch, resetsVerification };
}

// ---------------------------------------------------------------------------------------------------------------------
// What the founder reads about each badge

export type BadgeStatusTone = 'private' | 'contradicted' | 'visible';

/** C.2 — the line under each badge in the founder's own card, in exactly these words. `fmtDate` formats an ISO date. */
export function badgeStatusLine(
  b: Pick<CompanyBadge, 'verification_status' | 'verification_note' | 'verified_at' | 'source_url'>, fmtDate: (iso: string) => string,
): { tone: BadgeStatusTone; text: string } {
  if (b.verification_status === 'disputed') {
    const note = b.verification_note?.trim();
    return { tone: 'contradicted', text: note ? `Private — contradicted by public sources: ${note}` : 'Private — contradicted by public sources' };
  }
  const domain = sourceDomain(b.source_url);
  if (b.verification_status === 'verified' && domain && b.verified_at) {
    return { tone: 'visible', text: `Visible to investors · verified ${fmtDate(b.verified_at)} · source: ${domain}` };
  }
  return { tone: 'private', text: 'Private — not shown to investors until verified' };
}

/** C.3 — the sentence at the top of the card. */
export const BADGES_FOUNDER_INTRO =
  'Investors only see badges Sherlock has confirmed against public sources and your documents. '
  + 'Add the link to the award page or a public news piece to speed up verification.';

/** D.2 — the line above the investor's block. "Confirmed against", never a guarantee: Sherlock reports what it found, it does not certify. */
export const BADGES_INVESTOR_DISCLAIMER = "Shown only after Sherlock confirmed each one against public sources and the founder's documents.";

/** D.2 — the label under each verified badge: "Verified by Sherlock · 14 Oct 2026". */
export const BADGE_VERIFIED_LABEL = 'Verified by Sherlock';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "14 Oct 2026" (dd Mon yyyy) from an ISO timestamp, in UTC so every viewer reads the same day. An unparseable value gives ''. */
export function formatBadgeDate(iso: string | null | undefined): string {
  const t = iso ? new Date(iso) : null;
  if (!t || Number.isNaN(t.getTime())) return '';
  return `${String(t.getUTCDate()).padStart(2, '0')} ${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}`;
}

/** C.4 / D.1 — where a badge's logo comes from, best first: the founder's own upload, the one verification found, or the icon for its kind. */
export function badgeLogoSource(b: { logo_storage_path?: string | null; logoStoragePath?: string | null; logo_url?: string | null; logoUrl?: string | null }): 'upload' | 'found' | 'icon' {
  if (b.logo_storage_path ?? b.logoStoragePath) return 'upload';
  if (b.logo_url ?? b.logoUrl) return 'found';
  return 'icon';
}

// ---------------------------------------------------------------------------------------------------------------------
// Claims dedup (Pedido C, unchanged)

// Pedido C — the SAME dedup check the claims engine already runs
// (findDuplicateCandidate, Prompt 311), never a second, disconnected
// heuristic. A badge is modeled as a synthetic evidence_class=5
// ("decoration") claim candidate for exactly this one check — never
// inserted as a real company_claims row itself.
export function findMatchingClaimForBadge(
  badge: { name: string; description: string | null },
  claimsPool: Pick<CompanyClaim, 'id' | 'statement' | 'status' | 'evidenceClass'>[],
): { id: string; statement: string } | null {
  // Description first, name last: extractNamedEntity (company-claims.ts)
  // deliberately skips whatever capitalized word opens the statement (its
  // own documented behavior, inherited from the original claims-engine
  // heuristic) and grabs the FIRST capitalized run after that — a person's
  // or entity's name is far more likely to land there when the free-text
  // description (which usually names who/what, e.g. "Awarded to Carla
  // Dias") comes first and the badge's own short title comes last.
  const statement = [badge.description, badge.name].filter(Boolean).join(' — ');
  return findDuplicateCandidate({ id: 'new-badge', statement, evidenceClass: 5 }, claimsPool);
}

// ---------------------------------------------------------------------------------------------------------------------
// The investor-facing projection

/** What the dossier reads from the table. Everything the investor must never see (the note, the evidence document, the claim link, the description) is simply not on this type. */
export interface BadgeForProjection {
  id: string; name: string; year: number | null; kind: BadgeKind;
  verificationStatus: BadgeVerificationStatus;
  sourceUrl: string | null; sourceTitle: string | null; verifiedAt: string | null;
  logoStoragePath: string | null; logoUrl: string | null;
}

/** The one shape an investor receives. No status field: if it is here, it is verified. */
export interface BadgePublic {
  id: string; name: string; kind: BadgeKind; year: number | null;
  /** Our own route that streams the logo (upload first, else the one verification found — C.4's order is applied by that route); null → the icon for `kind`. */
  logoUrl: string | null;
  sourceUrl: string; sourceTitle: string | null; verifiedAt: string;
}

/**
 * The routes that stream a badge's logo from OUR origin — the founder's upload AND the one verification found, never a storage URL
 * (Prompt 750) and never the third party's own address: an <img> pointing at a host the founder's source page chose would tell that
 * host which investor opened which dossier, and when. The investor's route checks that the badge is verified and that this investor
 * may see the startup; the founder's checks that the badge is the founder's own (it also serves the preview "how investors see this").
 */
export const investorBadgeLogoPath = (badgeId: string) => `/api/portal/badge-logo/${badgeId}`;
export const founderBadgeLogoPath = (badgeId: string) => `/api/company-badges/${badgeId}/logo`;

/** Does this badge have a logo to serve at all (an upload, or a public one verification found)? Otherwise the UI draws the icon for its kind. */
export function badgeHasLogo(b: { logoStoragePath?: string | null; logoUrl?: string | null }): boolean {
  return !!b.logoStoragePath || !!normalizeSourceUrl(b.logoUrl);
}

/**
 * An uploaded file is only ever the org's own: the path must sit under `<orgId>/` and climb nowhere. The logo is streamed by a route that
 * signs with the service role, so a path pointing into another org's folder would hand that org's file to whoever asked.
 */
export function isOwnStoragePath(orgId: string, path: unknown): path is string {
  if (typeof path !== 'string' || !orgId || path.length > 500) return false;
  if (!path.startsWith(`${orgId}/`) || path.length === orgId.length + 1) return false;
  return !path.split('/').some((seg) => seg === '..' || seg === '.' || seg === '') && !path.includes('\\');
}

/**
 * Prompt 918 D — investor-facing projection. ONLY `verified` badges that carry a public source and a verification date cross this
 * boundary; unverified and disputed ones are not shown, and neither is any count of them. verification_note, evidence_document_id,
 * description and the claim link never cross it (they are not on the input type).
 * Prompt 326 §E used to pass unverified badges through greyed out and hide only `disputed`; that rule is gone (DECISIONS.md, 918).
 * `logoRoute` says which route serves the logo (the investor's by default; the founder's preview passes its own).
 */
export function projectBadgesForInvestor(
  badges: BadgeForProjection[],
  logoRoute: (badgeId: string) => string = investorBadgeLogoPath,
): BadgePublic[] {
  const out: BadgePublic[] = [];
  for (const b of badges) {
    if (b.verificationStatus !== 'verified') continue;
    const sourceUrl = normalizeSourceUrl(b.sourceUrl);
    if (!sourceUrl || !b.verifiedAt) continue; // a "verified" row with nothing behind it is not shown (the table refuses to hold one; belt and braces)
    out.push({
      id: b.id, name: b.name, kind: b.kind, year: b.year,
      logoUrl: badgeHasLogo(b) ? logoRoute(b.id) : null,
      sourceUrl, sourceTitle: b.sourceTitle, verifiedAt: b.verifiedAt,
    });
  }
  return out;
}

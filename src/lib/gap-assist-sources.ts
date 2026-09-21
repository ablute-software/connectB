// Prompt 308 — pure, unit-testable helpers for gap-assist's team-gap
// (G3/G3b/G3c) "draft from what we already know" flow: which sources to
// look in (company_people bio/LinkedIn — Part A), which Vault documents are
// worth reading (Part B), and the SSRF/honest-failure guards around an
// unauthenticated LinkedIn fetch (Part C). Kept separate from the route
// itself so the logic that must never be wrong (URL allowlisting, malware-
// scan gating, login-wall detection) is testable without a live server or a
// live Anthropic call.
import { FUNCTION_PATTERNS, type Gap, type GapRule } from './company-gaps';

// -----------------------------------------------------------------------
// Shared: which gaps this whole feature applies to. G4 ("is there a Vault
// doc backing this claim") and G6 (round mechanism) aren't about the team at
// all — searching bios/CVs/LinkedIn for them would just add cost and noise.
export const TEAM_GAP_RULES: readonly GapRule[] = ['G3', 'G3b', 'G3c'];
export function isTeamGap(rule: GapRule): boolean {
  return (TEAM_GAP_RULES as readonly string[]).includes(rule);
}

// Prompt 711 — G6 (round mechanism: use of funds / why now) is drafted from
// accepted claims ONLY, by the original design — but for a company with no
// funding/ask/mercado_timing claims accepted yet (the normal case for a
// company that just started this section), that pool is empty even when a
// real business plan sits in the Vault, already extracted, answering
// exactly this question. G4 stays OUT of this on purpose: it asks "is there
// a Vault doc backing THIS claim," which is a different question with its
// own dedicated engine (reconciliation.ts) — never reopened here.
export const ROUND_GAP_RULES: readonly GapRule[] = ['G6'];
export function isRoundGap(rule: GapRule): boolean {
  return (ROUND_GAP_RULES as readonly string[]).includes(rule);
}

// -----------------------------------------------------------------------
// Part A — company_people.bio/title/linkedin_url, already entered by the
// founder in Settings→Team. gap-assist/route.ts wraps this text (and the
// existing contextClaims block) in wrapDocumentContent before it reaches the
// prompt, same as every other aggregated-text block in that file — this
// formatter only builds the plain text, the caller is what applies the
// defense.
export interface TeamProfile {
  fullName: string;
  title: string | null;
  isFounder: boolean;
  bio: string | null;
  linkedinUrl: string | null;
}

export function formatTeamProfiles(people: TeamProfile[]): string {
  if (people.length === 0) return '';
  return people.map((p) => {
    const lines = [`- ${p.fullName}${p.isFounder ? ' (Founder)' : ''}${p.title ? ` — ${p.title}` : ''}`];
    if (p.bio) lines.push(`  Bio on file: "${p.bio}"`);
    if (p.linkedinUrl) lines.push(`  LinkedIn on file: ${p.linkedinUrl}`);
    return lines.join('\n');
  }).join('\n');
}

// -----------------------------------------------------------------------
// Part B — which Vault documents are worth reading for a team-narrative
// gap. No new classification field: reuses whatever the founder already
// set up for the investor-facing Documents tab (folders.portal_section —
// 'team_governance' is a real, already-existing value, a much stronger
// structured signal than guessing off a name) as the PRIMARY signal, a weak
// name-match as a fallback, and — only if NEITHER finds anything — every
// clean PDF in the Vault (explicit product decision, Prompt 308 Pedido B:
// "aceitável listar todos... e deixar o modelo decidir se algum é
// relevante"). Only 'clean'-scanned PDFs are ever candidates — 'pending'/
// 'flagged'/'not_scanned' never reach the model, same gate document_versions
// already applies (Prompt 301).
export interface CandidateDoc {
  id: string;
  name: string;
  storagePath: string;
  folderName: string | null;
  portalSection: string | null;
  malwareScanStatus: string | null;
}

const TEAM_NAME_SIGNAL = /\b(team|cv|r[eé]sum[eé]|bio)\b/i;
const PDF_EXTENSION = /\.pdf$/i;

// Prompt 375 — 'local_only' counts as safe here too (see this file's own
// header note on the gate this mirrors — document-extraction-pipeline.ts
// accepts the same two statuses). Shared by every document-candidate
// selector below — a Vault PDF is never a candidate for anything unless it
// cleared this gate first.
function cleanPdfCandidates(docs: CandidateDoc[]): CandidateDoc[] {
  return docs.filter((d) => (d.malwareScanStatus === 'clean' || d.malwareScanStatus === 'local_only') && PDF_EXTENSION.test(d.storagePath || d.name));
}

export function selectTeamDocumentCandidates(docs: CandidateDoc[], maxDocs: number): CandidateDoc[] {
  const clean = cleanPdfCandidates(docs);
  const byPortalSection = clean.filter((d) => d.portalSection === 'team_governance');
  if (byPortalSection.length > 0) return byPortalSection.slice(0, maxDocs);
  const byName = clean.filter((d) => TEAM_NAME_SIGNAL.test(d.name) || (d.folderName ? TEAM_NAME_SIGNAL.test(d.folderName) : false));
  if (byName.length > 0) return byName.slice(0, maxDocs);
  return clean.slice(0, maxDocs);
}

// -----------------------------------------------------------------------
// Prompt 711 Part A — which Vault documents are worth reading for G6 (round
// mechanism: use of funds / why now). No portal_section/name heuristic here
// like the team selector above: a business plan or investor deck could sit
// in any folder, under any filename, so there's no equivalent structured
// fallback signal to lean on first. Instead this reads the ONE real signal
// that already exists for every extracted document — document_extractions.
// extracted.documentType, set once at upload time by the extraction pass
// itself (Prompt 313), never guessed here. Exact wording is the model's own
// free-text label ("business plan", "investor deck", ...), so this matches
// loosely rather than against a closed enum.
const ROUND_DOCUMENT_TYPE_SIGNAL = /\b(business\s*plan|investor\s*deck|pitch\s*deck|financial\s*model)\b/i;

export function selectRoundDocumentCandidates(
  docs: CandidateDoc[], documentTypeByDocId: Map<string, string | null>, maxDocs: number,
): CandidateDoc[] {
  const relevant = cleanPdfCandidates(docs).filter((d) => {
    const type = documentTypeByDocId.get(d.id);
    return !!type && ROUND_DOCUMENT_TYPE_SIGNAL.test(type);
  });
  return relevant.slice(0, maxDocs);
}

// -----------------------------------------------------------------------
// Prompt 711 Part B — when the draft comes back sufficient:false, name a
// real document instead of the same blind sentence every time. Deliberately
// separate from Part A's candidate list above (which only ever contains
// PDFs that cleared the malware-scan gate, because those bytes get sent to
// the model): a courtesy text mention costs nothing and reveals nothing new
// (the founder already sees this document in their own Vault), so it's
// fine to consider every completed extraction here, not just the
// scan-clean subset that was actually attached to this specific draft.
export interface ExtractedDocumentInfo { documentId: string; documentName: string; documentType: string | null; updatedAt: string }

export function suggestRoundDocument(docs: ExtractedDocumentInfo[]): ExtractedDocumentInfo | null {
  const relevant = docs.filter((d) => d.documentType && ROUND_DOCUMENT_TYPE_SIGNAL.test(d.documentType));
  if (relevant.length === 0) return null;
  // Most recently extracted first — "sem sinal melhor" (no stronger signal
  // to rank candidates by), per the mini-prompt's own wording.
  return [...relevant].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

const GENERIC_INSUFFICIENT_MESSAGE = 'Nothing on file yet answers this — you\'ll need to fill it in yourself.';

export function insufficientAnswerMessage(suggestion: ExtractedDocumentInfo | null): string {
  if (!suggestion) return GENERIC_INSUFFICIENT_MESSAGE;
  return `Nothing on file yet answers this directly, but "${suggestion.documentName}" looks relevant — open it and confirm, or add the answer yourself.`;
}

// -----------------------------------------------------------------------
// Part C — SSRF guard. The only URL this feature is ever allowed to fetch
// is the exact linkedin_url the FOUNDER already saved on their own team
// member (never a search, never a URL from any other source) — and even
// that is only ever fetched if it genuinely resolves to linkedin.com over
// https. A malformed or spoofed value in that column (however unlikely)
// must never turn into a fetch to an arbitrary attacker-controlled host.
export function isAllowedLinkedInUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  return host === 'linkedin.com' || host.endsWith('.linkedin.com');
}

// An unauthenticated fetch to a LinkedIn profile URL is expected to hit a
// login/paywall page, not the real profile (Pedido C.2: "trata a resposta
// como falha esperada, não como bug"). Deliberately conservative: a false
// "not usable" just means the founder doesn't get an AI hint from this
// source (harmless); a false "usable" would feed login-page boilerplate to
// the model as if it were real biographical fact about a real person.
const LOGIN_WALL_MARKERS = /sign in to linkedin|join linkedin now|authwall|welcome back|<title>\s*linkedin login|join now to see/i;
const MIN_USABLE_LENGTH = 800;

export function looksLikeUsableLinkedInContent(html: string): boolean {
  if (html.length < MIN_USABLE_LENGTH) return false;
  if (LOGIN_WALL_MARKERS.test(html)) return false;
  return true;
}

// Which person(s) to even consider for a LinkedIn fetch, scoped tightly per
// gap so this never turns into an open-ended crawl of every team member's
// profile for every question: G3b already names ONE founder
// (meta.founderName); G3c already names a FUNCTION, matched against title
// with the EXACT same patterns ruleG3c itself uses to detect the gap in the
// first place (never a second, potentially drifting regex); G3 (general
// team narrative) has no single target, so every team member is eligible —
// the caller still caps the total fetch count separately.
export interface LinkedInTargetPerson { fullName: string; title: string | null; linkedinUrl: string | null }

export function relevantPeopleForLinkedIn<T extends LinkedInTargetPerson>(gap: Gap, people: T[]): T[] {
  if (gap.rule === 'G3b' && gap.meta?.founderName) {
    return people.filter((p) => p.fullName === gap.meta?.founderName);
  }
  if (gap.rule === 'G3c' && gap.meta?.functionKey) {
    const pattern = FUNCTION_PATTERNS[gap.meta.functionKey];
    return pattern ? people.filter((p) => p.title && pattern.test(p.title)) : [];
  }
  return people;
}

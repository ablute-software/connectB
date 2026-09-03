// Prompt 547 — which shelf a shared document sits on decides whether the
// guest link opens it, or asks the recipient to prove who they are first.
//
// The decision this encodes is Nuno's, on 02/09/2026, and it deliberately
// supersedes Prompt 526's blanket "names only, confirmation for everything":
//
//   Materials  (folders.kind = 'materials'  — Pitch deck, Investor deck,
//              One-pager, Financials) — what a founder sends openly by email
//              anyway. The link IS the send. Forwarding it exposes exactly
//              what forwarding the PDF would, which is the status quo it
//              replaces, not a new exposure.
//   Data Room  (folders.kind = 'data_room' — 00 to 08, diligence) — stays
//              behind "Confirm it's you": a one-time code to the invited
//              address. This is where 526's non-transferability guarantee
//              still belongs, and now it protects the shelf that needs it
//              rather than the shelf that does not.
//
// Kept pure and separate from both routes because it is the security rule.
// The API that lists documents and the route that opens one must not be able
// to disagree about it, and a rule with three independent reasons to refuse
// is worth testing without a database in front of it.

export type GuestShelf = 'materials' | 'data_room';

export interface GuestDocument {
  id: string;
  name: string;
  shelf: GuestShelf;
  /** True when the grant covering this document requires an NDA. */
  ndaRequired: boolean;
}

export type GuestOpenRefusal = 'confirmation_required' | 'nda_required';

export type GuestOpenDecision =
  | { allowed: true }
  | { allowed: false; reason: GuestOpenRefusal };

/**
 * Whether a token alone — no account, no code — may open this document.
 *
 * Both conditions must hold. NDA is checked even on the Materials shelf: a
 * founder who marked something NDA-required has said, explicitly, that it is
 * not for open sending, and the shelf it happens to live on does not override
 * that. Refusing here is the conservative direction, and the recipient still
 * has the confirm-then-accept path.
 */
export function decideGuestOpen(doc: Pick<GuestDocument, 'shelf' | 'ndaRequired'>): GuestOpenDecision {
  if (doc.ndaRequired) return { allowed: false, reason: 'nda_required' };
  if (doc.shelf !== 'materials') return { allowed: false, reason: 'confirmation_required' };
  return { allowed: true };
}

export function canOpenWithoutConfirmation(doc: Pick<GuestDocument, 'shelf' | 'ndaRequired'>): boolean {
  return decideGuestOpen(doc).allowed;
}

export interface GuestDocumentGroups<T extends Pick<GuestDocument, 'shelf' | 'ndaRequired'>> {
  /** Opens straight from the link. */
  openNow: T[];
  /** Needs "Confirm it's you" first. */
  confirmRequired: T[];
}

/**
 * The two groups the guest page renders. Derived from the same predicate the
 * open route enforces, so the page can never offer a link the route will
 * refuse — the failure mode that would teach a recipient the product is broken.
 */
export function groupGuestDocuments<T extends Pick<GuestDocument, 'shelf' | 'ndaRequired'>>(
  docs: T[],
): GuestDocumentGroups<T> {
  const openNow: T[] = [];
  const confirmRequired: T[] = [];
  for (const d of docs) (canOpenWithoutConfirmation(d) ? openNow : confirmRequired).push(d);
  return { openNow, confirmRequired };
}

/**
 * Folder kind → shelf, defaulting to the CLOSED shelf.
 *
 * `folders.kind` is a NOT NULL enum of exactly these two values, so the
 * fallback should be unreachable. It defaults to 'data_room' anyway: if a
 * third value is ever added, the failure lands on "asks for a code" rather
 * than "opens to anyone holding the link".
 */
export function shelfFromFolderKind(kind: string | null | undefined): GuestShelf {
  return kind === 'materials' ? 'materials' : 'data_room';
}

/** Seconds a guest signed URL stays valid. */
export const GUEST_SIGNED_URL_TTL_SECONDS = 120;

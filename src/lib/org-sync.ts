// Prompt 906 §A — one way for "the org was saved" to reach every part of the page that shows something
// DERIVED from it on the server.
//
// The report (07/10, ABOUT FOOD): the founder filled six fields on /settings, saw them saved, and the page kept
// saying "Investors can't find you yet — 6 fields missing" for the next three hours. Nothing was wrong in the
// database — profile_reached_80_at is stamped 16:51 that day, two hours before the ticket. The banner
// (VisibilityToggle) read /api/company/visibility ONCE, on mount, and /settings never remounts while the
// founder works in it (page_view at 15:52, the next one at 19:05). The percentage bar was already right: it is
// computed from the store, and the store is updated optimistically. Two derivations of the same org, one of
// them frozen at the moment the page opened.
//
// The fix is deliberately not a shared store for the banner. The banner's content is decided on the server
// (suspension, the pipeline-firm count, the nine-field gate) and cannot be recomputed in the browser. What it
// needs is to be told, after the write has landed, that it must ask again. `org:changed` is that sentence.

export const ORG_CHANGED_EVENT = 'org:changed';

/** The org (or the roster the gate reads) was written and the server accepted it. Safe to call anywhere, including SSR. */
export function announceOrgChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(ORG_CHANGED_EVENT));
}

/** Listen for {@link announceOrgChanged}. Returns the unsubscribe function (what `useEffect` wants back). */
export function subscribeOrgChanged(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(ORG_CHANGED_EVENT, listener);
  return () => window.removeEventListener(ORG_CHANGED_EVENT, listener);
}

// ─── adopting what the server stored ────────────────────────────────────────

const isNil = (v: unknown): v is null | undefined => v === null || v === undefined;

/**
 * "The same value" for the purpose of deciding whether the browser's copy and the database's copy disagree.
 * Deliberately loose about representation, strict about content: PostgREST returns `numeric` columns as strings
 * ("0", "250000") where the form produced numbers, and a database `null` is the store's `undefined`. Treating
 * those as different would make every successful save "adopt" the server's copy for nothing, and a revenue of
 * €1,500,000 would lose its thousands separators (the store formats numbers; it does not format numeric strings).
 */
export function sameStoredValue(a: unknown, b: unknown): boolean {
  if (isNil(a) && isNil(b)) return true;
  if (isNil(a) || isNil(b)) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => sameStoredValue(v, b[i]));
  }
  if (typeof a === 'object' || typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return a === b || String(a) === String(b);
}

/**
 * After /api/org/update answered ok: of the fields THIS request wrote (`keys`), which ones does the database
 * hold differently from the browser's optimistic copy? Those are returned, with the database's value (a `null`
 * becomes `undefined`, like every other row the store loads). Normally the answer is `{}` and nothing is
 * committed; it is not empty when the server coerced, trimmed or refused a field — and then the page must show
 * what is stored, not what was typed.
 *
 * `keys` is the caller's job to narrow to the fields this request is still the LATEST writer of: two saves in
 * flight at once can answer in either order, and the older answer must not roll back the newer edit.
 */
export function orgFieldsToAdopt(
  local: Record<string, unknown>,
  stored: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const adopt: Record<string, unknown> = {};
  for (const k of keys) {
    const fromDb = isNil(stored[k]) ? undefined : stored[k];
    if (!sameStoredValue(local[k], fromDb)) adopt[k] = fromDb;
  }
  return adopt;
}

// ─── the save, as one protocol ──────────────────────────────────────────────

/** Which /api/org/update request last wrote each field (see {@link saveOrgPatch}). One per store. */
export interface OrgSaveTracker { seq: number; lastWriter: Record<string, number> }
export const newOrgSaveTracker = (): OrgSaveTracker => ({ seq: 0, lastWriter: {} });

export interface OrgSaveDeps {
  /** POST the JSON body to /api/org/update and return the parsed answer. */
  post: (body: string) => Promise<{ ok?: boolean; error?: string; org?: Record<string, unknown> | null }>;
  /** The browser's CURRENT copy of the org (read when the answer arrives, not when the save started). */
  getLocalOrg: () => Record<string, unknown>;
  /** Commit fields the database holds differently. Called at most once, and only with something to commit. */
  adopt: (fields: Record<string, unknown>) => void;
  /** Tell the rest of the page the org was saved ({@link announceOrgChanged}). */
  announce: () => void;
  /** A save that did not land. The optimistic copy stays as it is (as it always did); this is for the console. */
  onError: (error: unknown) => void;
}

/**
 * The part of `updateOrg` that happens AFTER the optimistic commit: send the patch, and — only once the server
 * has said ok — (1) adopt whatever it stored differently for the fields this request still owns, then
 * (2) announce `org:changed`. In that order, and never on a failed or rejected request: the banner asks the
 * server again, and the server must already have the write by then.
 */
export async function saveOrgPatch(patch: Record<string, unknown>, tracker: OrgSaveTracker, deps: OrgSaveDeps): Promise<void> {
  // JSON.stringify drops `undefined` values, so these — not Object.keys(patch) — are the fields the server is
  // actually asked to write (a field the form cleared is `undefined` here; that is an existing limitation of
  // this route, recorded in DECISIONS.md, Prompt 906).
  const body = JSON.stringify(patch);
  const sentKeys = Object.keys(JSON.parse(body) as Record<string, unknown>);
  const seq = ++tracker.seq;
  for (const k of sentKeys) tracker.lastWriter[k] = seq;
  try {
    const answer = await deps.post(body);
    if (!answer || !answer.ok) { deps.onError(answer?.error ?? 'the server did not accept the change'); return; }
    if (answer.org && typeof answer.org === 'object') {
      const stillMine = sentKeys.filter((k) => tracker.lastWriter[k] === seq);
      const adopt = orgFieldsToAdopt(deps.getLocalOrg(), answer.org, stillMine);
      if (Object.keys(adopt).length > 0) deps.adopt(adopt);
    }
    deps.announce();
  } catch (e) {
    deps.onError(e);
  }
}

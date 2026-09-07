// Prompt 611 §B — why an admin is opening someone else's account, asked at
// the door and written into the audit line.
//
// This is not decoration. Commitment 4 of the page we publish to founders
// says, in these words: "Every such access is logged with the reason and the
// duration, and it is visible to you." Measured in production on 2026-09-07,
// six viewer_enter rows carried `{orgName, enteredAt}` and NOT ONE carried a
// reason — the promise was already being broken before this prompt moved the
// entry onto the row's name and removed the last piece of friction in front
// of it.
//
// Deliberately no default, no suggestions list and no skip: 611 §B's own
// words, "um campo que se pode deixar em branco não é um registo, é um
// formulário". A minimum length exists for the same reason — "x" satisfies a
// non-empty check and answers nothing — but it is small enough that a real
// short answer ("support ticket 41") passes.

export const VIEWER_REASON_MIN = 8;
export const VIEWER_REASON_MAX = 300;

export type ViewerReasonResult =
  | { ok: true; reason: string }
  | { ok: false; error: string };

/**
 * Trims and validates the reason a platform admin gives for entering an
 * account. Pure — the enter routes and the dialog both use it, so the client
 * can never enable a button the server would reject.
 */
export function normalizeViewerReason(raw: unknown): ViewerReasonResult {
  if (typeof raw !== 'string') return { ok: false, error: 'A reason is required.' };
  // Collapse runs of whitespace too: "   \n  " is empty, and a reason padded
  // out to the minimum with spaces is not a reason.
  const reason = raw.trim().replace(/\s+/g, ' ');
  if (!reason) return { ok: false, error: 'A reason is required.' };
  if (reason.length < VIEWER_REASON_MIN) {
    return { ok: false, error: `Say a little more — at least ${VIEWER_REASON_MIN} characters.` };
  }
  if (reason.length > VIEWER_REASON_MAX) {
    return { ok: false, error: `Keep it under ${VIEWER_REASON_MAX} characters.` };
  }
  return { ok: true, reason };
}

/**
 * What the founder's access log shows for an entry. Entries written before
 * this prompt have no reason and never will: 611 §B — "as seis entradas
 * antigas ficam sem razão e não se inventa nenhuma". Saying so is the honest
 * line, and it is one line.
 */
export const VIEWER_REASON_MISSING = 'Reason not recorded — this visit predates our recording it.';

export function reasonForDisplay(reason: string | null | undefined): string {
  const trimmed = (reason ?? '').trim();
  return trimmed || VIEWER_REASON_MISSING;
}

import 'server-only';
// Prompt 480 — the org-level reconciliation lock (the gap Prompt 465 §F.3
// documented and deliberately left open).
//
// runReconciliationForOrg has four callers that can fire for the SAME org
// without seeing each other: /api/reconciliation/run, /api/blueprint's own
// GET (three panels load it), /api/blueprint/reconcile (which delegates to
// the first since D2), and /api/automations (cron). The likeliest collision
// in practice is not the exotic one — it is a founder with two tabs open,
// each loading a panel that calls /api/blueprint at mount.
//
// Decision (Nuno, 30/08): BLOCK. A second run for an org already being
// reconciled waits for the first rather than running alongside it, and the
// founder is told when that happens.
import type { SupabaseClient } from '@supabase/supabase-js';

// A lock older than this means its holder died without releasing (a crash,
// or a serverless instance frozen mid-run). 90s sits comfortably past the
// slowest caller's own maxDuration=60, so a lock this old can never belong
// to a run that is still legitimately in flight.
export const LOCK_STALE_AFTER_MS = 90_000;

// How long a late caller waits for the lock before giving up and returning
// its normal response WITHOUT reconciling. Prompt 480 §3's own figure, and
// the right one for a route with maxDuration=60.
export const DEFAULT_LOCK_WAIT_MS = 15_000;

// ...but NOT the right one for /api/blueprint's GET, which declares no
// maxDuration at all and therefore runs on Vercel's platform default (10s
// on the Hobby plan this project is on — see CLAUDE.md). A 15s wait there
// would not degrade gracefully; it would exceed the function's own budget
// and kill the request, leaving the founder with a dead panel — strictly
// worse than the duplicated run the lock exists to prevent, and on the very
// caller Prompt 480 names as the most likely to collide. The prompt's words
// are "orçamento total de espera curto (ex.: até ~15s)" — an example, not a
// floor — so the fast route keeps the same behaviour on a budget that fits
// inside it. The founder-visible outcome is identical either way: the
// response arrives, with reconciliationSkipped set.
export const FAST_ROUTE_LOCK_WAIT_MS = 2_500;

// "verificando a cada 1–2s" (§3).
export const LOCK_POLL_INTERVAL_MS = 1_500;

// A hard ceiling on acquire attempts, independent of the clock. Caught in
// this prompt's own adversarial pass: two paths in the loop below (`the row
// vanished between our insert and our read` and `we took over a stale
// lock`) deliberately retry WITHOUT consuming the wait budget, because
// both mean "the lock is probably free right now, try again immediately"
// — sleeping there would waste the budget on a lock nobody holds. But that
// also means neither path is bounded by the deadline, so under pathological
// contention the loop had no upper bound at all. It is not a hot spin (each
// pass costs two round trips), which is exactly why it could have gone
// unnoticed. This bounds it: past this many attempts we return 'busy',
// which every caller already degrades from safely.
const MAX_ACQUIRE_ATTEMPTS = 12;

export type LockAcquisition = 'acquired' | 'busy';

export interface LockOptions {
  waitBudgetMs?: number;
  // Injectable purely so tests can exercise the waiting and stale-takeover
  // paths without actually sleeping — never overridden in production.
  nowMs?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

// Pure, and therefore directly testable: is a lock taken at `lockedAt` old
// enough that its holder must be assumed dead?
export function isLockStale(lockedAtIso: string, nowMs: number, staleAfterMs: number = LOCK_STALE_AFTER_MS): boolean {
  const lockedAtMs = Date.parse(lockedAtIso);
  // An unparseable timestamp is treated as stale rather than as a valid
  // lock: a row we cannot reason about must never be able to block an org
  // forever. Taking it over is recoverable; honouring it is not.
  if (Number.isNaN(lockedAtMs)) return true;
  return nowMs - lockedAtMs > staleAfterMs;
}

// `insert ... on conflict (org_id) do nothing returning org_id` — expressed
// through PostgREST's upsert+ignoreDuplicates, the same idiom this codebase
// already relies on for "count only what was really inserted" (see
// document-extract's own itemsProposed). Rows come back only when THIS call
// created them, so a returned row IS the lock.
async function tryInsertLock(admin: SupabaseClient, orgId: string): Promise<boolean> {
  const { data, error } = await admin.from('reconciliation_locks')
    .upsert({ org_id: orgId }, { onConflict: 'org_id', ignoreDuplicates: true })
    .select('org_id');
  if (error) throw new Error(`reconciliation lock insert failed: ${error.message}`);
  return (data ?? []).length > 0;
}

export async function acquireReconciliationLock(
  admin: SupabaseClient, orgId: string, opts: LockOptions = {},
): Promise<LockAcquisition> {
  const waitBudgetMs = opts.waitBudgetMs ?? DEFAULT_LOCK_WAIT_MS;
  const nowMs = opts.nowMs ?? (() => Date.now());
  const sleep = opts.sleep ?? realSleep;
  const deadline = nowMs() + waitBudgetMs;

  for (let attempt = 0; attempt < MAX_ACQUIRE_ATTEMPTS; attempt++) {
    if (await tryInsertLock(admin, orgId)) return 'acquired';

    // Someone holds it. Decide whether they are alive.
    const { data: existing } = await admin.from('reconciliation_locks')
      .select('locked_at').eq('org_id', orgId).maybeSingle();

    if (!existing) {
      // Released between our insert and this read — retry immediately
      // rather than sleeping out the budget for a lock that is already free.
      continue;
    }

    const lockedAt = existing.locked_at as string;
    if (isLockStale(lockedAt, nowMs())) {
      // Take it over. The `.eq('locked_at', lockedAt)` is what makes this
      // safe under a race: if another caller took the same stale lock over
      // first, its locked_at no longer matches, our delete removes nothing,
      // and we simply loop and find their fresh lock — we never delete a
      // lock that someone is legitimately holding.
      await admin.from('reconciliation_locks').delete().eq('org_id', orgId).eq('locked_at', lockedAt);
      continue;
    }

    // Held, fresh, and we still have budget: wait and look again.
    if (nowMs() >= deadline) return 'busy';
    await sleep(LOCK_POLL_INTERVAL_MS);
    if (nowMs() >= deadline) return 'busy';
  }
  // Attempts exhausted without ever settling. Treated exactly like a held
  // lock: the caller returns its normal response with reconciliationSkipped,
  // and the founder is told. Never an error — nothing failed.
  return 'busy';
}

// Always called from a `finally` (§5): success, failure, or the caller's own
// timeout, the lock leaves with the run that took it. Never throws —
// failing a founder's request over a lock cleanup would be worse than the
// stale lock itself, which the 90s takeover already recovers from anyway.
export async function releaseReconciliationLock(admin: SupabaseClient, orgId: string): Promise<void> {
  const { error } = await admin.from('reconciliation_locks').delete().eq('org_id', orgId);
  if (error) console.error(`[reconciliation-lock] release failed for org=${orgId}:`, error.message);
}

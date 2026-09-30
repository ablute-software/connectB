// BLOCO 3 — every admin mutation writes one row here: who, what, on what,
// and (for promotions) the provenance that justified it. Server-only.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

// Prompt 748 §C — this used to fire-and-forget the insert with its `error`
// never read, so a failure here was invisible everywhere: no server log, no
// signal to the caller, nothing. Root cause found for one real case (the
// AI-plans/actions screens — see their own routes' comments):
// admin_audit_log.subject_id is uuid-typed (migration 0014), and those
// routes passed a natural string key ('idea', a custom plan's key, an
// action's key) — every one of those inserts has been failing on a
// Postgres type-cast error, 100% of the time, since the very first call,
// with zero trace anywhere. Now: logged to the server console on failure
// (so it's at least visible there), and the caller gets `{ok:false}` back
// so a route can tell its own operator "saved, but the audit entry
// failed" instead of a page that looks clean while quietly not recording
// anything. Every existing caller ignores the return value already (this
// used to return void), so widening it here breaks nothing at any of the
// ~60 other call sites — only a caller that starts reading it changes
// behavior.
export async function logAdminAction(sb: SupabaseClient, opts: {
  // null is Prompt 587's system-auto-approval case (no admin made the call) —
  // admin_audit_log.admin_user_id has never had a NOT NULL constraint
  // (migration 0014), so this was already representable in the schema.
  adminUserId: string | null; action: string; subjectType: string; subjectId?: string | null; detail?: unknown;
}): Promise<{ ok: boolean; error?: string }> {
  const { error } = await sb.from('admin_audit_log').insert({
    admin_user_id: opts.adminUserId,
    action: opts.action,
    subject_type: opts.subjectType,
    subject_id: opts.subjectId ?? null,
    detail: opts.detail ?? null,
  });
  if (error) {
    console.error(`logAdminAction failed (action=${opts.action}, subjectType=${opts.subjectType}, subjectId=${opts.subjectId ?? 'null'}):`, error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

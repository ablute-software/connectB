// BLOCO 3 — every admin mutation writes one row here: who, what, on what,
// and (for promotions) the provenance that justified it. Server-only.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export async function logAdminAction(sb: SupabaseClient, opts: {
  adminUserId: string; action: string; subjectType: string; subjectId?: string | null; detail?: unknown;
}): Promise<void> {
  await sb.from('admin_audit_log').insert({
    admin_user_id: opts.adminUserId,
    action: opts.action,
    subject_type: opts.subjectType,
    subject_id: opts.subjectId ?? null,
    detail: opts.detail ?? null,
  });
}

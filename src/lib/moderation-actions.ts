// Prompt 123 Block C.2 — server-only glue between the pure state machine
// (account-moderation.ts) and the two real tables it governs (orgs,
// catalog_entities). Shared by every /api/backoffice/moderation/* route so
// the suspend/undo/delete logic is written once, not duplicated per target
// type.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  canSuspend, canUndo, canDelete, computeQuarantineUntil, type ModerationAction, type ModerationTargetType, type ModerationStatus,
} from './account-moderation';

const TABLE_BY_TARGET: Record<ModerationTargetType, string> = { org: 'orgs', investor: 'catalog_entities' };

export interface ModerationResult {
  ok: boolean;
  error?: string;
}

async function currentStatus(admin: SupabaseClient, targetType: ModerationTargetType, targetId: string): Promise<{ status: ModerationStatus; quarantineUntil: string | null } | null> {
  const { data } = await admin.from(TABLE_BY_TARGET[targetType]).select('moderation_status, moderation_quarantine_until').eq('id', targetId).maybeSingle();
  if (!data) return null;
  return { status: data.moderation_status as ModerationStatus, quarantineUntil: data.moderation_quarantine_until as string | null };
}

export async function applyModerationAction(
  admin: SupabaseClient,
  params: { targetType: ModerationTargetType; targetId: string; action: ModerationAction; justification: string; actorId: string },
): Promise<ModerationResult> {
  const { targetType, targetId, action, justification, actorId } = params;
  if (!justification.trim()) return { ok: false, error: 'A justification is required.' };

  const current = await currentStatus(admin, targetType, targetId);
  if (!current) return { ok: false, error: 'Target not found.' };

  const now = new Date().toISOString();
  let newStatus: ModerationStatus;
  let quarantineUntil: string | null = current.quarantineUntil;

  if (action === 'suspend') {
    if (!canSuspend(current.status)) return { ok: false, error: `Cannot suspend — current status is ${current.status}.` };
    newStatus = 'suspended';
    quarantineUntil = computeQuarantineUntil(now);
  } else if (action === 'undo') {
    if (!canUndo(current.status)) return { ok: false, error: `Cannot undo — current status is ${current.status}.` };
    newStatus = 'active';
    quarantineUntil = null;
  } else {
    if (!canDelete(current.status, current.quarantineUntil, now)) {
      return { ok: false, error: 'Cannot delete — either not suspended yet, or the 30-day quarantine is still active.' };
    }
    newStatus = 'deleted';
  }

  const { error: updateErr } = await admin.from(TABLE_BY_TARGET[targetType])
    .update({ moderation_status: newStatus, moderation_quarantine_until: quarantineUntil })
    .eq('id', targetId);
  if (updateErr) return { ok: false, error: updateErr.message };

  const { error: logErr } = await admin.from('account_moderation_actions').insert({
    target_type: targetType, target_id: targetId, action, justification, actor: actorId,
    quarantine_until: action === 'suspend' ? quarantineUntil : null,
  });
  if (logErr) return { ok: false, error: logErr.message };

  return { ok: true };
}

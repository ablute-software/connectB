// Prompt 891 — "Delete now" on the Startups/Investors tabs: bypasses the
// remaining 30-day quarantine on a SUSPENDED account, never from active,
// and is always written to the audit row as bypassed_quarantine=true.
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { applyModerationAction } from './moderation-actions';

function fakeAdmin(row: { moderation_status: string; moderation_quarantine_until: string | null } | null) {
  const updates: Record<string, unknown>[] = [];
  const inserts: Record<string, unknown>[] = [];
  const admin = {
    from(table: string) {
      return {
        select() { return { eq() { return { maybeSingle: async () => ({ data: row }) }; } }; },
        update(v: Record<string, unknown>) { updates.push({ table, ...v }); return { eq: async () => ({ error: null }) }; },
        insert: async (v: Record<string, unknown>) => { inserts.push({ table, ...v }); return { error: null }; },
      };
    },
  } as unknown as SupabaseClient;
  return { admin, updates, inserts };
}

const IN_QUARANTINE = new Date(Date.now() + 20 * 24 * 3600 * 1000).toISOString();
const base = { targetType: 'org' as const, targetId: 'org-1', action: 'delete' as const, justification: 'demo org, discard', actorId: 'u1' };

describe('Delete now (force) — Prompt 891', () => {
  it('plain delete still refuses while the quarantine is active', async () => {
    const { admin, updates } = fakeAdmin({ moderation_status: 'suspended', moderation_quarantine_until: IN_QUARANTINE });
    const r = await applyModerationAction(admin, base);
    expect(r.ok).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it('force deletes a suspended account mid-quarantine and audits the bypass', async () => {
    const { admin, updates, inserts } = fakeAdmin({ moderation_status: 'suspended', moderation_quarantine_until: IN_QUARANTINE });
    const r = await applyModerationAction(admin, { ...base, bypassQuarantine: true, requireSuspendedForBypass: true });
    expect(r.ok).toBe(true);
    expect(updates[0]).toMatchObject({ table: 'orgs', moderation_status: 'deleted' });
    expect(inserts[0]).toMatchObject({ table: 'account_moderation_actions', action: 'delete', bypassed_quarantine: true });
  });

  it('force never deletes straight from active on the tabs (suspend is still step one)', async () => {
    const { admin, updates } = fakeAdmin({ moderation_status: 'active', moderation_quarantine_until: null });
    const r = await applyModerationAction(admin, { ...base, bypassQuarantine: true, requireSuspendedForBypass: true });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/suspend first/);
    expect(updates).toHaveLength(0);
  });

  it('the Suspicious Accounts path (no requireSuspendedForBypass) keeps deleting from active', async () => {
    const { admin } = fakeAdmin({ moderation_status: 'active', moderation_quarantine_until: null });
    const r = await applyModerationAction(admin, { ...base, bypassQuarantine: true });
    expect(r.ok).toBe(true);
  });
});

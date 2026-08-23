import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { findOrgByMemberEmail, findActorIdByOrgId, createInvite } from './network-db';

// Prompt 330 §B — the email lookup must be honest (a real "no account"
// answer, never a thrown error masquerading as one) and must never fabricate
// an actor: findOrgByMemberEmail only ever reads, findActorIdByOrgId is a
// plain select too — neither has an insert path at all, so "never creates a
// new actor" is structural here, not just tested behavior.
function makeFakeAdmin(opts: { rpcResult: { org_id: string; org_name: string }[] | null; actorId: string | null }) {
  const rpcCalls: { fn: string; args: unknown }[] = [];
  return {
    admin: {
      rpc: (fn: string, args: unknown) => { rpcCalls.push({ fn, args }); return Promise.resolve({ data: opts.rpcResult, error: null }); },
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: opts.actorId ? { id: opts.actorId } : null, error: null }),
          }),
        }),
      }),
    } as unknown as SupabaseClient,
    rpcCalls,
  };
}

describe('findOrgByMemberEmail', () => {
  it('returns null — an honest "not found" — when no account matches, never throws or fabricates a result', async () => {
    const { admin } = makeFakeAdmin({ rpcResult: [], actorId: null });
    expect(await findOrgByMemberEmail(admin, 'nobody@example.com')).toBeNull();
  });

  it('also treats a null RPC result (no rows) as not found', async () => {
    const { admin } = makeFakeAdmin({ rpcResult: null, actorId: null });
    expect(await findOrgByMemberEmail(admin, 'nobody@example.com')).toBeNull();
  });

  it('returns the org when a match exists', async () => {
    const { admin } = makeFakeAdmin({ rpcResult: [{ org_id: 'org-1', org_name: 'Acme' }], actorId: null });
    expect(await findOrgByMemberEmail(admin, 'founder@acme.com')).toEqual({ orgId: 'org-1', orgName: 'Acme' });
  });

  it('normalizes the email (trim + lowercase) before the lookup, so casing/whitespace never causes a false "not found"', async () => {
    const { admin, rpcCalls } = makeFakeAdmin({ rpcResult: [], actorId: null });
    await findOrgByMemberEmail(admin, '  Founder@Acme.com  ');
    expect(rpcCalls[0].args).toEqual({ p_email: 'founder@acme.com' });
  });
});

describe('findActorIdByOrgId', () => {
  it('returns null when the org has no resolvable actor', async () => {
    const { admin } = makeFakeAdmin({ rpcResult: [], actorId: null });
    expect(await findActorIdByOrgId(admin, 'org-1')).toBeNull();
  });

  it('returns the actor id on a match', async () => {
    const { admin } = makeFakeAdmin({ rpcResult: [], actorId: 'actor-1' });
    expect(await findActorIdByOrgId(admin, 'org-1')).toBe('actor-1');
  });
});

// Prompt 330 §B — the code-level half of "context_kind='direct_known' is
// accepted... pelo insert": createInvite must pass it through to the
// network_invites insert unchanged, same as any other context_kind. The
// CHECK constraint itself (migration 0222) is a DB-level fact this test
// can't reach without a live Postgres — verified by migration review, same
// as every other constraint change in this codebase.
describe('createInvite — accepts the new direct_known context_kind', () => {
  it('inserts with context_kind = direct_known', async () => {
    const inserted: Record<string, unknown>[] = [];
    const admin = {
      from: (table: string) => ({
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
        insert: (payload: Record<string, unknown>) => {
          inserted.push(payload);
          return { select: () => ({ single: () => Promise.resolve({ data: { id: 'invite-1', ...payload }, error: null }) }) };
        },
      }),
    } as unknown as SupabaseClient;

    const result = await createInvite(admin, {
      fromActorId: 'actor-a', toActorId: 'actor-b', contextKind: 'direct_known', contextRef: 'Acme', message: 'We were batchmates at YC.',
    });
    expect(result.ok).toBe(true);
    expect(inserted[0].context_kind).toBe('direct_known');
  });
});

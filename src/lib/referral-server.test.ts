import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { grantReferralCodes } from './referral-server';

// A minimal, chainable fake of the two calls grantReferralCodes actually
// makes: a count-only select (the guard-2 existence check) and an insert.
// Same "thenable query builder" shape catalog-monthly-delivery-server.test.ts
// already uses for the same reason — the real code awaits at the end of a
// chain, not at any one link in it.
function makeFakeAdmin(opts: { existingReferralCount?: number; insertFails?: boolean }) {
  const inserted: unknown[] = [];
  function builder() {
    const b: Record<string, unknown> = {};
    const self = () => b as never;
    Object.assign(b, {
      select: self,
      eq: self,
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ count: opts.existingReferralCount ?? 0, data: null, error: null }).then(resolve),
      insert: (rows: unknown[]) => {
        inserted.push(...rows);
        return Promise.resolve({ error: opts.insertFails ? new Error('insert failed') : null });
      },
    });
    return b;
  }
  const admin = { from: () => builder() } as unknown as SupabaseClient;
  return { admin, inserted };
}

describe('grantReferralCodes — guard 2 (once per org, ever)', () => {
  it('creates REFERRAL_CODE_COUNT codes for an org with no existing referral codes', async () => {
    const { admin, inserted } = makeFakeAdmin({ existingReferralCount: 0 });
    const result = await grantReferralCodes(admin, 'org-1', ['garage']);
    expect(result.codesCreated).toBe(2);
    expect(inserted).toHaveLength(2);
    expect(inserted.every((d) => (d as { referral_of_org_id: string }).referral_of_org_id === 'org-1')).toBe(true);
  });

  it('skips entirely when the org already has ANY referral_of_org_id row — Pioneer set or its own earlier referral set', async () => {
    const { admin, inserted } = makeFakeAdmin({ existingReferralCount: 3 });
    const result = await grantReferralCodes(admin, 'org-1', ['garage']);
    expect(result.codesCreated).toBe(0);
    expect(inserted).toHaveLength(0);
  });

  it('reports zero codes created, not a throw, when the insert itself fails', async () => {
    const { admin } = makeFakeAdmin({ existingReferralCount: 0, insertFails: true });
    const result = await grantReferralCodes(admin, 'org-1', ['garage']);
    expect(result.codesCreated).toBe(0);
  });
});

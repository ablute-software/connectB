import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import {
  findGrantByGuestToken, guestLinkRateLimited, clientIp,
  GUEST_LINK_RATE_LIMIT_PER_MINUTE,
} from './guest-link-security';

// Prompt 537 §4 — the guest link's two new defences.
//
// §4.1 is a transition, and transitions are exactly where security changes
// go wrong: hash the column and every link already in a recipient's inbox
// dies; keep the raw match forever and the hash bought nothing. The tests
// below pin BOTH halves — hash wins when present, raw still resolves a row
// that predates the migration — plus the order between them, because a raw
// lookup that ran first would make the hash column decorative.

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function fakeAdmin(rows: { table: string; column: string; value: string; row: Record<string, unknown> }[]) {
  const queries: { table: string; column: string; value: string }[] = [];
  const inserts: { table: string; payload: unknown }[] = [];
  const updates: { table: string; payload: unknown }[] = [];
  const admin = {
    from: (table: string) => {
      let column = ''; let value = '';
      const b: Record<string, unknown> = {};
      const self = () => b as never;
      Object.assign(b, {
        select: self,
        is: self,
        gte: self,
        eq: (c: string, v: string) => { column = c; value = v; return self(); },
        insert: (payload: unknown) => { inserts.push({ table, payload }); return Promise.resolve({ error: null }); },
        update: (payload: unknown) => {
          updates.push({ table, payload });
          const chain: Record<string, unknown> = {};
          Object.assign(chain, {
            eq: () => chain,
            then: (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
          });
          return chain;
        },
        maybeSingle: () => {
          queries.push({ table, column, value });
          const hit = rows.find((r) => r.table === table && r.column === column && r.value === value);
          return Promise.resolve({ data: hit ? hit.row : null, error: null });
        },
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ count: 0, error: null }).then(resolve),
      });
      return b;
    },
  } as unknown as SupabaseClient;
  return { admin, queries, inserts, updates };
}

describe('§4.1 — the database stores the hash, never a working link', () => {
  const RAW = 'A7IZa09GtokenlikeTheRealOne';

  it('resolves a migrated row by HASH, and never looks up the raw column', async () => {
    const { admin, queries } = fakeAdmin([
      { table: 'access_grants', column: 'guest_token_hash', value: sha256(RAW), row: { id: 'g1' } },
    ]);
    const { grant, matchedBy } = await findGrantByGuestToken(admin, RAW);
    expect(grant).toEqual({ id: 'g1' });
    expect(matchedBy).toBe('hash');
    // One query, on the hash column. If the raw lookup ran too, a database
    // read would still be yielding a usable token.
    expect(queries).toEqual([{ table: 'access_grants', column: 'guest_token_hash', value: sha256(RAW) }]);
  });

  it('still resolves a pre-migration row by RAW token, so live links keep working', async () => {
    // The transition case: a link already sitting in a recipient's inbox,
    // minted before guest_token_hash existed.
    const { admin, queries } = fakeAdmin([
      { table: 'access_grants', column: 'guest_token', value: RAW, row: { id: 'legacy' } },
    ]);
    const { grant, matchedBy } = await findGrantByGuestToken(admin, RAW);
    expect(grant).toEqual({ id: 'legacy' });
    expect(matchedBy).toBe('raw');
    // Hash first, raw second — the fallback is only ever reached on a miss.
    expect(queries.map((q) => q.column)).toEqual(['guest_token_hash', 'guest_token']);
  });

  it('BACKFILLS the hash onto a row it had to resolve by raw', async () => {
    // Migration 0297's backfill hashed only the rows that existed when it
    // ran. Production kept minting raw-only tokens afterwards (observed:
    // two invites at 17:10 and 17:15 UTC on 2026-09-02, from the deployed
    // build that has no hash write). Healing on read is what stops the raw
    // column gaining new dependents, so the migration that eventually drops
    // it is waiting on a shrinking set rather than a moving target.
    const { admin, updates } = fakeAdmin([
      { table: 'access_grants', column: 'guest_token', value: RAW, row: { id: 'legacy', guest_token_hash: null } },
    ]);
    await findGrantByGuestToken(admin, RAW);
    expect(updates).toEqual([{ table: 'access_grants', payload: { guest_token_hash: sha256(RAW) } }]);
  });

  it('does NOT rewrite a row that already carries the right hash', async () => {
    const { admin, updates } = fakeAdmin([
      { table: 'access_grants', column: 'guest_token', value: RAW, row: { id: 'legacy', guest_token_hash: sha256(RAW) } },
    ]);
    await findGrantByGuestToken(admin, RAW);
    expect(updates).toEqual([]);
  });

  it('an unknown token resolves to nothing, by either path', async () => {
    const { admin } = fakeAdmin([]);
    const { grant, matchedBy } = await findGrantByGuestToken(admin, 'not-a-real-token');
    expect(grant).toBeNull();
    expect(matchedBy).toBeNull();
  });

  it('the hash it looks up is the same sha256 hex the migration backfilled', async () => {
    // Migration 0297 backfills encode(digest(guest_token,'sha256'),'hex').
    // If these two ever diverge, every backfilled row silently stops
    // resolving through the hash path and falls back to raw forever.
    const { admin, queries } = fakeAdmin([]);
    await findGrantByGuestToken(admin, RAW);
    expect(queries[0].value).toBe(sha256(RAW));
    expect(queries[0].value).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('§4.2 — the rate limit on the guest resolver', () => {
  it('records the attempt BEFORE counting, so hammering burns its own budget', async () => {
    const { admin, inserts } = fakeAdmin([]);
    await guestLinkRateLimited(admin, '1.2.3.4');
    expect(inserts).toEqual([{ table: 'guest_link_rate_limit', payload: { ip: '1.2.3.4' } }]);
  });

  it('is under the limit when the window count is low', async () => {
    const { admin } = fakeAdmin([]);
    expect(await guestLinkRateLimited(admin, '1.2.3.4')).toBe(false);
  });

  it('trips once the window count exceeds the limit', async () => {
    const admin = {
      from: () => {
        const b: Record<string, unknown> = {};
        const self = () => b as never;
        Object.assign(b, {
          select: self, eq: self, gte: self, is: self,
          insert: () => Promise.resolve({ error: null }),
          then: (resolve: (v: unknown) => unknown) =>
            Promise.resolve({ count: GUEST_LINK_RATE_LIMIT_PER_MINUTE + 1, error: null }).then(resolve),
        });
        return b;
      },
    } as unknown as SupabaseClient;
    expect(await guestLinkRateLimited(admin, '9.9.9.9')).toBe(true);
  });

  it('fails OPEN when the database errors — a blip must not take a data room offline', async () => {
    const admin = {
      from: () => { throw new Error('connection reset'); },
    } as unknown as SupabaseClient;
    expect(await guestLinkRateLimited(admin, '1.2.3.4')).toBe(false);
  });

  it('reads the client IP from the proxy headers, first hop first', () => {
    expect(clientIp(new Request('https://x.test', { headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' } }))).toBe('203.0.113.9');
    expect(clientIp(new Request('https://x.test', { headers: { 'x-real-ip': '198.51.100.4' } }))).toBe('198.51.100.4');
    expect(clientIp(new Request('https://x.test'))).toBe('unknown');
  });
});

// Keeps vitest from complaining about an unused import in some configs.
void vi;

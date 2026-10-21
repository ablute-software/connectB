// The server-side completeness callers (the "reached 80%" milestone and the back office's table) ask the same question the Settings bar asks — does this org have a
// milestone marked done? — so the three cannot disagree about the same company (20/10/2026).
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { orgHasRoadmapHistory, orgIdsWithRoadmapHistory, roadmapContextFromHistory } from './roadmap-history';

// a roadmap_events table with `rows` (each a done event of one org), read the way PostgREST reads it: at most 1000 rows a request
function fakeAdmin(rows: { org_id: string; id?: string }[], opts: { failOnRequest?: number } = {}) {
  const requests: { from: number; to: number }[] = [];
  const query = {
    select: () => query, eq: () => query, order: () => query, limit: () => query,
    range(from: number, to: number) {
      requests.push({ from, to });
      const failed = opts.failOnRequest === requests.length;
      return Promise.resolve({ data: failed ? null : rows.slice(from, to + 1), error: failed ? { message: 'boom' } : null });
    },
    then(resolve: (v: unknown) => unknown) { // `.limit(1)` is awaited directly
      return Promise.resolve({ data: rows.slice(0, 1), error: opts.failOnRequest === 1 ? { message: 'boom' } : null }).then(resolve);
    },
  };
  return { admin: { from: () => query } as unknown as SupabaseClient, requests };
}
const many = (orgs: number, perOrg: number) => Array.from({ length: orgs * perOrg }, (_, i) => ({ org_id: `org-${String(Math.floor(i / perOrg)).padStart(4, '0')}` }));

describe('orgIdsWithRoadmapHistory', () => {
  it('collects every org with a done milestone, once each', async () => {
    const { admin } = fakeAdmin([{ org_id: 'a' }, { org_id: 'a' }, { org_id: 'b' }]);
    expect(await orgIdsWithRoadmapHistory(admin)).toEqual(new Set(['a', 'b']));
  });

  it('reads past the first 1000 rows (PostgREST\'s page) — 2,500 milestones of 500 orgs lose nobody', async () => {
    const { admin, requests } = fakeAdmin(many(500, 5));
    const ids = await orgIdsWithRoadmapHistory(admin);
    expect(ids?.size).toBe(500);
    expect(requests).toEqual([{ from: 0, to: 999 }, { from: 1000, to: 1999 }, { from: 2000, to: 2999 }]);
  });

  it('exactly one full page asks for the next, finds it empty, and stops', async () => {
    const { admin, requests } = fakeAdmin(many(1000, 1));
    expect((await orgIdsWithRoadmapHistory(admin))?.size).toBe(1000);
    expect(requests).toHaveLength(2);
  });

  it('an empty table is an empty set, not "unknown"', async () => {
    expect(await orgIdsWithRoadmapHistory(fakeAdmin([]).admin)).toEqual(new Set());
  });

  it('a failed page is "unknown" (null) — never a partial set that would score the rest as empty', async () => {
    expect(await orgIdsWithRoadmapHistory(fakeAdmin(many(1500, 1), { failOnRequest: 2 }).admin)).toBeNull();
  });
});

describe('orgHasRoadmapHistory', () => {
  it('true with a done milestone, false without, null when the table cannot be read', async () => {
    expect(await orgHasRoadmapHistory(fakeAdmin([{ org_id: 'a', id: '1' }]).admin, 'a')).toBe(true);
    expect(await orgHasRoadmapHistory(fakeAdmin([]).admin, 'a')).toBe(false);
    expect(await orgHasRoadmapHistory(fakeAdmin([{ org_id: 'a' }], { failOnRequest: 1 }).admin, 'a')).toBeNull();
  });
});

describe('roadmapContextFromHistory — what the score is told', () => {
  it('unknown leaves the roadmap out of the score; known puts it in', () => {
    expect(roadmapContextFromHistory(null)).toEqual({});
    expect(roadmapContextFromHistory(false)).toEqual({ roadmapEvents: [] });
    expect(roadmapContextFromHistory(true)).toEqual({ roadmapEvents: [{ status: 'done' }] });
  });
});

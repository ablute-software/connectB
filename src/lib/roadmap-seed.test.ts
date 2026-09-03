import { describe, expect, it } from 'vitest';
import { seedRoadmapCategoriesOn, type SeedLane } from './roadmap-seed';
import type { Db } from './types';

// Prompt 540 RC1 §2 — five lanes, ONE insert, ONE commit.
//
// What this replaces: `for (const lane of DEFAULT_LANES) void
// addRoadmapCategory(lane)` — five concurrent calls that had each captured
// the same empty snapshot before their await. All five rows reached the
// database; only the last commit to resolve survived in memory, so the
// founder saw one category (or none) until a refresh ran loadAll.

const LANES: SeedLane[] = [
  { label: 'Technology & Product', color: 'blue', shape: 'rounded' },
  { label: 'Market & Commercial', color: 'green', shape: 'rounded' },
  { label: 'Funding', color: 'amber', shape: 'rounded' },
  { label: 'Team & Company', color: 'purple', shape: 'rounded' },
  { label: 'Regulatory & IP', color: 'teal', shape: 'rounded' },
] as SeedLane[];

function harness(opts: { existingInTable?: unknown[]; existingInMemory?: number } = {}) {
  const inserts: Record<string, unknown>[][] = [];
  const selects: string[] = [];
  const commits: Db[] = [];
  let snapshot = {
    roadmapCategories: Array.from({ length: opts.existingInMemory ?? 0 }, (_, i) => ({ id: `pre${i}` })),
  } as unknown as Db;

  const sb = {
    from: (table: string) => ({
      select: (cols: string) => ({
        eq: () => ({
          limit: () => { selects.push(`${table}.${cols}`); return Promise.resolve({ data: opts.existingInTable ?? [], error: null }); },
        }),
      }),
      insert: (rows: Record<string, unknown>[]) => ({
        select: () => { inserts.push(rows); return Promise.resolve({ data: rows, error: null }); },
      }),
    }),
  };

  let n = 0;
  const run = () => seedRoadmapCategoriesOn(
    sb, 'org-1', LANES,
    () => snapshot,
    (next) => { snapshot = next; commits.push(next); },
    () => `id-${++n}`,
  );
  return { run, inserts, selects, commits, get snapshot() { return snapshot; } };
}

describe('seedRoadmapCategoriesOn', () => {
  it('writes all five lanes in ONE insert and commits ONE time', async () => {
    const h = harness();
    const result = await h.run();
    expect(result).toEqual({ inserted: 5 });
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0]).toHaveLength(5);
    expect(h.commits).toHaveLength(1);
    expect(h.snapshot.roadmapCategories).toHaveLength(5);
    expect(h.snapshot.roadmapCategories.map((c) => c.label)).toEqual([
      'Technology & Product', 'Market & Commercial', 'Funding', 'Team & Company', 'Regulatory & IP',
    ]);
  });

  it('every seeded lane is visible and carries the org id', async () => {
    const h = harness();
    await h.run();
    for (const row of h.inserts[0]) {
      expect(row.org_id).toBe('org-1');
      expect(row.visible).toBe(true);
      expect(typeof row.id).toBe('string');
    }
  });

  it('a second call with rows ALREADY IN THE TABLE is a no-op', async () => {
    // The React-18 double mount, and two browser tabs. The pre-insert check
    // is what makes the second attempt cost one select instead of five more
    // categories.
    const h = harness({ existingInTable: [{ id: 'existing' }] });
    const result = await h.run();
    expect(result).toEqual({ inserted: 0 });
    expect(h.inserts).toHaveLength(0);
    expect(h.commits).toHaveLength(0);
  });

  it('a second call with rows already IN MEMORY never even asks the server', async () => {
    const h = harness({ existingInMemory: 5 });
    const result = await h.run();
    expect(result).toEqual({ inserted: 0 });
    expect(h.selects).toHaveLength(0);
    expect(h.inserts).toHaveLength(0);
  });

  it('does not clobber categories that arrived WHILE the insert was in flight', async () => {
    // The lost update, in its remaining form: the initial load can land
    // between the insert and the commit. Committing from the captured
    // snapshot would throw those rows away.
    const inserts: Record<string, unknown>[][] = [];
    let snapshot = { roadmapCategories: [] } as unknown as Db;
    const commits: Db[] = [];
    const sb = {
      from: () => ({
        select: () => ({ eq: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }),
        insert: (rows: Record<string, unknown>[]) => ({
          select: () => {
            inserts.push(rows);
            // loadAll resolves right here, before our commit runs.
            snapshot = { roadmapCategories: [{ id: 'from-load' }] } as unknown as Db;
            return Promise.resolve({ data: rows, error: null });
          },
        }),
      }),
    };
    let n = 0;
    const result = await seedRoadmapCategoriesOn(
      sb, 'org-1', LANES, () => snapshot,
      (next) => { snapshot = next; commits.push(next); }, () => `id-${++n}`,
    );
    expect(result).toEqual({ inserted: 0 });
    expect(commits).toHaveLength(0);
    expect(snapshot.roadmapCategories).toEqual([{ id: 'from-load' }]);
  });

  it('surfaces an insert error instead of committing a phantom list', async () => {
    let snapshot = { roadmapCategories: [] } as unknown as Db;
    const commits: Db[] = [];
    const sb = {
      from: () => ({
        select: () => ({ eq: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }),
        insert: () => ({ select: () => Promise.resolve({ data: null, error: { message: 'permission denied' } }) }),
      }),
    };
    const result = await seedRoadmapCategoriesOn(
      sb, 'org-1', LANES, () => snapshot, (next) => { snapshot = next; commits.push(next); }, () => 'x',
    );
    expect(result).toEqual({ error: 'permission denied' });
    expect(commits).toHaveLength(0);
  });

  it('turns a thrown network error into the same {error} shape (Prompt 387 §B)', async () => {
    const sb = { from: () => { throw new Error('Failed to fetch'); } };
    const result = await seedRoadmapCategoriesOn(
      sb as never, 'org-1', LANES, () => ({ roadmapCategories: [] } as unknown as Db), () => {}, () => 'x',
    );
    expect(result.error).toBe('Failed to fetch');
  });
});

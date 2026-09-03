// Prompt 540 RC1 §2 — seeding the five default lanes, as ONE insert.
//
// What it replaces: RoadmapPanel ran `for (const lane of DEFAULT_LANES)
// void addRoadmapCategory(lane)` — five concurrent calls, each of which had
// captured the same empty snapshot before its await and rebuilt the whole
// list from it afterwards. All five rows reached the database; only the
// last one to resolve survived in memory. A refresh ran loadAll and the
// founder saw five categories appear "out of nowhere", which is exactly
// the reported symptom.
//
// The per-action fix (commit from a fresh read) makes that loop correct.
// This makes it unnecessary: one insert, one commit, one round trip. Five
// concurrent writes for a fixed, known list was never the right shape —
// it is five chances to interleave for something that has no reason to.
//
// Lives in its own module, taking `read`/`commit` callbacks rather than
// living inside the provider closure, so the real shipped logic can be
// tested without a DOM. store-supabase.tsx's action is a thin wrapper
// around this function; nothing is duplicated.
import type { Db, RoadmapCategory } from './types';

export type SeedLane = Omit<RoadmapCategory, 'id' | 'org_id' | 'created_at' | 'visible'> & { visible?: boolean };

export interface SeedClientLike {
  from: (table: string) => {
    select: (cols: string) => { eq: (col: string, val: string) => { limit: (n: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> } };
    insert: (rows: Record<string, unknown>[]) => { select: () => PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }> };
  };
}

export interface SeedResult { error?: string; inserted?: number }

/**
 * Inserts `lanes` as roadmap_categories for `orgId` and commits the returned
 * rows in a single update.
 *
 * The pre-insert `select … limit 1` is not belt-and-braces: React 18 mounts
 * an effect twice in development, and a founder can open the Roadmap tab in
 * two tabs at once. Re-checking immediately before the write makes the
 * second attempt a cheap no-op instead of ten categories. It is a check, not
 * a lock — a true simultaneous race would still need a unique constraint —
 * but it closes the window that actually occurs, which is "a second mount a
 * few hundred milliseconds later".
 */
export async function seedRoadmapCategoriesOn(
  sb: SeedClientLike, orgId: string, lanes: SeedLane[],
  read: () => Db, commit: (next: Db) => void,
  makeId: () => string,
): Promise<SeedResult> {
  if (lanes.length === 0) return { inserted: 0 };
  // Never seed over a founder's own categories — in memory or in the table.
  if (read().roadmapCategories.length > 0) return { inserted: 0 };

  try {
    const { data: existing, error: checkError } = await sb.from('roadmap_categories')
      .select('id').eq('org_id', orgId).limit(1);
    if (checkError) return { error: checkError.message };
    if (existing && existing.length > 0) return { inserted: 0 };

    const now = new Date().toISOString();
    const rows = lanes.map((lane) => ({
      visible: true, ...lane, id: makeId(), org_id: orgId, created_at: now,
    }));

    const { data, error } = await sb.from('roadmap_categories').insert(rows).select();
    if (error) return { error: error.message };

    // The DATABASE's rows, not the ones just built: a default or trigger
    // could have changed them, and the canvas keys lanes by id.
    const inserted = (data ?? rows) as unknown as RoadmapCategory[];
    // Re-read at commit time, same rule as every other action in the store —
    // the initial load can have landed while this insert was in flight.
    const cur = read();
    if (cur.roadmapCategories.length > 0) return { inserted: 0 };
    commit({ ...cur, roadmapCategories: [...cur.roadmapCategories, ...inserted] });
    return { inserted: inserted.length };
  } catch (e) {
    return { error: (e as Error).message || 'Could not reach the server — check your connection and try again.' };
  }
}

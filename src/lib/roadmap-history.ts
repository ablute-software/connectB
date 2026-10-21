// Who has roadmap HISTORY (a milestone marked done), for the places that compute the profile's completeness on the server.
//
// 20/10/2026: the completeness score asks a company that has existed for a year for its roadmap history (companyCompleteness.ts). The Settings bar reads the
// roadmap from the client store; the "reached 80%" milestone (/api/org/update) and the back office's table (/api/backoffice/startups) are computed on the server
// and must ask the SAME question, or the milestone, the table and the bar say three different things about the same company — the exact failure this repo has
// had with "complete" before. `null` means the table could not be read: the roadmap is then left out of the score, never counted as empty.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CompletenessContext } from './companyCompleteness';

const PAGE = 1000; // PostgREST returns at most 1000 rows a request

/** Every org id that has at least one milestone marked done. null when roadmap_events cannot be read. */
export async function orgIdsWithRoadmapHistory(admin: SupabaseClient): Promise<Set<string> | null> {
  const ids = new Set<string>();
  for (let page = 0; ; page++) {
    const { data, error } = await admin.from('roadmap_events').select('org_id').eq('status', 'done').order('org_id').range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) return null;
    for (const row of (data ?? []) as { org_id: string }[]) ids.add(row.org_id);
    if ((data?.length ?? 0) < PAGE) return ids;
  }
}

/** Does this one org have a milestone marked done? null when roadmap_events cannot be read. */
export async function orgHasRoadmapHistory(admin: SupabaseClient, orgId: string): Promise<boolean | null> {
  const { data, error } = await admin.from('roadmap_events').select('id').eq('org_id', orgId).eq('status', 'done').limit(1);
  if (error) return null;
  return (data?.length ?? 0) > 0;
}

/** The completeness context for an answer from the two functions above: unknown → the roadmap takes no part in the score. */
export function roadmapContextFromHistory(hasHistory: boolean | null): CompletenessContext {
  return hasHistory === null ? {} : { roadmapEvents: hasHistory ? [{ status: 'done' }] : [] };
}

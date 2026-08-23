import 'server-only';
// Prompt 321 — My Network 6/9. Posts: reads/writes only, RLS-mirrored
// visibility computed LIVE off network_connections/network_group_members —
// never a snapshot of who could see a post at publish time (Pedido A's own
// explicit requirement). Every write goes through checkNetworkContent
// first, server-side, same discipline as every other free-text surface in
// this series.
import type { SupabaseClient } from '@supabase/supabase-js';
import { checkNetworkContent } from './network-content-policy';
import { isPostVisibleToViewer, canShareRoundMilestone, formatRoundMilestoneText, type NetworkUpdateStructured } from './network';
import { computeRoundProgressPercent } from './round-progress';
import { isNetworkActorSuspended, NETWORK_SUSPENDED_ERROR, readActiveConnectionActorIds, resolveActorDisplays } from './network-db';

export type NetworkPostKind = 'freeform' | 'update' | 'milestone';

export interface NetworkPost {
  id: string; authorActorId: string; authorName: string; body: string; kind: NetworkPostKind; structured: NetworkUpdateStructured | null;
  target: 'all' | 'group'; groupId: string | null; groupName: string | null; createdAt: string;
}

// Prompt 322 Pedido A — kind='update' composes body from whichever
// structured sections the founder actually filled in (all optional, per
// the prompt); this is what the feed renders and what the anti-sales
// linter scans — free text WITHIN a section is never exempt from 321's
// rule just because it's structured.
const SECTION_LABEL: Record<keyof NetworkUpdateStructured, string> = {
  productProgress: 'Product', customers: 'Customers', team: 'Team', learnings: 'Learnings',
};
function composeUpdateBody(structured: NetworkUpdateStructured): string {
  return (Object.keys(SECTION_LABEL) as (keyof NetworkUpdateStructured)[])
    .filter((key) => structured[key]?.trim())
    .map((key) => `${SECTION_LABEL[key]}: ${structured[key]!.trim()}`)
    .join('\n');
}

export async function createPost(admin: SupabaseClient, params: {
  authorActorId: string; target: 'all' | 'group'; groupId?: string | null; excludedActorIds?: string[];
} & ({ kind: 'freeform'; body: string } | { kind: 'update'; structured: NetworkUpdateStructured })): Promise<{ ok: true; postId: string } | { ok: false; error: string }> {
  if (await isNetworkActorSuspended(admin, params.authorActorId)) return { ok: false, error: NETWORK_SUSPENDED_ERROR };

  const body = params.kind === 'update' ? composeUpdateBody(params.structured) : params.body;
  if (!body.trim()) return { ok: false, error: params.kind === 'update' ? 'Fill in at least one section.' : 'Post body is required.' };
  const contentCheck = checkNetworkContent(body);
  if (contentCheck.blocked) return { ok: false, error: contentCheck.reason! };

  if (params.target === 'group') {
    if (!params.groupId) return { ok: false, error: 'Missing groupId.' };
    const { data: membership } = await admin.from('network_group_members')
      .select('id').eq('group_id', params.groupId).eq('actor_id', params.authorActorId).eq('status', 'active').maybeSingle();
    if (!membership) return { ok: false, error: 'You can only post to a group you belong to.' };
  }

  const { data, error } = await admin.from('network_posts').insert({
    author_actor_id: params.authorActorId, body: body.trim(), kind: params.kind,
    structured: params.kind === 'update' ? params.structured : null,
    target: params.target, group_id: params.target === 'group' ? params.groupId : null,
    excluded_actor_ids: params.target === 'all' ? (params.excludedActorIds ?? []) : [],
  }).select('id').single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not create post.' };
  return { ok: true, postId: data.id as string };
}

const STAGE_LABEL: Record<string, string> = {
  pre_seed: 'pre-seed', seed: 'seed', series_a: 'Series A', series_b_plus: 'Series B+', growth: 'growth',
};

// Pedido C — round milestones. The toggle (orgs.round_progress_visible_to_investors,
// reused literally, no second toggle) gates whether the button even exists;
// this function re-checks it server-side regardless of what the client
// showed. Percentage only, computed with the SAME formula the dossier uses
// (round-progress.ts) — never the exact € amount, which is MORE restrictive
// than the toggle strictly requires: broadcasting to the whole network is a
// wider, less controlled audience than one investor's own dossier, and that
// difference in audience size is exactly why this earns its own stricter
// rule rather than copying the dossier's.
export async function createRoundMilestonePost(admin: SupabaseClient, params: { authorActorId: string; orgId: string }): Promise<{ ok: true; postId: string } | { ok: false; error: string }> {
  const { data: org } = await admin.from('orgs')
    .select('name, stage, round_progress_visible_to_investors, round_target_eur, round_secured_eur').eq('id', params.orgId).maybeSingle();
  if (!org) return { ok: false, error: 'Org not found.' };
  if (!canShareRoundMilestone(!!org.round_progress_visible_to_investors)) {
    return { ok: false, error: 'Turn on "share round progress with investors" first — this reuses that same setting.' };
  }

  const { data: commits } = await admin.from('investor_soft_commits').select('amount_eur').eq('org_id', params.orgId).eq('confirmed_by_founder', true);
  const softCommittedEur = (commits ?? []).reduce((sum, c) => sum + Number(c.amount_eur), 0);
  const securedShown = (org.round_secured_eur ?? 0) + softCommittedEur;
  const percent = computeRoundProgressPercent(securedShown, org.round_target_eur);
  if (percent == null) return { ok: false, error: 'Set a round target and secured amount first.' };

  const body = formatRoundMilestoneText({ orgName: org.name as string, percent, stageLabel: STAGE_LABEL[org.stage as string] ?? null });
  const { data, error } = await admin.from('network_posts').insert({
    author_actor_id: params.authorActorId, body, kind: 'milestone', structured: null, target: 'all', excluded_actor_ids: [],
  }).select('id').single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not publish milestone.' };
  return { ok: true, postId: data.id as string };
}

// Pedido B — the private cadence coach's own data source: this founder's
// most recent kind='update' post, theirs alone, never another actor's.
export async function readLastUpdatePostCreatedAt(admin: SupabaseClient, authorActorId: string): Promise<string | null> {
  const { data } = await admin.from('network_posts').select('created_at')
    .eq('author_actor_id', authorActorId).eq('kind', 'update').is('deleted_at', null)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  return (data?.created_at as string | undefined) ?? null;
}

export async function deletePost(admin: SupabaseClient, params: { postId: string; authorActorId: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: post } = await admin.from('network_posts').select('author_actor_id').eq('id', params.postId).maybeSingle();
  if (!post) return { ok: false, error: 'Post not found.' };
  if (post.author_actor_id !== params.authorActorId) return { ok: false, error: 'You can only delete your own posts.' };
  const { error } = await admin.from('network_posts').update({ deleted_at: new Date().toISOString() }).eq('id', params.postId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

// The feed itself. Mirrors the RLS policy's own logic exactly (0215's
// network_posts_visible_read) so the service-role read (which bypasses RLS
// entirely) still applies the SAME allowlist — the connection/exclusion
// check is re-evaluated here at read time, never cached from publish time.
export async function readFeedForActor(admin: SupabaseClient, actorId: string): Promise<NetworkPost[]> {
  const [connectionActorIds, groupMemberships] = await Promise.all([
    readActiveConnectionActorIds(admin, actorId),
    admin.from('network_group_members').select('group_id').eq('actor_id', actorId).eq('status', 'active'),
  ]);
  const groupIds = (groupMemberships.data ?? []).map((g) => g.group_id as string);

  const orClauses = [`author_actor_id.eq.${actorId}`];
  if (connectionActorIds.length > 0) orClauses.push(`and(target.eq.all,author_actor_id.in.(${connectionActorIds.join(',')}))`);
  if (groupIds.length > 0) orClauses.push(`and(target.eq.group,group_id.in.(${groupIds.join(',')}))`);

  const { data } = await admin.from('network_posts')
    .select('id, author_actor_id, body, kind, structured, target, group_id, excluded_actor_ids, created_at')
    .is('deleted_at', null).or(orClauses.join(','))
    .order('created_at', { ascending: false });
  const rows = (data ?? []) as { id: string; author_actor_id: string; body: string; kind: NetworkPostKind; structured: NetworkUpdateStructured | null; target: 'all' | 'group'; group_id: string | null; excluded_actor_ids: string[]; created_at: string }[];
  const groupIdSet = new Set(groupIds);

  // The .or() query above is a coarse pre-filter (cheaper than fetching
  // every post); the actual visibility decision — exclusions included — is
  // network.ts's own isPostVisibleToViewer, the exact same rule the RLS
  // policy encodes, applied here on data resolved LIVE (connectionActorIds/
  // groupIds above), never a snapshot from publish time.
  const visible = rows.filter((r) => isPostVisibleToViewer(
    { authorActorId: r.author_actor_id, target: r.target, groupId: r.group_id, excludedActorIds: r.excluded_actor_ids },
    actorId, connectionActorIds.includes(r.author_actor_id), !!r.group_id && groupIdSet.has(r.group_id),
  ));

  const actorIds = [...new Set(visible.map((r) => r.author_actor_id))];
  const groupIdsInFeed = [...new Set(visible.filter((r) => r.group_id).map((r) => r.group_id as string))];
  const [displays, groups] = await Promise.all([
    resolveActorDisplays(admin, actorIds),
    groupIdsInFeed.length ? admin.from('network_groups').select('id, name').in('id', groupIdsInFeed) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const groupNameById = new Map((groups.data ?? []).map((g) => [g.id as string, g.name as string]));

  return visible.map((r) => ({
    id: r.id, authorActorId: r.author_actor_id, authorName: displays.get(r.author_actor_id)?.name ?? 'Someone in your network',
    body: r.body, kind: r.kind, structured: r.structured, target: r.target, groupId: r.group_id, groupName: r.group_id ? (groupNameById.get(r.group_id) ?? null) : null,
    createdAt: r.created_at,
  }));
}

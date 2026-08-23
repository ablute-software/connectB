import 'server-only';
// Prompt 321 — My Network 6/9. Posts: reads/writes only, RLS-mirrored
// visibility computed LIVE off network_connections/network_group_members —
// never a snapshot of who could see a post at publish time (Pedido A's own
// explicit requirement). Every write goes through checkNetworkContent
// first, server-side, same discipline as every other free-text surface in
// this series.
import type { SupabaseClient } from '@supabase/supabase-js';
import { checkNetworkContent } from './network-content-policy';
import { isPostVisibleToViewer } from './network';
import { isNetworkActorSuspended, NETWORK_SUSPENDED_ERROR, readActiveConnectionActorIds, resolveActorDisplays } from './network-db';

export interface NetworkPost {
  id: string; authorActorId: string; authorName: string; body: string;
  target: 'all' | 'group'; groupId: string | null; groupName: string | null; createdAt: string;
}

export async function createPost(admin: SupabaseClient, params: {
  authorActorId: string; body: string; target: 'all' | 'group'; groupId?: string | null; excludedActorIds?: string[];
}): Promise<{ ok: true; postId: string } | { ok: false; error: string }> {
  if (await isNetworkActorSuspended(admin, params.authorActorId)) return { ok: false, error: NETWORK_SUSPENDED_ERROR };
  const contentCheck = checkNetworkContent(params.body);
  if (contentCheck.blocked) return { ok: false, error: contentCheck.reason! };
  if (!params.body.trim()) return { ok: false, error: 'Post body is required.' };

  if (params.target === 'group') {
    if (!params.groupId) return { ok: false, error: 'Missing groupId.' };
    const { data: membership } = await admin.from('network_group_members')
      .select('id').eq('group_id', params.groupId).eq('actor_id', params.authorActorId).eq('status', 'active').maybeSingle();
    if (!membership) return { ok: false, error: 'You can only post to a group you belong to.' };
  }

  const { data, error } = await admin.from('network_posts').insert({
    author_actor_id: params.authorActorId, body: params.body.trim(), target: params.target,
    group_id: params.target === 'group' ? params.groupId : null,
    excluded_actor_ids: params.target === 'all' ? (params.excludedActorIds ?? []) : [],
  }).select('id').single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not create post.' };
  return { ok: true, postId: data.id as string };
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
    .select('id, author_actor_id, body, target, group_id, excluded_actor_ids, created_at')
    .is('deleted_at', null).or(orClauses.join(','))
    .order('created_at', { ascending: false });
  const rows = (data ?? []) as { id: string; author_actor_id: string; body: string; target: 'all' | 'group'; group_id: string | null; excluded_actor_ids: string[]; created_at: string }[];
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
    body: r.body, target: r.target, groupId: r.group_id, groupName: r.group_id ? (groupNameById.get(r.group_id) ?? null) : null,
    createdAt: r.created_at,
  }));
}

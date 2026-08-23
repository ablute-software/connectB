// Prompt 316/317 — My Network. GET bootstraps everything /network's page
// needs: my connections/invites (resolved to display names — RLS on
// network_actors deliberately only lets an actor read their OWN row, so
// resolving the OTHER side of a connection/invite has to happen here,
// service-role, not via a direct client select), and merged connection
// suggestions from BOTH sources (316's shared-investor, gated on this org's
// own network_discoverable opt-in; 317's shared-group, which needs no
// separate opt-in — membership in a group is already consensual and only
// ever visible to that group's own members).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { networkAvailable } from '@/lib/network-capability';
import {
  resolveActorId, resolveActorDisplays, readConnectionsForActor, readInvitesForActor, readSharedInvestorDeliveryRows,
  readActiveGroupMembershipRows,
} from '@/lib/network-db';
import { computeSharedInvestorSuggestions, computeSharedGroupSuggestions, mergeConnectionSuggestions, effectiveInviteStatus } from '@/lib/network';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const empty = { available: false };
  if (!url || !serviceKey) return NextResponse.json(empty);

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  if (!(await networkAvailable())) return NextResponse.json(empty);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const actor = await resolveActorId(admin, user.id);
  if (!actor) return NextResponse.json(empty);

  const [connections, invites] = await Promise.all([
    readConnectionsForActor(admin, actor.actorId),
    readInvitesForActor(admin, actor.actorId),
  ]);

  const now = new Date();
  const activeConnections = connections.filter((c) => c.status === 'active');
  const otherActorIds = activeConnections.map((c) => (c.actorLowId === actor.actorId ? c.actorHighId : c.actorLowId));
  const receivedPending = invites.received.filter((i) => effectiveInviteStatus(i, now) === 'pending');
  const sentVisible = invites.sent.filter((i) => effectiveInviteStatus(i, now) !== 'expired' || i.status !== 'pending');
  const inviteActorIds = [...receivedPending.map((i) => i.fromActorId), ...sentVisible.map((i) => i.toActorId)];

  // Source 1 (316) — shared investor. Founder-only, and only once this org
  // has opted into network_discoverable — a suggestion here would otherwise
  // expose another org's own pipeline data (which investor invested in
  // them) to someone who never consented to being found this way.
  let discoverable = false;
  let sharedInvestorByActor: { otherActorId: string; investorName: string }[] = [];
  if (actor.kind === 'founder' && actor.orgId) {
    const { data: org } = await admin.from('orgs').select('network_discoverable').eq('id', actor.orgId).maybeSingle();
    discoverable = !!org?.network_discoverable;
    if (discoverable) {
      const rows = await readSharedInvestorDeliveryRows(admin);
      const byOrg = computeSharedInvestorSuggestions(rows, actor.orgId);
      const orgIds = byOrg.map((s) => s.otherOrgId);
      const { data: actorsByOrg } = orgIds.length
        ? await admin.from('network_actors').select('id, org_id').in('org_id', orgIds)
        : { data: [] as { id: string; org_id: string }[] };
      const actorIdByOrgId = new Map((actorsByOrg ?? []).map((a) => [a.org_id, a.id]));
      sharedInvestorByActor = byOrg
        .map((s) => ({ otherActorId: actorIdByOrgId.get(s.otherOrgId), investorName: s.investorName }))
        .filter((s): s is { otherActorId: string; investorName: string } => !!s.otherActorId);
    }
  }

  // Source 2 (317) — shared group. No opt-in needed: belonging to a group
  // is already something the actor consented to when accepting its invite.
  const membershipRows = await readActiveGroupMembershipRows(admin);
  const sharedGroup = computeSharedGroupSuggestions(membershipRows, actor.actorId)
    .map((s) => ({ otherActorId: s.otherActorId, groupName: s.groupName }));

  const merged = mergeConnectionSuggestions(sharedInvestorByActor, sharedGroup);
  const suggestionActorIds = merged.map((m) => m.otherActorId);

  const displays = await resolveActorDisplays(admin, [...new Set([...otherActorIds, ...inviteActorIds, ...suggestionActorIds])]);

  return NextResponse.json({
    available: true,
    myActorId: actor.actorId,
    myActorKind: actor.kind,
    discoverable,
    connections: activeConnections.map((c) => {
      const otherId = c.actorLowId === actor.actorId ? c.actorHighId : c.actorLowId;
      const other = displays.get(otherId);
      return {
        id: c.id, otherActorId: otherId, otherName: other?.name ?? 'Unknown', otherKind: other?.kind ?? 'founder',
        originContext: c.originContext, createdAt: c.createdAt,
      };
    }),
    invitesReceived: receivedPending.map((i) => {
      const from = displays.get(i.fromActorId);
      return { id: i.id, fromName: from?.name ?? 'Unknown', fromKind: from?.kind ?? 'founder', contextRef: i.contextRef, message: i.message, expiresAt: i.expiresAt };
    }),
    invitesSent: sentVisible.map((i) => {
      const to = displays.get(i.toActorId);
      const status = effectiveInviteStatus(i, now);
      return { id: i.id, toName: to?.name ?? 'Unknown', toKind: to?.kind ?? 'founder', status, expiresAt: i.expiresAt };
    }),
    pendingSentCount: sentVisible.filter((i) => effectiveInviteStatus(i, now) === 'pending').length,
    suggestions: merged.map((m) => ({
      actorId: m.otherActorId, name: displays.get(m.otherActorId)?.name ?? 'Unknown', reasons: m.reasons,
    })),
  });
}

// Prompt 316 — My Network 1/9. GET bootstraps everything /network's page
// needs: my connections/invites (resolved to display names — RLS on
// network_actors deliberately only lets an actor read their OWN row, so
// resolving the OTHER side of a connection/invite has to happen here,
// service-role, not via a direct client select), and — founder actors only,
// per Pedido B — shared-investor suggestions, gated on this org's own
// network_discoverable opt-in.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { networkAvailable } from '@/lib/network-capability';
import {
  resolveActorId, resolveActorDisplays, readConnectionsForActor, readInvitesForActor, readSharedInvestorDeliveryRows,
} from '@/lib/network-db';
import { computeSharedInvestorSuggestions, effectiveInviteStatus } from '@/lib/network';

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

  let discoverable = false;
  let suggestions: { otherOrgId: string; investorName: string }[] = [];
  if (actor.kind === 'founder' && actor.orgId) {
    const { data: org } = await admin.from('orgs').select('network_discoverable').eq('id', actor.orgId).maybeSingle();
    discoverable = !!org?.network_discoverable;
    if (discoverable) {
      const rows = await readSharedInvestorDeliveryRows(admin);
      suggestions = computeSharedInvestorSuggestions(rows, actor.orgId).map((s) => ({ otherOrgId: s.otherOrgId, investorName: s.investorName }));
    }
  }
  const suggestionOrgIds = suggestions.map((s) => s.otherOrgId);
  const suggestionActors = suggestionOrgIds.length
    ? await admin.from('network_actors').select('id, org_id').in('org_id', suggestionOrgIds)
    : { data: [] as { id: string; org_id: string }[] };
  const actorIdByOrgId = new Map((suggestionActors.data ?? []).map((a) => [a.org_id, a.id]));
  const suggestionActorIds = [...actorIdByOrgId.values()];

  const displays = await resolveActorDisplays(admin, [...new Set([...otherActorIds, ...inviteActorIds, ...suggestionActorIds])]);

  return NextResponse.json({
    available: true,
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
    suggestions: suggestions
      .map((s) => {
        const actorId = actorIdByOrgId.get(s.otherOrgId);
        if (!actorId) return null;
        return { actorId, name: displays.get(actorId)?.name ?? 'Unknown', investorName: s.investorName };
      })
      .filter((s): s is { actorId: string; name: string; investorName: string } => s !== null),
  });
}

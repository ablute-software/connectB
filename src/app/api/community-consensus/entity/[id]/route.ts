// Prompt 266 — reads whatever community-consensus values are visible
// (score>0, >=2 agreeing orgs) for this entity's still-blank fields, for
// the Entity summary card's "community · unconfirmed" badges. Never
// exposes which orgs contributed — only the value, score, and this
// founder's own vote (if any); org identity lives only in backoffice.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { communityConsensusAvailable } from '@/lib/community-consensus-capability';
import { catalogFieldIsBlank, consensusVisibility, COMMUNITY_ELIGIBLE_FIELDS } from '@/lib/community-consensus';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: true, fields: [] });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  if (!(await communityConsensusAvailable())) return NextResponse.json({ ok: true, fields: [] });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: entity, error: entityErr } = await admin.from('entities').select('id, org_id, *').eq('id', id).maybeSingle();
  if (entityErr || !entity) return NextResponse.json({ ok: false, error: entityErr?.message ?? 'Entity not found.' }, { status: 404 });
  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).eq('org_id', entity.org_id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of this org.' }, { status: 403 });

  const { data: delivery } = await admin.from('catalog_deliveries').select('catalog_id').eq('entity_id', id).maybeSingle();
  const catalogId = delivery?.catalog_id as string | undefined;
  if (!catalogId) return NextResponse.json({ ok: true, fields: [] });

  const { data: rows } = await admin.from('catalog_field_consensus').select('id, field, value, score').eq('catalog_id', catalogId).in('field', COMMUNITY_ELIGIBLE_FIELDS as unknown as string[]);
  if (!rows || rows.length === 0) return NextResponse.json({ ok: true, fields: [] });

  const consensusIds = rows.map((r) => r.id as string);
  const [{ data: sourceRows }, { data: myVotes }] = await Promise.all([
    admin.from('catalog_field_consensus_sources').select('consensus_id').in('consensus_id', consensusIds),
    admin.from('catalog_field_consensus_votes').select('consensus_id, vote').in('consensus_id', consensusIds).eq('org_id', entity.org_id),
  ]);
  const sourceCountById = new Map<string, number>();
  for (const s of sourceRows ?? []) sourceCountById.set(s.consensus_id as string, (sourceCountById.get(s.consensus_id as string) ?? 0) + 1);
  const myVoteByConsensusId = new Map((myVotes ?? []).map((v) => [v.consensus_id as string, v.vote as number]));

  const fields = rows
    // Own dossier must still be blank too — this suggestion only ever
    // fills a genuine gap, never competes with what the founder (or the
    // MatchDeal-profile prefill, Prompt 256) already put there.
    .filter((r) => catalogFieldIsBlank((entity as Record<string, unknown>)[r.field as string]))
    .map((r) => {
      const sourceCount = sourceCountById.get(r.id as string) ?? 0;
      const visibility = consensusVisibility(r.score as number, sourceCount);
      return { consensusId: r.id, field: r.field, value: r.value, score: r.score, visibility, yourVote: myVoteByConsensusId.get(r.id as string) ?? null };
    })
    .filter((f) => f.visibility === 'community' || f.visibility === 'verified');

  return NextResponse.json({ ok: true, fields });
}

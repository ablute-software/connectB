// Prompt 266 §6 — Backoffice "Contributions — by users" list: every
// catalog_field_consensus row, any state (pending/community/verified/
// hidden), for a developer to see and, for the ones not already visible
// on their own (pending/hidden), approve or reject by hand — including a
// single-source row, per the prompt's own "visible even with just 1
// source (for manual developer approve/reject without waiting for a 2nd
// org)". org identity is never exposed here either — same anonymized-
// count-only rule as the founder-facing entity/[id] route.
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverClient, resolveRole } from '@/lib/supabase-server';
import { communityConsensusAvailable } from '@/lib/community-consensus-capability';
import { consensusVisibility } from '@/lib/community-consensus';

async function adminGate(): Promise<{ admin: SupabaseClient } | { error: NextResponse }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return { error: NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 }) };

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 }) };
  const role = await resolveRole(user.id, user.email, sb, user.email_confirmed_at);
  if (role !== 'developer') return { error: NextResponse.json({ ok: false, error: 'Platform admin only.' }, { status: 403 }) };

  return { admin: createClient(url, service, { auth: { persistSession: false } }) };
}

export async function GET() {
  const gate = await adminGate();
  if ('error' in gate) return gate.error;
  const { admin } = gate;

  if (!(await communityConsensusAvailable())) return NextResponse.json({ ok: true, items: [] });

  const { data: rows, error } = await admin.from('catalog_field_consensus')
    .select('id, catalog_id, field, value, score, created_at, catalog_entities(name)')
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!rows || rows.length === 0) return NextResponse.json({ ok: true, items: [] });

  const ids = rows.map((r) => r.id as string);
  const { data: sourceRows } = await admin.from('catalog_field_consensus_sources').select('consensus_id').in('consensus_id', ids);
  const sourceCountById = new Map<string, number>();
  for (const s of sourceRows ?? []) sourceCountById.set(s.consensus_id as string, (sourceCountById.get(s.consensus_id as string) ?? 0) + 1);

  const items = rows.map((r) => {
    const sourceCount = sourceCountById.get(r.id as string) ?? 0;
    return {
      id: r.id as string,
      catalogName: (r.catalog_entities as unknown as { name: string } | null)?.name ?? 'Unknown',
      field: r.field as string, value: r.value, score: r.score as number, sourceCount,
      visibility: consensusVisibility(r.score as number, sourceCount),
      createdAt: r.created_at as string,
    };
  });
  return NextResponse.json({ ok: true, items });
}

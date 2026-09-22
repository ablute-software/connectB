// Prompt 715 Pedido C — the investor's "Current context" card: About/
// Settings, one row per firm (investor_context). Same auth shape as
// investor-profile/route.ts (resolveActiveInvestorMember -> service role).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resolveActiveInvestorMember } from '@/lib/investor-membership';
import { assertNotViewer } from '@/lib/developer-viewer';
import { getInvestorContext, isContextExpired } from '@/lib/investor-context';
import { bumpMandateVersion } from '@/lib/investor-mandate-versions';

const EDITABLE_CAPACITY = new Set(['few', 'normal', 'many']);
const EDITABLE_EXPIRY_LABEL = new Set(['valid_until', 'review_by']);

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const member = await resolveActiveInvestorMember(admin, user.id, { allowBillingLapsed: true });
  if (!member) return NextResponse.json({ linked: false });

  const context = await getInvestorContext(admin, member.catalog_entity_id);
  return NextResponse.json({
    linked: true, context,
    expired: isContextExpired(context, new Date().toISOString()),
  });
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const member = await resolveActiveInvestorMember(admin, user.id);
  if (!member) return NextResponse.json({ ok: false, error: 'No linked investor entity yet.' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as {
    priorityNote?: string | null; pauseNewCandidates?: boolean; capacity?: string | null;
    expiresAt?: string | null; expiryLabel?: string | null; remove?: boolean;
  };

  // Pedido C — "remover" resets the card to defaults rather than deleting
  // the row (there's nothing sensitive in it, and a row that's never
  // existed vs. one reset to defaults behave identically either way).
  const patch = body.remove
    ? { priority_note: null, pause_new_candidates: false, capacity: null, expires_at: null, expiry_label: null }
    : {
      priority_note: body.priorityNote?.slice(0, 280) ?? null,
      pause_new_candidates: !!body.pauseNewCandidates,
      capacity: body.capacity && EDITABLE_CAPACITY.has(body.capacity) ? body.capacity : null,
      expires_at: body.expiresAt ?? null,
      expiry_label: body.expiryLabel && EDITABLE_EXPIRY_LABEL.has(body.expiryLabel) ? body.expiryLabel : null,
    };

  const { data: updated, error } = await admin.from('investor_context')
    .upsert({ investor_catalog_entity_id: member.catalog_entity_id, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'investor_catalog_entity_id' })
    .select('*').single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // Prompt 715 Pedido D — the context card is part of the mandate snapshot.
  // Best-effort; a version-tracking failure never blocks the save itself.
  const { data: profile } = await admin.from('matchdeal_profiles').select(
    'sectors, stages_invested, geographies, instruments, ticket_min, ticket_max, exclusions_sectors, exclusions_notes',
  ).eq('membership_id', member.id).eq('kind', 'investor').maybeSingle();
  if (profile) {
    await bumpMandateVersion(admin, member.catalog_entity_id, {
      sectors: profile.sectors ?? [], stagesInvested: profile.stages_invested ?? [],
      geographies: profile.geographies ?? [], instruments: profile.instruments ?? [],
      ticketMin: profile.ticket_min, ticketMax: profile.ticket_max,
      exclusionsSectors: profile.exclusions_sectors, exclusionsNotes: profile.exclusions_notes,
      context: { priorityNote: patch.priority_note, pauseNewCandidates: patch.pause_new_candidates, capacity: patch.capacity, expiresAt: patch.expires_at },
    }, user.id);
  }

  return NextResponse.json({ ok: true, context: updated });
}

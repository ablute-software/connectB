// Prompt 107 — owner-controlled Visible/Suspended toggle. Never writes
// is_visible or platform_suspended_at — is_visible is now a computed
// value (see migration 0105's matchdeal_recompute_profile_completeness
// trigger); platform_suspended_at has no UI yet, reserved for a future
// backoffice action.
//
// Prompt 184 §2 — for kind='startup' only, ALSO dual-writes the same
// owner_suspended_at/platform_suspended_at/suspension_reminded_at onto
// `orgs` (migration 0168). Decision (confirmed before writing that
// migration): duplicate, not move — orgs becomes the source of truth
// eligiblePipelineOrgIds reads (portal-access.ts), but matchdeal_profiles'
// own copies keep being written too so this ONE toggle still hides the
// startup from MatchDeal's own swipe deck exactly like it does today
// (is_visible, migration 0105) — moving instead of duplicating would have
// silently stopped that. kind='investor' is untouched — investors have no
// `orgs` row to duplicate onto, and this prompt is entirely about the
// startup side.
import { NextResponse } from 'next/server';
import { matchdealStartupState, orgMatchdealMissing } from '@/lib/matchdeal-publish';
import { isProfileGateComplete, missingProfileGateFieldLinks, type ProfileGateOrg } from '@/lib/pipeline-unlock';
import { investorVisibilityState } from '@/lib/investor-visibility-state';
import type { Org } from '@/lib/types';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resolveActiveInvestorMember } from '@/lib/investor-membership';
import { assertNotViewer } from '@/lib/developer-viewer';
import { orgsPipelineSuspensionAvailable } from '@/lib/pipeline-suspension-capability';

type Kind = 'startup' | 'investor';

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const kind = new URL(req.url).searchParams.get('kind') as Kind | null;
  if (kind !== 'startup' && kind !== 'investor') return NextResponse.json({ ok: false, error: 'kind must be startup or investor.' }, { status: 400 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, service, { auth: { persistSession: false } });

  if (kind === 'startup') {
    const { data: member } = await sb.from('org_members').select('org_id, role').eq('user_id', user.id).maybeSingle();
    if (!member) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });
    // Addenda to Prompt 120 (2026-08-04) — before this, the toggle only
    // ever reflected owner_suspended_at/platform_suspended_at, so a
    // profile that's invisible because it's INCOMPLETE (never suspended by
    // anyone) still showed the green "Visible" badge — confirmed live for
    // Caramel Biscuit and ablute_ both, is_complete=false/is_visible=false
    // with no suspension timestamp on either. Selecting is_complete plus
    // the exact field set matchdeal_recompute_profile_completeness()
    // checks (migration 0105) so this route can tell the two apart and the
    // client can show an honest reason instead of a wrong green badge.
    const [{ data: profile }, { data: org }] = await Promise.all([
      admin.from('matchdeal_profiles')
        .select('owner_suspended_at, platform_suspended_at, suspension_reminded_at, is_complete, photo_url, website, sectors, description, country, investment_stage_sought, company_phase')
        .eq('membership_id', member.org_id).eq('kind', 'startup').maybeSingle(),
      // Prompt 184 §2 — orgs is the authoritative suspension source now;
      // `select('*')` (not an explicit column list) so a pre-migration
      // environment just returns a row without these keys rather than
      // erroring — reads fall back to `profile`'s copy in that case.
      admin.from('orgs').select('*').eq('id', member.org_id).maybeSingle(),
    ]);
    // Prompt 543 §A — computed from the ORG, not from the profile row.
    // That is the correction: the old list was read off `profile`, and for
    // every org created since July there IS no profile row, so the list was
    // always empty and the UI rendered `[].join(', ') || '…'` as a literal
    // ellipsis — "your MatchDeal profile is missing: …". Reading the org
    // means the list is right whether or not the row exists, and each entry
    // carries the About-card anchor to jump to.
    const orgMissing = org ? orgMatchdealMissing(org as unknown as Org) : [];
    const ownerSuspendedAt = (org as { owner_suspended_at?: string | null } | null)?.owner_suspended_at ?? profile?.owner_suspended_at ?? null;
    const platformSuspendedAt = (org as { platform_suspended_at?: string | null } | null)?.platform_suspended_at ?? profile?.platform_suspended_at ?? null;
    const remindedAt = (org as { suspension_reminded_at?: string | null } | null)?.suspension_reminded_at ?? profile?.suspension_reminded_at ?? null;
    const state = matchdealStartupState({
      isComplete: !!profile?.is_complete,
      ownerSuspended: !!ownerSuspendedAt,
      platformSuspended: !!platformSuspendedAt,
      orgMissing,
    });

    // Prompt 850 §B — the SECOND, now-primary question this route answers:
    // can investors find this startup at all? After §A that is decided by
    // the founder's own nine-field profile gate (pipeline-unlock.ts) plus
    // the suspension pair — never by MatchDeal publication. `state` above
    // still describes the MatchDeal card, which is a different thing with
    // its own button; the two are deliberately reported side by side rather
    // than collapsed, because they are genuinely two states now.
    const gateOrg = (org ?? {}) as ProfileGateOrg;
    const gateMissing = org ? missingProfileGateFieldLinks(gateOrg) : [];
    const investorVisibility = investorVisibilityState({
      gateComplete: !!org && isProfileGateComplete(gateOrg),
      ownerSuspended: !!ownerSuspendedAt,
      platformSuspended: !!platformSuspendedAt,
    });
    // "…the count of investor firms that currently have you in their
    // pipeline if it is cheap to compute". It is: two indexed lookups on
    // org_id, no join, no per-firm work. Only computed when the answer can
    // be non-zero — a hidden or incomplete startup is in nobody's pipeline
    // by definition, and asking would be two pointless queries per load.
    // Both sources count because both put a card on an investor's board: a
    // discovery admission (permanent, migration 0157) and a recorded
    // decision. Real or absent, never estimated.
    let pipelineFirmCount: number | null = null;
    if (investorVisibility === 'visible') {
      const [{ data: admissions }, { data: decisions }] = await Promise.all([
        admin.from('investor_pipeline_admissions').select('investor_catalog_entity_id').eq('org_id', member.org_id),
        admin.from('investor_relationship_decisions').select('investor_catalog_entity_id').eq('org_id', member.org_id),
      ]);
      pipelineFirmCount = new Set([
        ...(admissions ?? []).map((r) => r.investor_catalog_entity_id as string),
        ...(decisions ?? []).map((r) => r.investor_catalog_entity_id as string),
      ]).size;
    }

    return NextResponse.json({
      ok: true, isOwner: member.role === 'owner',
      suspended: !!ownerSuspendedAt, platformSuspended: !!platformSuspendedAt,
      suspendedAt: ownerSuspendedAt, remindedAt,
      isComplete: !!profile?.is_complete, hasProfile: !!profile,
      // Prompt 543 §A — `state` is what the UI branches on now. missingFields
      // keeps its old name and shape (a string list) for any caller that
      // still reads it, with missingFieldLinks carrying the anchors.
      state,
      missingFields: orgMissing.map((m) => m.label),
      missingFieldLinks: orgMissing,
      // Prompt 850 §B.
      investorVisibility,
      gateMissingFieldLinks: gateMissing,
      pipelineFirmCount,
    });
  }

  const activeMember = await resolveActiveInvestorMember(admin, user.id);
  if (!activeMember) return NextResponse.json({ ok: false, error: 'No linked investor entity yet.' }, { status: 403 });
  const { data: mim } = await admin.from('matchdeal_investor_members').select('role').eq('id', activeMember.id).maybeSingle();
  const { data: profile } = await admin.from('matchdeal_profiles')
    .select('owner_suspended_at, platform_suspended_at, suspension_reminded_at')
    .eq('membership_id', activeMember.id).eq('kind', 'investor').maybeSingle();
  return NextResponse.json({
    ok: true, isOwner: mim?.role === 'owner',
    suspended: !!profile?.owner_suspended_at, platformSuspended: !!profile?.platform_suspended_at,
    suspendedAt: profile?.owner_suspended_at ?? null, remindedAt: profile?.suspension_reminded_at ?? null,
  });
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const { suspended, kind, markReminded } = await req.json().catch(() => ({})) as { suspended?: boolean; kind?: Kind; markReminded?: boolean };
  if (kind !== 'startup' && kind !== 'investor') return NextResponse.json({ ok: false, error: 'kind must be startup or investor.' }, { status: 400 });
  if (typeof suspended !== 'boolean' && !markReminded) return NextResponse.json({ ok: false, error: 'suspended must be a boolean.' }, { status: 400 });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  // markReminded is its own no-owner-check path — any member dismissing
  // the monthly reminder they were shown just silences it for everyone
  // until the next cycle, same as any other "seen this" acknowledgment;
  // it never touches owner_suspended_at.
  const patch = markReminded
    ? { suspension_reminded_at: new Date().toISOString() }
    : { owner_suspended_at: suspended ? new Date().toISOString() : null };

  if (kind === 'startup') {
    const { data: member } = await sb.from('org_members').select('org_id, role').eq('user_id', user.id).maybeSingle();
    if (!member) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });
    if (member.role !== 'owner') return NextResponse.json({ ok: false, error: 'Only the owner can change visibility.' }, { status: 403 });
    // upsert, not update — an org that never touched MatchDeal has no
    // matchdeal_profiles row yet (confirmed live: a real test org had
    // zero rows), and a plain .update() on zero matching rows silently
    // "succeeds" while changing nothing.
    const { error } = await admin.from('matchdeal_profiles')
      .upsert({ membership_id: member.org_id, kind: 'startup', ...patch }, { onConflict: 'membership_id,kind' });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    // Prompt 184 §2 — dual-write onto orgs (migration 0168), the source
    // eligiblePipelineOrgIds actually reads. `orgs` always has exactly one
    // row per org already (unlike matchdeal_profiles), so this is a plain
    // update, not an upsert. Capability-gated so this route keeps working
    // (writing only the matchdeal_profiles copy, same as before this
    // prompt) on an environment where 0168 hasn't been applied yet.
    if (await orgsPipelineSuspensionAvailable()) {
      await admin.from('orgs').update(patch).eq('id', member.org_id);
    }
    return NextResponse.json({ ok: true });
  }

  const activeMember = await resolveActiveInvestorMember(admin, user.id);
  if (!activeMember) return NextResponse.json({ ok: false, error: 'No linked investor entity yet.' }, { status: 403 });
  const { data: mim } = await admin.from('matchdeal_investor_members').select('role').eq('id', activeMember.id).maybeSingle();
  if (mim?.role !== 'owner') return NextResponse.json({ ok: false, error: 'Only the owner can change visibility.' }, { status: 403 });
  const { error } = await admin.from('matchdeal_profiles')
    .upsert({ membership_id: activeMember.id, kind: 'investor', ...patch }, { onConflict: 'membership_id,kind' });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

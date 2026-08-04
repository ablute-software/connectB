// NEXT_STEPS Phase 4 — investor portal data, real per-org grants.
// Service-role only: investors are never org_members, so RLS can't grant
// them table access (same pattern documented in 0001_init.sql). This route
// validates access_grants by email and mints short-lived signed URLs for
// Storage-backed documents; external links pass through as-is.
//
// SECURITY FIX (audited 2026-07-27): this route used to trust an `email`
// query param with NO identity check — anyone who knew (or guessed) a
// grantee's email could call this directly and get back real signed
// download URLs, no session required. The email now comes ONLY from the
// caller's own Supabase session (verified server-side via the request's
// cookies) — never from client input. No session → 401, full stop.
//
// Data Room V2 (F5) fix: an nda_required grant that isn't yet accepted used
// to still have its document/folder included in this response (with a real
// signed URL already minted) — only the CLIENT hid the whole page behind a
// blanket "accept the NDA" gate, so the actual content was already sitting
// in the network response before that click. unlockedGrants() now filters
// those out here, server-side, before anything is even fetched — a locked
// item never reaches this response at all, and the client just shows a
// count of how many are still pending.
//
// Prompt 48 — @ablute.pt QA bypass, so the team can see the Investor
// Workspace working today without waiting on the real request→approval
// flow (Prompt 41). Deliberately a FALLBACK, checked only when the normal
// access_grants lookup finds nothing: a real grant for this email (however
// that ever comes to exist) always wins, this path never overrides it. No
// access_grants rows are fabricated — this reads folders/documents directly
// for the @ablute.pt user's own org, entirely parallel to the grants table.
// Read-only by construction (this route has no write path at all); the
// response is flagged `qaAccess: true` so the client can label it and so it
// stays structurally distinct from a real investor's session — nothing
// here writes a document_views row either (see /api/portal/view), so it
// can never surface as investor activity on any founder-facing dashboard.
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resolveDocumentAccess, unlockedGrants } from '@/lib/data-room';
import { grantIsActive, grantStatus } from '@/lib/access-grants';
import { PORTAL_SECTIONS } from '@/lib/dataroom-sections';
import { roundValuationBasisAvailable } from '@/lib/round-valuation-basis-capability';

// Investor Workspace Fase 2 (prompt 55) — groups documents into the 6 fixed
// diligence-journey sections by their folder's portal_section (migration
// 0058). A folder with no portal_section (a container shell, or simply not
// mapped yet) contributes nothing here — its documents don't appear in the
// portal at all, per the prompt. Every section is always present in the
// response, even empty, so the client can render "In preparation" instead
// of just omitting it.
function buildSections(
  folders: { id: string; portal_section: string | null }[],
  documents: { id: unknown; folder_id: unknown }[],
) {
  const sectionByFolderId = new Map(folders.map((f) => [f.id, f.portal_section]));
  return PORTAL_SECTIONS.map((s) => ({
    key: s.key, label: s.label,
    documents: documents.filter((d) => sectionByFolderId.get(d.folder_id as string) === s.key),
  }));
}

// Prompt 54 Bloco 1 — Zona 1 snapshot card data. Reads the same orgs
// columns the founder-side Company tab (RoundCard.tsx) already writes —
// no parallel data source, no fabricated values: a field that's genuinely
// unset comes back null/undefined and the client renders "not shared yet",
// never a zero.
async function buildSnapshot(admin: SupabaseClient, orgId: string) {
  // Prompt 115 Block E — round_valuation_basis only added to the select
  // once the propose-only migration (0111) has landed; the whole row is
  // spread into the response below, so this is the only change this route
  // needs once that lands. Two literal select strings (not one built from a
  // runtime-conditional string) so supabase-js's column-name type inference
  // still works in both branches.
  const basisAvailable = await roundValuationBasisAvailable();
  const [{ data: org }, { data: metrics }, { data: confirmedCommits }] = await Promise.all([
    basisAvailable
      ? admin.from('orgs').select(
          'name, one_liner, description, stage, stage_other, sectors, hq_city, country, '
          + 'round_raising, round_target_eur, round_secured_eur, round_min_ticket_eur, round_instruments, '
          + 'round_instrument_other, round_valuation_eur, round_valuation_basis, round_runway_months, round_runway_post_months, '
          + 'round_target_close_date, round_use_of_funds, round_flexible',
        ).eq('id', orgId).single()
      : admin.from('orgs').select(
          'name, one_liner, description, stage, stage_other, sectors, hq_city, country, '
          + 'round_raising, round_target_eur, round_secured_eur, round_min_ticket_eur, round_instruments, '
          + 'round_instrument_other, round_valuation_eur, round_runway_months, round_runway_post_months, '
          + 'round_target_close_date, round_use_of_funds, round_flexible',
        ).eq('id', orgId).single(),
    admin.from('org_traction_metrics').select('id, label, value').eq('org_id', orgId).order('sort_order', { ascending: true }),
    // Prompt 56 Bloco 3 — confirmed soft commits ADD ON TOP of the
    // founder's manually-entered round_secured_eur, never overwrite it:
    // securedShown is a computed overlay so re-running this never
    // double-counts and the founder's own figure stays exactly what they
    // typed.
    admin.from('investor_soft_commits').select('amount_eur').eq('org_id', orgId).eq('confirmed_by_founder', true),
  ]);
  if (!org) return null;
  const orgRecord = org as unknown as Record<string, unknown>;
  const softCommittedEur = (confirmedCommits ?? []).reduce((sum, c) => sum + Number(c.amount_eur), 0);
  const securedShown = ((orgRecord.round_secured_eur as number | null) ?? 0) + softCommittedEur;
  return { ...orgRecord, tractionMetrics: metrics ?? [], softCommittedEur, securedShown };
}

// Prompt 54 Bloco 2 — the investor's own most recent ticket signal, so the
// selector opens pre-selected on reload instead of always starting blank.
// "Current" = latest row, never an UPDATE (see migration 0055).
async function latestTicketSignal(admin: SupabaseClient, orgId: string, email: string) {
  const { data } = await admin.from('investor_ticket_signals').select('range_label, range_min_eur, range_max_eur')
    .eq('org_id', orgId).eq('investor_email', email).order('created_at', { ascending: false }).limit(1).maybeSingle();
  return data ?? null;
}

async function toPortalDoc(admin: SupabaseClient, d: Record<string, unknown>) {
  let signedUrl: string | null = (d.external_url as string | null) ?? null;
  if (!signedUrl && d.storage_path) {
    const { data: signed } = await admin.storage.from('data-room').createSignedUrl(d.storage_path as string, 300);
    signedUrl = signed?.signedUrl ?? null;
  }
  return {
    id: d.id, name: d.name, version: d.version, watermark: d.watermark,
    downloadable: d.downloadable, folder_id: d.folder_id, url: signedUrl,
  };
}

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: 'not configured' }, { status: 200 });

  // Prompt 121 §2.3 — Pipeline cards now route to their OWN startup, not a
  // single fixed org. requestedOrgId is only ever used to pick among orgs
  // the caller's own activeGrants already cover below — never a bypass:
  // an id for an org this investor has no grant for simply finds nothing in
  // that filter and falls back to the pre-existing "first match" behavior,
  // exactly as if the param had been omitted.
  const requestedOrgId = new URL(req.url).searchParams.get('orgId');

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!email) return NextResponse.json({ error: 'not signed in' }, { status: 401 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: person } = await admin.from('people').select('id').eq('email_verified', email).maybeSingle();

  // invited_email must be its own match arm, not folded into the person_id
  // lookup above: a founder-invited person (Prompt 47) only ever gets
  // email_guess, never email_verified, until they self-confirm — so without
  // this the grant that's supposed to trigger the "Is this you?" screen is
  // invisible to this route and never reaches pendingConfirmation below.
  const orParts = [`grantee_email.eq.${email}`, `invited_email.eq.${email}`];
  if (person) orParts.push(`person_id.eq.${person.id}`);
  const { data: grants, error: grantsErr } = await admin.from('access_grants').select('*')
    .is('revoked_at', null).or(orParts.join(','));
  if (grantsErr) return NextResponse.json({ error: grantsErr.message }, { status: 500 });

  // prompt 33 part 2 (decision 2026-07-29): a pending_confirmation grant
  // (invited_email set, confirmed_at still null — see migration 0045 /
  // access-grants.ts) must never reach this response, same as a revoked or
  // expired one. Forward-compatible before the migration even runs: until
  // invited_email/confirmed_at exist, they're simply undefined on every row
  // here, which grantIsActive treats exactly like null — every grant
  // created before this column existed stays active, nothing changes for
  // today's grants.
  const now = new Date();
  const activeGrants = (grants ?? []).filter((g) => grantIsActive(g as any, now));

  // Prompt 47 — surfaced to the portal page so it can show the "Is this
  // you?" screen BEFORE anything else, even though this response's own
  // documents/folders below already exclude these grants entirely (nothing
  // here leaks past the id/invited_name/org name needed to render the
  // confirm screen — never a folder id, document id, or signed URL).
  const pendingGrants = (grants ?? []).filter((g) => grantStatus(g as any, now) === 'pending_confirmation');
  let pendingConfirmation: { grantId: string; invitedName: string | null; orgName: string | null }[] = [];
  if (pendingGrants.length) {
    const orgIds = [...new Set(pendingGrants.map((g) => g.org_id as string))];
    const { data: pendingOrgs } = await admin.from('orgs').select('id, name').in('id', orgIds);
    const orgNameById = new Map((pendingOrgs ?? []).map((o) => [o.id as string, o.name as string]));
    pendingConfirmation = pendingGrants.map((g) => ({
      grantId: g.id as string, invitedName: (g.invited_name as string | null) ?? null,
      orgName: orgNameById.get(g.org_id as string) ?? null,
    }));
  }

  if (activeGrants.length === 0) {
    // QA fallback only when there is genuinely nothing real to show —
    // .rpc runs on the session-scoped client (`sb`), not `admin`, because
    // is_ablute_developer() reads auth.uid() and a service-role call has no
    // user context to check. If this fails/returns false, falls through to
    // the existing empty response unchanged.
    const { data: isAbluteQa } = await sb.rpc('is_ablute_developer');
    if (isAbluteQa) {
      const { data: membership } = await admin.from('org_members').select('org_id').eq('user_id', user!.id).limit(1).maybeSingle();
      if (membership) {
        const orgId = membership.org_id as string;
        const { data: org } = await admin.from('orgs').select('name, sender_email').eq('id', orgId).single();
        const [{ data: allFolders }, { data: allDocs }] = await Promise.all([
          admin.from('folders').select('id, name, portal_section').eq('org_id', orgId),
          admin.from('documents').select('*').eq('org_id', orgId),
        ]);
        const documents = await Promise.all((allDocs ?? []).map((d) => toPortalDoc(admin, d)));
        const snapshot = await buildSnapshot(admin, orgId);
        const sections = buildSections(allFolders ?? [], documents);
        return NextResponse.json({
          orgName: org?.name ?? null, senderEmail: org?.sender_email ?? null,
          pendingNdaCount: 0, folders: allFolders ?? [], documents, sections,
          pendingConfirmation, qaAccess: true, snapshot, orgId,
          // Never populated for QA — the write route itself refuses to
          // insert for is_ablute_developer() sessions (see
          // /api/portal/ticket-signal), so there is nothing real to read
          // back here either.
          currentTicketSignal: null,
        });
      }
    }
    return NextResponse.json({ orgName: null, pendingNdaCount: 0, folders: [], documents: [], pendingConfirmation });
  }

  // Prompt 121 §2.3 — one org's grants at a time, but now CHOSEN (by
  // requestedOrgId, itself only ever set from a Pipeline card the caller's
  // own session already resolved as eligible) rather than always "the
  // first match". Still exactly one org's data room per response — a
  // single login surfacing several data rooms AT ONCE needs a real
  // investor identity model (IRM_SPEC §5, self-claim), not this pass.
  const requestedGrant = requestedOrgId ? activeGrants.find((g) => g.org_id === requestedOrgId) : null;
  const orgId = requestedGrant ? requestedGrant.org_id : activeGrants[0].org_id;
  const orgGrants = activeGrants.filter((g) => g.org_id === orgId);

  const { data: org } = await admin.from('orgs').select('name, sender_email').eq('id', orgId).single();

  // Fetch documents for EVERY granted folder (locked or not) and every
  // directly-granted document (locked or not) — resolveDocumentAccess needs
  // the full candidate set to correctly apply "the document's own grant
  // overrides its folder's grant," in either direction (a doc can be
  // unlocked inside a locked folder, or locked inside an unlocked one).
  const allFolderIds = orgGrants.filter((g) => g.folder_id).map((g) => g.folder_id as string);
  const allDirectDocIds = orgGrants.filter((g) => g.document_id).map((g) => g.document_id as string);

  const [{ data: docsInFolders }, { data: directDocs }] = await Promise.all([
    allFolderIds.length ? admin.from('documents').select('*').in('folder_id', allFolderIds) : Promise.resolve({ data: [] }),
    allDirectDocIds.length ? admin.from('documents').select('*').in('id', allDirectDocIds) : Promise.resolve({ data: [] }),
  ]);

  const docMap = new Map<string, Record<string, unknown>>();
  for (const d of [...(docsInFolders ?? []), ...(directDocs ?? [])]) docMap.set(d.id as string, d);
  const candidateDocs = [...docMap.values()];

  const { visibleIds, pendingCount: docPendingCount } = resolveDocumentAccess(
    orgGrants,
    candidateDocs.map((d) => ({ id: d.id as string, folder_id: (d.folder_id as string | undefined) ?? undefined })),
  );

  // Folders themselves (the "Folder access" summary cards) have no
  // equivalent per-item override — a plain unlocked check is correct here.
  const folderGrants = orgGrants.filter((g) => g.folder_id);
  const unlockedFolderGrants = unlockedGrants(folderGrants);
  const folderPendingCount = folderGrants.length - unlockedFolderGrants.length;
  const folderIds = unlockedFolderGrants.map((g) => g.folder_id as string);
  const { data: folders } = folderIds.length
    ? await admin.from('folders').select('id, name, portal_section').in('id', folderIds)
    : { data: [] };

  const visibleDocs = candidateDocs.filter((d) => visibleIds.includes(d.id as string));
  const documents = await Promise.all(visibleDocs.map((d) => toPortalDoc(admin, d)));
  const snapshot = await buildSnapshot(admin, orgId);
  const currentTicketSignal = await latestTicketSignal(admin, orgId, email);
  const sections = buildSections(folders ?? [], documents);

  return NextResponse.json({
    orgName: org?.name ?? null, senderEmail: org?.sender_email ?? null,
    pendingNdaCount: folderPendingCount + docPendingCount, folders: folders ?? [], documents, sections,
    pendingConfirmation, snapshot, orgId, currentTicketSignal,
  });
}

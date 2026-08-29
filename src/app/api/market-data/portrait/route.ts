// Prompt 378 §D — "one click, one portrait — not six empty cards."
//
// On a first visit the Market data tab had six blank cards and no obvious
// first move; the rings that DID exist were content-free templates. This
// route is the cold start: it runs the EXISTING document-extract pass (370)
// over the founder's market-looking documents, then proposes rings from the
// sizing facts that pass produced and competitor cards from its
// Competitive_Landscape findings (§C) — one flow, everything as proposals
// to review, nothing written as accepted.
//
// Deliberately a THIN ORCHESTRATOR: it calls the same two routes the
// founder can already trigger by hand rather than re-implementing either.
// That matters for correctness — document-extract owns the scan gate, the
// per-document provenance and the cache-by-content-hash, and the rings
// route owns proposal/accept semantics — and it means the cold start can
// never drift from what the individual buttons do.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { orgCompetitorsAvailable, orgMarketRingsAvailable } from '@/lib/market-data-capability';
import { pickPortraitDocuments, MAX_PORTRAIT_DOCS } from '@/lib/market-portrait';

// Prompt 458 §A.3 — a genuine platform timeout (Vercel killed document-
// extract mid-flight) looks nothing like one of ITS OWN failures: every
// return path in that route is a real NextResponse.json(...), so a thrown
// fetch or a non-JSON body can only mean the platform cut it off, never an
// application-level reason. Retrying the exact same document selection
// just times out again — the honest fix is fewer documents, via the same
// explicit documentIds this route already accepts.
const DOCUMENT_TIMEOUT_MESSAGE = 'Reading your documents took too long to finish on the server — pick a smaller, '
  + 'specific set with "Read my documents" below instead of repeating this exact selection (it will hit the same limit again).';

// The extraction pass this calls is itself maxDuration=60; this wrapper
// adds the rings/competitor proposal work on top, so it needs its own
// generous budget for the same Vercel reason as Prompt 378 §0.
export const maxDuration = 60;

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });
  const orgId = member.org_id as string;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Which documents to read: the founder's explicit pick if they made one,
  // otherwise the same name/folder heuristic the "Read my documents" picker
  // already pre-selects with — never a silent full-Vault sweep (cost).
  const body = await req.json().catch(() => ({})) as { documentIds?: string[] };
  // Prompt 458 §A.2 — the same ceiling applies whether the founder picked
  // documents explicitly or we fall back to the auto-pick heuristic below
  // (which already respects it internally) — one constant, not a second
  // independently-defined cap drifting out of sync with it.
  let documentIds = [...new Set(body.documentIds ?? [])].slice(0, MAX_PORTRAIT_DOCS);
  if (documentIds.length === 0) {
    const [{ data: docRows }, { data: folderRows }] = await Promise.all([
      admin.from('documents').select('id, name, folder_id').eq('org_id', orgId),
      admin.from('folders').select('id, name').eq('org_id', orgId),
    ]);
    const folderNameById = new Map(((folderRows ?? []) as { id: string; name: string }[]).map((f) => [f.id, f.name]));
    documentIds = pickPortraitDocuments(((docRows ?? []) as { id: string; name: string; folder_id: string | null }[])
      .map((d) => ({ id: d.id, name: d.name, folderName: d.folder_id ? folderNameById.get(d.folder_id) ?? '' : '' })));
  }
  if (documentIds.length === 0) {
    return NextResponse.json({
      ok: false, noDocuments: true,
      error: 'No market-looking documents in your Vault yet — upload a market sizing sheet, a competitive landscape or a pitch deck, then build the portrait.',
    });
  }

  // Step 1 — read the documents (the existing 370 pass, cookie forwarded so
  // it runs as this same founder and re-checks every gate itself).
  const cookie = req.headers.get('cookie') ?? '';
  const origin = new URL(req.url).origin;
  let extractBody: { ok?: boolean; error?: string; costEur?: number; items?: unknown[]; documentsRead?: number; cached?: boolean };
  try {
    const res = await fetch(`${origin}/api/market-data/document-extract`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ documentIds }),
    });
    let unreadable = false;
    extractBody = await res.json().catch(() => { unreadable = true; return { ok: false }; });
    if (unreadable) return NextResponse.json({ ok: false, error: DOCUMENT_TIMEOUT_MESSAGE });
  } catch {
    return NextResponse.json({ ok: false, error: DOCUMENT_TIMEOUT_MESSAGE });
  }
  if (!extractBody.ok) {
    return NextResponse.json({ ok: false, error: extractBody.error ?? 'Could not read your documents — try again.' });
  }

  // Step 2 (rings) and step 3 (§C, competitor count) — Prompt 458 §A.1:
  // neither depends on the other, only both on step 1 above, so they run
  // in parallel instead of adding their own latency serially on top of it.
  const [{ ringsProposed, ringsNote }, competitorsProposed] = await Promise.all([
    (async (): Promise<{ ringsProposed: number; ringsNote: string | null }> => {
      // Propose rings from whatever sizing facts that pass produced. A
      // `needsPortrait` answer here means the documents genuinely contained
      // no sizing figure: honest, and distinct from "the button did nothing".
      if (!(await orgMarketRingsAvailable())) return { ringsProposed: 0, ringsNote: null };
      try {
        const res = await fetch(`${origin}/api/market-data/rings`, {
          method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ action: 'propose' }),
        });
        const ringsBody = await res.json().catch(() => ({}));
        if (ringsBody.ok) return { ringsProposed: (ringsBody.rings ?? []).length, ringsNote: null };
        return { ringsProposed: 0, ringsNote: 'No market size figure found in those documents — the rings stay empty rather than showing an invented number.' };
      } catch {
        return { ringsProposed: 0, ringsNote: 'Rings could not be proposed just now — your documents were still read successfully.' };
      }
    })(),
    (async (): Promise<number> => {
      // Competitor proposals already exist as pending market_research_items
      // rows in the 'players' section from step 1; the Competitors card
      // renders them as one-click "Add" cards. Counted here so the founder
      // sees what the single click actually produced.
      if (!(await orgCompetitorsAvailable())) return 0;
      const { count } = await admin.from('market_research_items')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId).eq('section', 'players').eq('status', 'pending');
      return count ?? 0;
    })(),
  ]);

  return NextResponse.json({
    ok: true,
    documentsRead: extractBody.documentsRead ?? 0,
    costEur: extractBody.costEur ?? 0,
    cached: !!extractBody.cached,
    ringsProposed, ringsNote, competitorsProposed,
  });
}

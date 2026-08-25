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
import { pickPortraitDocuments } from '@/lib/market-portrait';

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
  let documentIds = [...new Set(body.documentIds ?? [])];
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
    extractBody = await res.json().catch(() => ({ ok: false, error: 'The document pass returned an unreadable response.' }));
  } catch (e) {
    return NextResponse.json({ ok: false, error: `Could not read your documents: ${(e as Error).message}` });
  }
  if (!extractBody.ok) {
    return NextResponse.json({ ok: false, error: extractBody.error ?? 'Could not read your documents — try again.' });
  }

  // Step 2 — propose rings from whatever sizing facts that pass produced.
  // A `needsPortrait` answer here means the documents genuinely contained no
  // sizing figure: honest, and distinct from "the button did nothing".
  let ringsProposed = 0;
  let ringsNote: string | null = null;
  if (await orgMarketRingsAvailable()) {
    try {
      const res = await fetch(`${origin}/api/market-data/rings`, {
        method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ action: 'propose' }),
      });
      const ringsBody = await res.json().catch(() => ({}));
      if (ringsBody.ok) ringsProposed = (ringsBody.rings ?? []).length;
      else ringsNote = 'No market size figure found in those documents — the rings stay empty rather than showing an invented number.';
    } catch {
      ringsNote = 'Rings could not be proposed just now — your documents were still read successfully.';
    }
  }

  // Step 3 (§C) — competitor proposals already exist as pending
  // market_research_items rows in the 'players' section from step 1; the
  // Competitors card renders them as one-click "Add" cards. Counted here so
  // the founder sees what the single click actually produced.
  let competitorsProposed = 0;
  if (await orgCompetitorsAvailable()) {
    const { count } = await admin.from('market_research_items')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId).eq('section', 'players').eq('status', 'pending');
    competitorsProposed = count ?? 0;
  }

  return NextResponse.json({
    ok: true,
    documentsRead: extractBody.documentsRead ?? 0,
    costEur: extractBody.costEur ?? 0,
    cached: !!extractBody.cached,
    ringsProposed, ringsNote, competitorsProposed,
  });
}

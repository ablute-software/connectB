// Prompt 373 §A — the market in layers. GET returns the org's up-to-3
// rings; POST both proposes (from already-sourced knowledge, mechanical —
// see market-rings.ts's own header) and lets the founder accept/edit/reject
// each one. "Editing IS accepting", same discipline as company_claims'
// claim route — a founder who corrects a proposed ring has just reviewed
// and confirmed it.
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { orgMarketRingsAvailable } from '@/lib/market-data-capability';
import { proposeMarketRings, hasAnyKnowledge, vaultCitation, parseVaultCitation, RING_ORDER, type RingKey, type SizingFact } from '@/lib/market-rings';

async function resolveOrg(sb: Awaited<ReturnType<typeof serverClient>>, userId: string) {
  const { data } = await sb.from('org_members').select('org_id').eq('user_id', userId).maybeSingle();
  return (data?.org_id as string | undefined) ?? null;
}

// Prompt 373 §A — "comes from the already-extracted documents + org
// profile", never a fresh web call.
//
// Prompt 378 §B — this is where 373 broke its own promise. The old query
// ended in `.not('source_url', 'is', null)`, and a DOCUMENT-sourced item
// (the whole output of the "Read my documents" pass) has source_url NULL by
// construction — its provenance lives in document_id/page instead. So every
// fact the founder had already PAID to extract was filtered out here, and
// all three rings showed "No sourced number" no matter what was in the
// Vault. Now both provenances are accepted, and a document-sourced fact
// carries an internal `doc:<id>#p<page>` citation (vaultCitation) rather
// than a fabricated URL.
//
// It also stopped regex-scraping the amount out of the title: the
// extraction pass already stored the exact {valueEur, currency, scope,
// year} in `structured` (market-document-extract.ts) — reading the parsed
// value is both correct and immune to title-format drift. The regex path
// is kept ONLY for web-sourced items, which have no structured field.
async function readSizingFacts(admin: SupabaseClient, orgId: string): Promise<SizingFact[]> {
  const [{ data: addedByYou }, { data: sizingItems }] = await Promise.all([
    admin.from('org_market_data').select('market_size_value_eur, market_size_scope, market_size_year, market_size_source').eq('org_id', orgId).maybeSingle(),
    admin.from('market_research_items')
      .select('title, detail, source_url, source_kind, document_id, page, structured, documents(name)')
      .eq('org_id', orgId).eq('section', 'sizing'),
  ]);
  const facts: SizingFact[] = [];
  const added = addedByYou as { market_size_value_eur: number | null; market_size_scope: string | null; market_size_year: number | null; market_size_source: string | null } | null;
  if (added?.market_size_value_eur != null && added.market_size_scope) {
    facts.push({
      scopeLabel: added.market_size_scope, valueEur: added.market_size_value_eur, year: added.market_size_year,
      sourceUrl: added.market_size_source ?? null, method: 'report',
    });
  }

  for (const raw of (sizingItems ?? []) as Record<string, unknown>[]) {
    const structured = (raw.structured ?? null) as { valueEur?: number | null; scope?: string; year?: number | null } | null;
    const documentId = raw.document_id as string | null;
    const page = (raw.page as number | null) ?? null;
    const documentName = (raw.documents as { name?: string } | null)?.name ?? null;

    // Document-sourced: exact values already parsed at extraction time.
    if (documentId && structured?.valueEur != null && structured.scope) {
      facts.push({
        scopeLabel: structured.scope, valueEur: structured.valueEur, year: structured.year ?? null,
        sourceUrl: vaultCitation(documentId, page), sourceDocumentName: documentName,
        // A figure written in the founder's own market-sizing document is a
        // report-style figure unless they say otherwise; they can correct
        // the method on the ring itself (Accept/Edit).
        method: 'report',
      });
      continue;
    }

    // Web-sourced: no structured field, and a real external URL is
    // mandatory (unchanged from 373 — never a sourceless number).
    const sourceUrl = raw.source_url as string | null;
    if (!sourceUrl) continue;
    const text = (raw.detail as string | null) ?? (raw.title as string);
    const amountMatch = text.match(/[€$£]\s?([\d.,]+)\s*(b|bn|billion|m|million|k)?/i);
    if (!amountMatch) continue;
    let value = parseFloat(amountMatch[1].replace(/,/g, ''));
    const unit = (amountMatch[2] ?? '').toLowerCase();
    if (unit.startsWith('b')) value *= 1_000_000_000;
    else if (unit === 'm' || unit === 'million') value *= 1_000_000;
    else if (unit === 'k') value *= 1_000;
    facts.push({ scopeLabel: raw.title as string, valueEur: value, year: null, sourceUrl, method: 'report' });
  }
  return facts;
}

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ available: false, rings: [] });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  if (!(await orgMarketRingsAvailable())) return NextResponse.json({ available: false, rings: [] });

  const orgId = await resolveOrg(sb, user.id);
  if (!orgId) return NextResponse.json({ available: false, rings: [] });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: rings } = await admin.from('org_market_rings').select('*').eq('org_id', orgId);

  // Prompt 378 §B.2 — resolve `doc:<uuid>#p<n>` citations to a real document
  // NAME here, server-side: the card must be able to say "from your
  // Market_Sizing, p. 4" rather than rendering a raw uuid at the founder.
  const rows = (rings ?? []) as Record<string, unknown>[];
  const docIds = rows
    .map((r) => parseVaultCitation(r.size_source_url as string | null)?.documentId)
    .filter((id): id is string => !!id);
  let nameById = new Map<string, string>();
  if (docIds.length > 0) {
    const { data: docs } = await admin.from('documents').select('id, name').in('id', [...new Set(docIds)]);
    nameById = new Map(((docs ?? []) as { id: string; name: string }[]).map((d) => [d.id, d.name]));
  }

  return NextResponse.json({
    available: true,
    rings: rows.map((r) => {
      const citation = parseVaultCitation(r.size_source_url as string | null);
      return { ...r, source_document_name: citation ? nameById.get(citation.documentId) ?? null : null };
    }),
  });
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  if (!(await orgMarketRingsAvailable())) return NextResponse.json({ ok: false, error: 'not configured' });

  const orgId = await resolveOrg(sb, user.id);
  if (!orgId) return NextResponse.json({ ok: false, error: 'No organization.' }, { status: 403 });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const body = await req.json().catch(() => ({})) as {
    action?: 'propose' | 'accept' | 'edit' | 'reject'; ring?: RingKey;
    label?: string; definition?: string; buyer?: string; geography?: string;
    sizeValueEur?: number | null; sizeYear?: number | null; sizeMethod?: string | null; sizeSourceUrl?: string | null;
    growthPct?: number | null; growthPeriod?: string | null; expansionCondition?: string;
  };

  if (body.action === 'propose') {
    const { data: org } = await admin.from('orgs').select('sectors, sectors_other, stage, country, one_liner').eq('id', orgId).maybeSingle();
    const orgRow = (org ?? {}) as { sectors: string[] | null; sectors_other: string | null; stage: string | null; country: string | null; one_liner: string | null };
    const sectors = [...(orgRow.sectors ?? []), orgRow.sectors_other?.trim()].filter(Boolean) as string[];
    const sizingFacts = await readSizingFacts(admin, orgId);
    const input = { sectors, stage: orgRow.stage, country: orgRow.country, oneLiner: orgRow.one_liner, sizingFacts };

    // Prompt 378 §B.3 — with nothing read from the Vault and nothing
    // accepted from research, proposing would emit three content-free
    // template rings ("No sourced number" ×3) — which is exactly what the
    // founder saw. Refuse, and say which step is missing instead.
    if (!hasAnyKnowledge(input)) {
      return NextResponse.json({
        ok: false, needsPortrait: true,
        error: 'I haven\'t read your market documents yet — build your market portrait first, then I can propose rings from what\'s actually in them.',
      });
    }

    const proposals = proposeMarketRings(input);

    // Never overwrite a ring the founder already accepted/edited — a
    // "propose" click only fills in rings that don't exist yet or are
    // still sitting at 'proposed' untouched.
    const { data: existingRings } = await admin.from('org_market_rings').select('ring, status').eq('org_id', orgId);
    const existingByRing = new Map(((existingRings ?? []) as { ring: RingKey; status: string }[]).map((r) => [r.ring, r.status]));

    for (const p of proposals) {
      if (existingByRing.get(p.ring) === 'accepted') continue;
      await admin.from('org_market_rings').upsert({
        org_id: orgId, ring: p.ring, label: p.label, definition: p.definition, buyer: p.buyer, geography: p.geography,
        size_value_eur: p.sizeValueEur, size_year: p.sizeYear, size_method: p.sizeMethod, size_source_url: p.sizeSourceUrl,
        expansion_condition: p.expansionCondition, origin: 'ai_proposed', status: 'proposed', updated_at: new Date().toISOString(),
      }, { onConflict: 'org_id,ring' });
    }
    const { data: rings } = await admin.from('org_market_rings').select('*').eq('org_id', orgId);
    return NextResponse.json({ ok: true, rings: rings ?? [] });
  }

  if (!body.ring || !RING_ORDER.includes(body.ring)) {
    return NextResponse.json({ ok: false, error: 'A valid ring is required.' }, { status: 400 });
  }

  if (body.action === 'reject') {
    await admin.from('org_market_rings').delete().eq('org_id', orgId).eq('ring', body.ring);
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'accept' || body.action === 'edit') {
    const now = new Date().toISOString();
    const { data: existing } = await admin.from('org_market_rings').select('label, definition').eq('org_id', orgId).eq('ring', body.ring).maybeSingle();
    const patch: Record<string, unknown> = {
      org_id: orgId, ring: body.ring, status: 'accepted', origin: existing ? undefined : 'founder', updated_at: now,
      label: body.label ?? existing?.label ?? body.ring, definition: body.definition ?? existing?.definition ?? null,
    };
    if (body.buyer !== undefined) patch.buyer = body.buyer;
    if (body.geography !== undefined) patch.geography = body.geography;
    if (body.sizeValueEur !== undefined) patch.size_value_eur = body.sizeValueEur;
    if (body.sizeYear !== undefined) patch.size_year = body.sizeYear;
    if (body.sizeMethod !== undefined) patch.size_method = body.sizeMethod;
    if (body.sizeSourceUrl !== undefined) patch.size_source_url = body.sizeSourceUrl;
    if (body.growthPct !== undefined) patch.growth_pct = body.growthPct;
    if (body.growthPeriod !== undefined) patch.growth_period = body.growthPeriod;
    if (body.expansionCondition !== undefined) patch.expansion_condition = body.expansionCondition;
    if (patch.origin === undefined) delete patch.origin;
    const { error } = await admin.from('org_market_rings').upsert(patch, { onConflict: 'org_id,ring' });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
}

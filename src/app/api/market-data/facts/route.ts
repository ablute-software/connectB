// Prompt 467 §D — founder-facing surfacing for typed market_facts.
// verification_status decides what is presented as actionable Market
// Intelligence, never validation_status ("well-formed" ≠ "true") — see
// market-facts-view.ts's factZone for the precedence this route relies on.
// Three plain, separate queries (facts → observations → evidence) rather
// than a multi-level PostgREST embed, joined in JS — same pattern this
// codebase already uses elsewhere (e.g. MarketDataPanel.tsx's own
// folderNameById), safer to reason about than a 3-level nested embed.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { marketFactsAvailable } from '@/lib/market-data-capability';
import { factZone, type FactView, type FactPayload, type FactValidationView } from '@/lib/market-facts-view';

interface FactRow {
  id: string; fact_type: 'growth' | 'market_size'; payload: unknown;
  validation_status: 'valid' | 'incomplete' | 'invalid'; validation: unknown;
  verification_status: 'founder_reported' | 'externally_sourced' | 'corroborated';
}
interface EvidenceRow {
  id: string; document_id: string | null; page: number | null; quote: string | null; source_url: string | null;
  origin: string; source_kind: string; retrieval_method: string; documents: { name: string } | null;
}

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  if (!(await marketFactsAvailable())) return NextResponse.json({ ok: true, available: false, facts: [] });

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });
  const orgId = member.org_id as string;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: factRows } = await admin.from('market_facts')
    .select('id, fact_type, payload, validation_status, validation, verification_status')
    .eq('org_id', orgId).order('created_at', { ascending: false });
  const facts = (factRows ?? []) as FactRow[];
  if (facts.length === 0) return NextResponse.json({ ok: true, available: true, facts: [] });

  const factIds = facts.map((f) => f.id);
  const { data: obsRows } = await admin.from('market_fact_observations')
    .select('market_fact_id, evidence_id').eq('org_id', orgId).in('market_fact_id', factIds);
  const evidenceIdsByFactId = new Map<string, Set<string>>();
  for (const o of (obsRows ?? []) as { market_fact_id: string; evidence_id: string }[]) {
    const set = evidenceIdsByFactId.get(o.market_fact_id) ?? new Set<string>();
    set.add(o.evidence_id);
    evidenceIdsByFactId.set(o.market_fact_id, set);
  }

  const evidenceIds = [...new Set([...evidenceIdsByFactId.values()].flatMap((s) => [...s]))];
  const { data: evidenceRows } = evidenceIds.length > 0
    ? await admin.from('market_evidence')
      .select('id, document_id, page, quote, source_url, origin, source_kind, retrieval_method, documents(name)')
      .eq('org_id', orgId).in('id', evidenceIds)
    : { data: [] as EvidenceRow[] };
  const evidenceById = new Map(((evidenceRows ?? []) as unknown as EvidenceRow[]).map((e) => [e.id, e]));

  const views = facts.map((f) => {
    const evidence = [...(evidenceIdsByFactId.get(f.id) ?? [])]
      .map((eid) => evidenceById.get(eid))
      .filter((e): e is EvidenceRow => !!e)
      .map((e) => ({
        documentName: e.documents?.name ?? null, page: e.page, quote: e.quote, sourceUrl: e.source_url,
        origin: e.origin, sourceKind: e.source_kind, retrievalMethod: e.retrieval_method,
      }));
    const view: FactView = {
      id: f.id, factType: f.fact_type, payload: f.payload as FactPayload,
      validationStatus: f.validation_status, validation: f.validation as FactValidationView,
      verificationStatus: f.verification_status, evidence,
    };
    return { ...view, zone: factZone(view) };
  });

  return NextResponse.json({ ok: true, available: true, facts: views });
}

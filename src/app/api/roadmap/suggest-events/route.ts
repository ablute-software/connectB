// Prompt 359 Block D — "Suggest events": reuses Prompt 358's reconciliation
// pattern (Watson, server-side, own cost-log purpose, cached by a knowledge
// signature) to propose complete roadmap events — lane + date + title +
// evidence — from exactly what the app already knows, so a founder can
// build a rich roadmap in ten clicks without writing a line.
//
// Root privacy rule — verified before writing this: every source read here
// (org profile, document extractions, badges, funding rounds, accepted
// claims) is on company-knowledge.ts's own closed, founder-authored list.
// Nothing about platform performance, outreach, or pipeline enters this
// prompt.
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import { serverClient } from '@/lib/supabase-server';
import { roadmapEventSuggestionsAvailable, roadmapEventsAvailable, documentExtractionsAvailable } from '@/lib/document-extraction-capability';
import { DOCUMENT_CONTENT_INSTRUCTION, wrapDocumentContent } from '@/lib/prompt-injection-defense';
import { logAiCall, computeCostEur } from '@/lib/ai-cost-log';
import { providerErrorMessage } from '@/lib/ai-provider-error';

async function resolveOrg(sb: Awaited<ReturnType<typeof serverClient>>, userId: string) {
  const { data } = await sb.from('org_members').select('org_id').eq('user_id', userId).maybeSingle();
  return (data?.org_id as string | undefined) ?? null;
}

interface KnowledgeItem { kind: string; text: string; documentId?: string | null }

async function buildKnowledge(admin: SupabaseClient, orgId: string): Promise<{ items: KnowledgeItem[]; signature: string }> {
  const [{ data: org }, { data: badges }, { data: rounds }, extractionsAvail] = await Promise.all([
    admin.from('orgs').select('founded_year, one_liner, round_target_eur, round_target_close_date').eq('id', orgId).maybeSingle(),
    admin.from('company_badges').select('id, name, year, evidence_document_id, verification_status').eq('org_id', orgId),
    admin.from('funding_rounds').select('id, label, amount_eur, closed_year, investor_name').eq('org_id', orgId),
    documentExtractionsAvailable(),
  ]);

  const items: KnowledgeItem[] = [];
  const sigParts: string[] = [];

  const orgRow = org as { founded_year: number | null; one_liner: string | null; round_target_eur: number | null; round_target_close_date: string | null } | null;
  if (orgRow?.founded_year) { items.push({ kind: 'profile', text: `Company founded in ${orgRow.founded_year}.` }); sigParts.push(`founded:${orgRow.founded_year}`); }
  if (orgRow?.round_target_close_date) { items.push({ kind: 'profile', text: `Target round close date: ${orgRow.round_target_close_date}.` }); sigParts.push(`close:${orgRow.round_target_close_date}`); }

  for (const b of (badges ?? []) as { id: string; name: string; year: number | null; evidence_document_id: string | null; verification_status: string }[]) {
    items.push({ kind: 'badge', text: `Badge/award: "${b.name}"${b.year ? `, year ${b.year}` : ''} (${b.verification_status}).`, documentId: b.evidence_document_id });
    sigParts.push(`badge:${b.id}:${b.verification_status}`);
  }

  for (const r of (rounds ?? []) as { id: string; label: string | null; amount_eur: number | null; closed_year: number | null; investor_name: string | null }[]) {
    items.push({ kind: 'funding_round', text: `Closed round: ${r.label ?? 'Round'}${r.amount_eur ? ` of €${r.amount_eur}` : ''}${r.closed_year ? `, closed ${r.closed_year}` : ''}${r.investor_name ? ` from ${r.investor_name}` : ''}.` });
    sigParts.push(`round:${r.id}`);
  }

  if (extractionsAvail) {
    const { data: extractions } = await admin.from('document_extractions')
      .select('document_id, extracted, updated_at').eq('org_id', orgId).eq('status', 'completed');
    const { data: docs } = await admin.from('documents').select('id, name').eq('org_id', orgId);
    const nameById = new Map((docs ?? []).map((d) => [d.id as string, d.name as string]));
    for (const e of (extractions ?? []) as { document_id: string; extracted: Record<string, unknown>; updated_at: string | null }[]) {
      const docName = nameById.get(e.document_id) ?? 'a document';
      const ex = e.extracted;
      const parts: string[] = [`Document "${docName}"`];
      if (ex.documentType) parts.push(`type: ${ex.documentType as string}`);
      for (const p of (ex.programs as { name: string }[] | undefined) ?? []) parts.push(`program/award: ${p.name}`);
      for (const d of (ex.dates as { label: string; date: string }[] | undefined) ?? []) parts.push(`date — ${d.label}: ${d.date}`);
      if (ex.documentReference) parts.push(`reference: ${ex.documentReference as string}`);
      if (ex.isSigned != null) parts.push(ex.isSigned ? 'signed' : 'not signed');
      items.push({ kind: 'document', text: parts.join(', ') + '.', documentId: e.document_id });
      sigParts.push(`doc:${e.document_id}:${e.updated_at ?? ''}`);
    }
  }

  const signature = createHash('sha256').update(sigParts.sort().join('|')).digest('hex');
  return { items, signature };
}

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const empty = { available: false, suggestions: [] };
  if (!url || !serviceKey) return NextResponse.json(empty);

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  if (!(await roadmapEventSuggestionsAvailable()) || !(await roadmapEventsAvailable())) return NextResponse.json(empty);

  const orgId = await resolveOrg(sb, user.id);
  if (!orgId) return NextResponse.json(empty);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { items, signature } = await buildKnowledge(admin, orgId);

  // Has ANY row been generated under this exact knowledge signature yet?
  // If so, skip the AI call entirely and just return whatever's still
  // pending — never re-pay for an unchanged read. Each row's own signature
  // is `${title}|${date}::${knowledgeSignature}` (see runSuggestionPass),
  // so checking the suffix is enough.
  const { data: existingRows } = await admin.from('roadmap_event_suggestions')
    .select('signature').eq('org_id', orgId);
  const alreadyRanForThisSignature = (existingRows ?? []).some((r) => (r.signature as string).endsWith(`::${signature}`));

  if (!alreadyRanForThisSignature && apiKey && items.length > 0) {
    try {
      await runSuggestionPass(admin, apiKey, orgId, items, signature);
    } catch (e) {
      console.error('[roadmap/suggest-events] AI pass failed', (e as Error).message);
    }
  }

  const { data: pending } = await admin.from('roadmap_event_suggestions')
    .select('id, title, date, date_precision, category_label, document_id, reasoning')
    .eq('org_id', orgId).eq('status', 'pending').order('date', { ascending: true });

  return NextResponse.json({ available: true, suggestions: pending ?? [] });
}

async function runSuggestionPass(
  admin: SupabaseClient, apiKey: string, orgId: string, items: KnowledgeItem[], signature: string,
): Promise<void> {
  const model = process.env.AI_REVIEW_MODEL ?? 'claude-sonnet-4-5';
  const knowledgeText = items.map((i) => `- [${i.kind}] ${i.text}`).join('\n');

  const system = 'You propose roadmap events for a startup founder from exactly the company knowledge given — never invent '
    + 'a date, name, or fact not present in it. Each event needs: a short title, a date (best available — a year alone is '
    + 'fine, use January 1st), date_precision ("exact" for a specific day, "approx" for a year-only guess, "quarter" for a '
    + 'quarter), a category_label choosing the closest fit from: Technology & Product, Market & Commercial, Funding, '
    + 'Team & Company, Regulatory & IP (or empty string if none fit), and — when the knowledge item came from a specific '
    + 'document — that document\'s exact document_id so it can be linked as evidence. Propose only real, specific events; '
    + 'never a vague placeholder. ' + DOCUMENT_CONTENT_INSTRUCTION;
  const userText = `Company knowledge:\n${wrapDocumentContent(knowledgeText)}\n\nPropose roadmap events.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model, max_tokens: 2000, system,
      messages: [{ role: 'user', content: userText }],
      tools: [{
        name: 'propose_events',
        description: 'Return the proposed roadmap events.',
        input_schema: {
          type: 'object',
          properties: {
            events: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  date: { type: 'string', description: 'YYYY-MM-DD' },
                  date_precision: { type: 'string', enum: ['exact', 'approx', 'quarter'] },
                  category_label: { type: 'string' },
                  document_id: { type: 'string', description: 'Exact document_id from the knowledge given, or empty string.' },
                  reasoning: { type: 'string' },
                },
                required: ['title', 'date', 'date_precision', 'category_label', 'reasoning'],
              },
            },
          },
          required: ['events'],
        },
      }],
      tool_choice: { type: 'tool', name: 'propose_events' },
    }),
  });
  if (!res.ok) throw new Error(providerErrorMessage('[roadmap-suggest]', await res.text()));
  const data = await res.json();
  void logAiCall({ route: '/api/roadmap/suggest-events', purpose: 'roadmap_suggest', model, usage: data.usage, orgId });

  const toolUse = (data.content as { type: string; input?: unknown }[]).find((b) => b.type === 'tool_use');
  const raw = ((toolUse?.input as { events?: unknown[] } | undefined)?.events ?? []) as Record<string, unknown>[];

  const knownDocIds = new Set(items.map((i) => i.documentId).filter(Boolean));
  for (const e of raw) {
    const title = typeof e.title === 'string' ? e.title.trim() : '';
    const date = typeof e.date === 'string' ? e.date.trim() : '';
    if (!title || !date) continue;
    const datePrecision = e.date_precision === 'exact' || e.date_precision === 'quarter' ? e.date_precision : 'approx';
    const categoryLabel = typeof e.category_label === 'string' && e.category_label.trim() ? e.category_label.trim() : null;
    const documentId = typeof e.document_id === 'string' && knownDocIds.has(e.document_id) ? e.document_id : null;
    const reasoning = typeof e.reasoning === 'string' ? e.reasoning.trim() : null;
    // Signature per candidate = the shared knowledge signature this pass
    // ran under, plus the candidate's own identity — so a re-run under an
    // UNCHANGED knowledge signature never touches rows the founder already
    // dismissed (upsert on the SAME key is a no-op for them), while a truly
    // new candidate under the same signature still gets its own row.
    const candidateKey = `${title.toLowerCase()}|${date}::${signature}`;
    await admin.from('roadmap_event_suggestions').upsert({
      org_id: orgId, signature: candidateKey, title, date, date_precision: datePrecision,
      category_label: categoryLabel, document_id: documentId, reasoning, status: 'pending',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'org_id,signature', ignoreDuplicates: true });
  }
}

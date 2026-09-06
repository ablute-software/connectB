// IRM_SPEC §6b-3 — "Research with AI" on a queued enrichment profile.
// Platform admin only. Searches the public web (fund sites, news, portfolio
// pages) for missing fields and proposes them — each with a source URL and
// confidence — as `contributions` rows with source='ai'. Never writes
// directly to entities/people; every proposal still goes through the same
// verify-then-promote review as founder-authored contributions (§1b).
// LinkedIn: URL only, never scraped content — matches §6b-3's own guardrail.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient, resolveRole } from '@/lib/supabase-server';
import { logAdminAction } from '@/lib/audit';
import { logAiCall } from '@/lib/ai-cost-log';
import { DOCUMENT_CONTENT_INSTRUCTION, wrapDocumentContent } from '@/lib/prompt-injection-defense';
import { providerErrorMessage } from '@/lib/ai-provider-error';

const NOT_CONFIGURED_MSG = 'Set ANTHROPIC_API_KEY in the environment to enable AI-assisted research.';

const ENTITY_FIELDS = ['website', 'thesis', 'hq_city', 'hq_country', 'sectors', 'check_min_eur', 'check_max_eur', 'email_domain'];
const PERSON_FIELDS = ['linkedin_url', 'role', 'background', 'hook'];
// Prompt 594 §C — fields that describe a CURRENT AFFILIATION, not the
// person in the abstract. Safe to fan out to every row sharing this
// person's name AND firm; never safe to fan out to a row whose own firm
// doesn't match the one the research actually found (the "known" context
// below is built from exactly one row — rows[0] — so what the model finds
// is that row's firm's story, not a generic truth about the name).
// linkedin_url is deliberately excluded: it identifies the PERSON, not the
// affiliation, so it's correct even on a mismatched-firm row for the same
// real person (a genuine duplicate) — wrong only for the different concern
// of two different people sharing a name, which this route already can't
// tell apart and isn't what this guard is for.
const FIRM_SPECIFIC_FIELDS = new Set(['role', 'background', 'hook']);

function buildPrompt(subjectType: 'entity' | 'person', name: string, known: Record<string, unknown>) {
  const fields = subjectType === 'entity' ? ENTITY_FIELDS : PERSON_FIELDS;
  return [
    `Research the ${subjectType === 'entity' ? 'investment fund/firm' : 'person'} "${name}" using public web sources only`,
    '(fund/firm website, news coverage, interviews, podcasts, portfolio pages, public LinkedIn profile page).',
    '',
    `Already known (don't just repeat this back — fill gaps): ${wrapDocumentContent(JSON.stringify(known))}`,
    '',
    `Propose values for any of these fields you can find with reasonable confidence: ${fields.join(', ')}.`,
    subjectType === 'person'
      ? 'For linkedin_url: return the profile URL only if you find it — never fabricate one, never scrape/quote profile content beyond the public headline.'
      : '',
    'Skip any field you cannot find a real source for — do not guess or invent. Every proposal needs a real source_url.',
    'Finish by calling propose_fields with your findings.',
  ].filter(Boolean).join('\n');
}

interface ProposedField { field: string; value: string; confidence: number; source_url: string }

async function callClaude(apiKey: string, model: string, prompt: string) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      system: 'You are a research assistant for a venture/angel investor database. You search the public web and propose '
        + 'factual field values with sources — you never fabricate, never scrape gated/private content, and never treat '
        + 'inference as fact. You finish every research task by calling the propose_fields tool. '
        + DOCUMENT_CONTENT_INSTRUCTION,
      messages: [{ role: 'user', content: prompt }],
      tools: [
        { type: 'web_search_20250305', name: 'web_search', max_uses: 5 },
        {
          name: 'propose_fields',
          description: 'Return the researched field proposals, each with a real source URL and a confidence 0-1.',
          input_schema: {
            type: 'object',
            properties: {
              proposals: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    field: { type: 'string' },
                    value: { type: 'string' },
                    confidence: { type: 'number' },
                    source_url: { type: 'string' },
                  },
                  required: ['field', 'value', 'confidence', 'source_url'],
                },
              },
            },
            required: ['proposals'],
          },
        },
      ],
      tool_choice: { type: 'auto' },
    }),
  });
  if (!res.ok) throw new Error(providerErrorMessage('[backoffice/research]', await res.text()));
  const data = await res.json();
  // Prompt 293 §1 — platform-admin research applied across every org that
  // independently owns a matching name (see the `rows.flatMap` below) —
  // never one org's cost, orgId stays null (same shared-catalog
  // convention as enrichment-worker/community-consensus arbitration).
  // Prompt 469 §B — awaited: ai_call_log is used as an ACCEPTANCE
  // CRITERION (a missing entry has, more than once, been read as proof a
  // pipeline never ran), so losing an entry to a frozen serverless
  // instance invalidates a proof, not just a cost number. logAiCall
  // already swallows its own errors (ai-cost-log.ts) — awaiting it can
  // never fail this route, only add a Supabase insert's tens of
  // milliseconds against a model call that just took seconds. Do not
  // "optimize" this back to void.
  await logAiCall({ route: '/api/backoffice/research', purpose: 'admin_research', model, usage: data.usage, orgId: null });
  const toolUse = (data.content as { type: string; name?: string; input?: unknown }[])
    .filter((b) => b.type === 'tool_use' && b.name === 'propose_fields').pop();
  if (!toolUse) return { proposals: [] as ProposedField[], raw: data };
  return { proposals: ((toolUse.input as { proposals: ProposedField[] }).proposals ?? []), raw: data };
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const role = await resolveRole(user.id, user.email, sb, user.email_confirmed_at);
  if (role !== 'developer') return NextResponse.json({ ok: false, error: 'Platform admin only.' }, { status: 403 });

  const { subjectType, name } = await req.json() as { subjectType: 'entity' | 'person'; name: string };
  if (!subjectType || !name) return NextResponse.json({ ok: false, error: 'subjectType and name required' }, { status: 400 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ ok: true, configured: false, message: NOT_CONFIGURED_MSG });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const table = subjectType === 'entity' ? 'entities' : 'people';
  const nameCol = subjectType === 'entity' ? 'name' : 'full_name';
  const { data: rows, error: rowsErr } = await admin.from(table).select('*').ilike(nameCol, name);
  if (rowsErr) return NextResponse.json({ ok: false, error: rowsErr.message }, { status: 500 });
  if (!rows || rows.length === 0) return NextResponse.json({ ok: false, error: 'No matching records found.' }, { status: 404 });

  const known = subjectType === 'entity'
    ? { website: rows[0].website, hq_city: rows[0].hq_city, hq_country: rows[0].hq_country, sectors: rows[0].sectors, thesis: rows[0].thesis }
    : { role: rows[0].role, linkedin_url: rows[0].linkedin_url, background: rows[0].background };

  // Prompt 594 §C — which firm each row belongs to, so role/background/hook
  // (facts ABOUT an affiliation) never fan out to a row whose own firm
  // doesn't match rows[0]'s — the exact shape that put Shilling VC's
  // Managing-Partner story onto a person row hanging off Draycott. Also
  // doubles as the org-name lookup for §B's honest label.
  const orgIds = [...new Set((rows as { org_id: string }[]).map((r) => r.org_id))];
  const { data: orgRows } = orgIds.length
    ? await admin.from('orgs').select('id, name').in('id', orgIds)
    : { data: [] as { id: string; name: string }[] };
  const orgNameById = new Map((orgRows ?? []).map((o) => [o.id as string, o.name as string]));

  let firmNameByRowId = new Map<string, string | null>();
  let primaryFirmName: string | null = null;
  if (subjectType === 'person') {
    const entityIds = [...new Set((rows as { entity_id: string | null }[]).map((r) => r.entity_id).filter((id): id is string => !!id))];
    const { data: entRows } = entityIds.length
      ? await admin.from('entities').select('id, name').in('id', entityIds)
      : { data: [] as { id: string; name: string }[] };
    const entNameById = new Map((entRows ?? []).map((e) => [e.id as string, e.name as string]));
    firmNameByRowId = new Map(rows.map((r) => [r.id as string, r.entity_id ? entNameById.get(r.entity_id as string) ?? null : null]));
    primaryFirmName = firmNameByRowId.get(rows[0].id as string) ?? null;
  }

  try {
    const model = process.env.AI_REVIEW_MODEL ?? 'claude-sonnet-4-5';
    const { proposals } = await callClaude(apiKey, model, buildPrompt(subjectType, name, known));
    if (proposals.length === 0) {
      return NextResponse.json({ ok: true, configured: true, proposals: [], distinctOrgCount: 0, appliedTo: [], message: 'No confident findings.' });
    }

    const contributionRows: Record<string, unknown>[] = [];
    const appliedTo: { rowId: string; orgId: string; orgName: string; firmName: string | null; appliedFields: string[]; withheldFields: string[] }[] = [];
    for (const row of rows as { id: string; org_id: string }[]) {
      const rowFirmName = subjectType === 'person' ? firmNameByRowId.get(row.id) ?? null : null;
      const firmMismatch = subjectType === 'person' && rowFirmName !== primaryFirmName;
      const appliedFields: string[] = [];
      const withheldFields: string[] = [];
      for (const p of proposals) {
        if (firmMismatch && FIRM_SPECIFIC_FIELDS.has(p.field)) { withheldFields.push(p.field); continue; }
        appliedFields.push(p.field);
        contributionRows.push({
          subject_type: subjectType, subject_id: row.id, org_id: row.org_id,
          field: p.field, value: p.value, source: 'ai', confidence: p.confidence, source_url: p.source_url,
          // Prompt 572 §C.1 — same as entities/[id]/enrich: which route/model,
          // not just "ai" with no further trace.
          author_system: `backoffice-research:${model}`,
          note: `AI-proposed via research (§6b-3) for "${name}"`, status: 'submitted',
        });
      }
      appliedTo.push({
        rowId: row.id, orgId: row.org_id, orgName: orgNameById.get(row.org_id) ?? '—',
        firmName: rowFirmName, appliedFields, withheldFields,
      });
    }

    if (contributionRows.length > 0) {
      const { error: insErr } = await admin.from('contributions').insert(contributionRows);
      if (insErr) return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });
    }

    const distinctOrgCount = orgIds.length;
    await logAdminAction(admin, {
      adminUserId: user.id, action: 'ai_research', subjectType, subjectId: rows[0].id,
      detail: {
        name, proposalCount: proposals.length, distinctOrgCount, rowCount: rows.length,
        withheldForFirmMismatch: appliedTo.filter((a) => a.withheldFields.length > 0)
          .map((a) => ({ rowId: a.rowId, orgName: a.orgName, firmName: a.firmName, fields: a.withheldFields })),
      },
    });

    return NextResponse.json({ ok: true, configured: true, proposals, distinctOrgCount, appliedTo });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}

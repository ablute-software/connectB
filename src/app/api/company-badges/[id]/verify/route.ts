// Prompt 326 Pedido B — AI-assisted verification, rewritten by Prompt 918 B:
//  · it costs credits — 5, charged BEFORE the model is called (the wallet refuses with 402 when it cannot cover it);
//  · it reads the page the founder linked (a safe, capped server-side fetch) and the evidence PDF, with web search limited to one use to
//    cross-check — three when there is nothing to read — and a context budget of 30k tokens (text is cut, a PDF never is);
//  · a badge becomes `verified` only with a confirmation AND a public source the model could not have invented; the source, its title and
//    the organisation's logo are stored with it.
// The decisions live in company-badge-verify-core.ts (injected side effects, tested end to end); this file only wires the real ones.
//
// Founder-triggered, synchronous: the honest choice per the prompt's own "decide by reading what's most honest for the founder" — an
// asynchronous background check would leave the badge sitting at 'unverified' with no visible activity, indistinguishable from "nothing
// happened yet" vs "still checking".
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { chargeAiAction } from '@/lib/ai-credits';
import { logAiCall } from '@/lib/ai-cost-log';
import { providerErrorMessage } from '@/lib/ai-provider-error';
import { runBadgeVerification, verifyPreflight } from '@/lib/company-badge-verify-core';
import { fetchSourcePage, publicImageOk } from '@/lib/public-fetch';
import { parseBadgeKind } from '@/lib/company-badges';
import { withActingOrg, resolveActingOrg } from '@/lib/acting-org';

export const maxDuration = 60;

const NOT_CONFIGURED_MSG = 'AI-assisted badge verification isn’t available in your workspace yet.';
const ROUTE = '/api/company-badges/[id]/verify';
const MAX_EVIDENCE_PDF_BYTES = 10 * 1024 * 1024;

export const POST = withActingOrg(async function POST(req: Request, { params }: { params: { id: string } }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const acting = await resolveActingOrg(req, user, sb);
  if (!acting.orgId) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });
  const orgId = acting.orgId as string;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: badge } = await admin.from('company_badges').select('*').eq('id', params.id).eq('org_id', orgId).maybeSingle();
  if (!badge) return NextResponse.json({ ok: false, error: 'Badge not found.' }, { status: 404 });

  // Everything that can refuse WITHOUT costing anything comes before the charge: an already-verified badge, a broken link, no API key.
  const pre = verifyPreflight({ verification_status: badge.verification_status, source_url: (badge.source_url as string | null) ?? null });
  if (!pre.ok) return NextResponse.json({ ok: false, error: pre.error }, { status: pre.status });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ ok: true, configured: false, message: NOT_CONFIGURED_MSG });

  const { data: org } = await admin.from('orgs').select('name').eq('id', orgId).maybeSingle();
  const model = process.env.AI_REVIEW_MODEL ?? 'claude-sonnet-4-5';

  try {
    const outcome = await runBadgeVerification(
      {
        badge: {
          name: badge.name as string, description: (badge.description as string | null) ?? null, year: (badge.year as number | null) ?? null,
          kind: parseBadgeKind(badge.kind), source_url: (badge.source_url as string | null) ?? null,
        },
        orgName: (org?.name as string) ?? 'this company', model,
      },
      {
        // The wallet's own RPC, with the request-scoped session: its is_org_member() check needs a real auth.uid() (see ai-credits.ts).
        charge: () => chargeAiAction(sb, orgId, 'badge_verification'),
        loadEvidencePdf: async () => {
          if (!badge.evidence_document_id) return null;
          const { data: doc } = await admin.from('documents').select('name, storage_path').eq('id', badge.evidence_document_id).eq('org_id', orgId).maybeSingle();
          // Only a PDF can be handed to the model as one (a Word file or an image labelled application/pdf makes the provider refuse the whole call).
          if (!doc?.storage_path || !/\.pdf$/i.test(String(doc.name ?? doc.storage_path))) return null;
          const { data: blob } = await admin.storage.from('data-room').download(doc.storage_path as string);
          if (!blob) return null;
          const bytes = new Uint8Array(await blob.arrayBuffer());
          return bytes.byteLength > MAX_EVIDENCE_PDF_BYTES ? null : bytes;
        },
        fetchPage: fetchSourcePage,
        imageOk: publicImageOk,
        callModel: async (body) => {
          const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (!res.ok) throw new Error(providerErrorMessage('[company-badges/verify]', await res.text()));
          const data = await res.json();
          return { content: (data.content as unknown[]) ?? [], usage: data.usage };
        },
        // Prompt 469 §B — awaited: ai_call_log is used as an ACCEPTANCE CRITERION (a missing entry has, more than once, been read as
        // proof a pipeline never ran), so losing an entry to a frozen serverless instance invalidates a proof, not just a cost number.
        // logAiCall already swallows its own errors (ai-cost-log.ts) — awaiting it can never fail this route. Do not "optimize" it to void.
        logUsage: (usage) => logAiCall({ route: ROUTE, purpose: 'badge_verification', model, usage: usage as never, orgId }),
      },
    );

    if (outcome.kind === 'refused') {
      // 402: nothing ran — no page was fetched, no document read, no model called, and nothing was charged.
      return NextResponse.json({ ok: false, error: outcome.error, insufficientCredits: true }, { status: 402 });
    }

    const { error } = await admin.from('company_badges').update(outcome.update).eq('id', params.id).eq('org_id', orgId);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, configured: true, status: outcome.status, note: outcome.note });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
});

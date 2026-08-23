// Prompt 334 — the MatchDeal mini-pitch. GET returns the minimum-gate
// status, the currently stored pitch (if any), and whether it's gone stale
// since generation. POST (re)generates it, optionally activating it for
// investors in the same call.
//
// The AI here only ever writes SHORT COPY over claims mini-pitch.ts (pure,
// tested, no AI) has already selected — it never decides which claims
// matter, and it never touches the Ask slide's numbers (round target,
// instrument, use-of-funds, progress %) at all: those are templated in code
// so a model can never paraphrase a figure into a different one.
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { logAiCall } from '@/lib/ai-cost-log';
import { providerErrorMessage } from '@/lib/ai-provider-error';
import { DOCUMENT_CONTENT_INSTRUCTION, wrapDocumentContent } from '@/lib/prompt-injection-defense';
import {
  filterEligibleClaims, checkMiniPitchGate, buildMiniPitchPlan, computeMiniPitchInputSnapshot,
  type MiniPitchClaim, type MiniPitchSlideKind, type StoredMiniPitchSlide,
} from '@/lib/mini-pitch';
import type { ClaimCategory, ClaimSourceKind, ClaimSpecificity, ClaimStatus, DocumentRef, EvidenceClass } from '@/lib/types';

const NOT_CONFIGURED_MSG = 'AI-assisted mini-pitch generation isn’t available in your workspace yet.';
const MAX_WORDS_PER_SLIDE = 25;

function capWords(text: string, max = MAX_WORDS_PER_SLIDE): string {
  const words = text.trim().split(/\s+/);
  return words.length <= max ? text.trim() : words.slice(0, max).join(' ') + '…';
}

function fmtEur(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
}

interface OrgFields {
  name: string; oneLiner: string | null; introProblem: string | null; introSolution: string | null;
  sectors: string[] | null; stage: string | null; roundTargetEur: number | null; roundInstruments: string[] | null;
  roundUseOfFunds: string | null; roundProgressVisibleToInvestors: boolean | null; roundSecuredEur: number | null;
}

// Ask is templated, never AI-written — the one slide that carries the exact
// numbers a founder typed (target, instrument, %) must never risk a model
// silently changing one of them.
function buildAskSlide(org: OrgFields): StoredMiniPitchSlide {
  const parts: string[] = [];
  if (org.roundTargetEur != null) parts.push(`Raising ${fmtEur(org.roundTargetEur)}`);
  if (org.roundInstruments && org.roundInstruments.length > 0) parts.push(org.roundInstruments.join(', '));
  if (org.roundUseOfFunds?.trim()) parts.push(`Use of funds: ${capWords(org.roundUseOfFunds, 15)}`);
  if (org.roundProgressVisibleToInvestors && org.roundSecuredEur != null && org.roundTargetEur) {
    const pct = Math.round((org.roundSecuredEur / org.roundTargetEur) * 100);
    parts.push(`${pct}% committed so far`);
  }
  return { kind: 'ask', title: 'The ask', body: capWords(parts.join(' · ')) };
}

async function synthesizeSlides(params: {
  apiKey: string; model: string; orgId: string;
  requests: { kind: MiniPitchSlideKind; sourceText: string; claimIds: string[] }[];
}): Promise<StoredMiniPitchSlide[]> {
  const inputBlock = params.requests
    .map((r) => `Slide "${r.kind}":\n${wrapDocumentContent(r.sourceText)}`)
    .join('\n\n');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': params.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: params.model,
      max_tokens: 1200,
      system: 'You write short investor-pitch slide copy for a startup, STRICTLY from the facts given for each slide — '
        + 'never invent a fact, number, customer, claim, or detail not present in that slide\'s own input. Each slide '
        + 'body must be at most 25 words. Confident, plain, direct tone — no exclamation marks, no "revolutionary"/'
        + '"game-changing"-style hype. Never use internal words like "evidence", "claim", "category", or "class" in '
        + 'your output — write as if speaking directly to an investor who has never seen this app\'s internals. Give '
        + 'each slide a short title (max 5 words). You finish by calling report_slides exactly once, with one entry '
        + 'per slide requested, in the same order. ' + DOCUMENT_CONTENT_INSTRUCTION,
      messages: [{ role: 'user', content: `Write slide copy for each of the following:\n\n${inputBlock}` }],
      tools: [{
        name: 'report_slides',
        description: 'Report the synthesized slide copy, one entry per slide requested.',
        input_schema: {
          type: 'object',
          properties: {
            slides: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  kind: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' },
                },
                required: ['kind', 'title', 'body'],
              },
            },
          },
          required: ['slides'],
        },
      }],
      tool_choice: { type: 'tool', name: 'report_slides' },
    }),
  });
  if (!res.ok) throw new Error(providerErrorMessage('[mini-pitch/generate]', await res.text()));
  const data = await res.json();
  void logAiCall({ route: '/api/mini-pitch', purpose: 'mini_pitch_synthesis', model: params.model, usage: data.usage, orgId: params.orgId });

  const toolUse = (data.content as { type: string; name?: string; input?: unknown }[])
    .filter((b) => b.type === 'tool_use' && b.name === 'report_slides').pop();
  const rawSlides = (toolUse?.input as { slides?: { kind: string; title: string; body: string }[] } | undefined)?.slides ?? [];

  return params.requests.map((r, i) => {
    const match = rawSlides.find((s) => s.kind === r.kind) ?? rawSlides[i];
    return {
      kind: r.kind,
      title: match?.title?.trim() || undefined,
      body: capWords(match?.body?.trim() || ''),
      claimIds: r.claimIds,
    };
  });
}

async function loadContext(admin: SupabaseClient, orgId: string) {
  const [{ data: orgRow }, { data: claimRows }, { data: docRows }] = await Promise.all([
    admin.from('orgs').select('name, one_liner, intro_problem, intro_solution, sectors, stage, round_target_eur, round_instruments, round_use_of_funds, round_progress_visible_to_investors, round_secured_eur').eq('id', orgId).maybeSingle(),
    admin.from('company_claims').select('id, category, statement, evidence_class, specificity, source_kind, source_ref, status, document_refs').eq('org_id', orgId).eq('status', 'accepted'),
    admin.from('documents').select('id, visibility').eq('org_id', orgId),
  ]);

  const org: OrgFields = {
    name: (orgRow?.name as string) ?? '', oneLiner: (orgRow?.one_liner as string) ?? null,
    introProblem: (orgRow?.intro_problem as string) ?? null, introSolution: (orgRow?.intro_solution as string) ?? null,
    sectors: (orgRow?.sectors as string[]) ?? null, stage: (orgRow?.stage as string) ?? null,
    roundTargetEur: (orgRow?.round_target_eur as number) ?? null, roundInstruments: (orgRow?.round_instruments as string[]) ?? null,
    roundUseOfFunds: (orgRow?.round_use_of_funds as string) ?? null,
    roundProgressVisibleToInvestors: (orgRow?.round_progress_visible_to_investors as boolean) ?? null,
    roundSecuredEur: (orgRow?.round_secured_eur as number) ?? null,
  };

  const claims: MiniPitchClaim[] = (claimRows ?? []).map((c) => ({
    id: c.id as string, category: c.category as ClaimCategory, statement: c.statement as string,
    evidenceClass: c.evidence_class as EvidenceClass, specificity: c.specificity as ClaimSpecificity,
    status: c.status as ClaimStatus, sourceKind: c.source_kind as ClaimSourceKind, sourceRef: c.source_ref as string | null,
    documentRefs: (c.document_refs as DocumentRef[] | null) ?? undefined,
  }));

  const documentVisibilityById: Record<string, string> = {};
  (docRows ?? []).forEach((d) => { documentVisibilityById[d.id as string] = d.visibility as string; });

  const eligibleClaims = filterEligibleClaims(claims, documentVisibilityById);
  return { org, eligibleClaims };
}

async function requireOrgMember(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return { error: NextResponse.json({ ok: false, error: 'not configured' }) };

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return { error: viewerBlock };
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 }) };

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return { error: NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 }) };

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  return { admin, orgId: member.org_id as string };
}

export async function GET(req: Request) {
  const auth = await requireOrgMember(req);
  if ('error' in auth) return auth.error;
  const { admin, orgId } = auth;

  const { org, eligibleClaims } = await loadContext(admin, orgId);
  const gate = checkMiniPitchGate(
    { oneLiner: org.oneLiner, sectors: org.sectors, stage: org.stage, roundTargetEur: org.roundTargetEur, introProblem: org.introProblem, introSolution: org.introSolution },
    eligibleClaims,
  );

  const { data: stored } = await admin.from('org_mini_pitches').select('slides, input_snapshot, generated_at, activated_at').eq('org_id', orgId).maybeSingle();
  const currentSnapshot = computeMiniPitchInputSnapshot(
    { oneLiner: org.oneLiner, sectors: org.sectors, stage: org.stage, roundTargetEur: org.roundTargetEur, introProblem: org.introProblem, introSolution: org.introSolution, roundUseOfFunds: org.roundUseOfFunds },
    eligibleClaims,
  );
  const stale = !!stored && stored.input_snapshot !== currentSnapshot;

  return NextResponse.json({
    ok: true, gate,
    pitch: stored ? { slides: stored.slides, generatedAt: stored.generated_at, activatedAt: stored.activated_at, stale } : null,
  });
}

export async function POST(req: Request) {
  const auth = await requireOrgMember(req);
  if ('error' in auth) return auth.error;
  const { admin, orgId } = auth;

  let activate = false;
  try { activate = !!(await req.json())?.activate; } catch { /* no body = generate without activating */ }

  const { org, eligibleClaims } = await loadContext(admin, orgId);
  const gate = checkMiniPitchGate(
    { oneLiner: org.oneLiner, sectors: org.sectors, stage: org.stage, roundTargetEur: org.roundTargetEur, introProblem: org.introProblem, introSolution: org.introSolution },
    eligibleClaims,
  );
  if (!gate.eligible) return NextResponse.json({ ok: false, error: 'Not enough information yet.', gate }, { status: 400 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ ok: true, configured: false, message: NOT_CONFIGURED_MSG });

  const plan = buildMiniPitchPlan(eligibleClaims);
  const askSlide = buildAskSlide(org);

  const aiRequests = plan
    .filter((s) => s.kind !== 'ask')
    .map((s) => ({
      kind: s.kind,
      claimIds: s.claims.map((c) => c.id),
      sourceText: s.kind === 'hook'
        ? [org.oneLiner && `One-liner: ${org.oneLiner}`, org.introProblem && `Problem: ${org.introProblem}`, org.introSolution && `Solution: ${org.introSolution}`]
          .filter(Boolean).join('\n')
        : s.claims.map((c) => c.statement).join('\n'),
    }));

  try {
    const model = process.env.AI_REVIEW_MODEL ?? 'claude-sonnet-4-5';
    const synthesized = aiRequests.length > 0 ? await synthesizeSlides({ apiKey, model, orgId, requests: aiRequests }) : [];
    const slides: StoredMiniPitchSlide[] = [...synthesized, askSlide]
      .sort((a, b) => plan.findIndex((p) => p.kind === a.kind) - plan.findIndex((p) => p.kind === b.kind));

    const generatedAt = new Date().toISOString();
    const snapshot = computeMiniPitchInputSnapshot(
      { oneLiner: org.oneLiner, sectors: org.sectors, stage: org.stage, roundTargetEur: org.roundTargetEur, introProblem: org.introProblem, introSolution: org.introSolution, roundUseOfFunds: org.roundUseOfFunds },
      eligibleClaims,
    );

    const { data: existing } = await admin.from('org_mini_pitches').select('activated_at').eq('org_id', orgId).maybeSingle();
    // Once activated, a regeneration stays activated (Prompt 334: "Pode
    // regenerar... nada automático em background" — no re-approval step) —
    // activated_at is only ever SET here, never cleared, since only
    // `activate: true` on a request that isn't already live can set it.
    const activatedAt = activate ? generatedAt : (existing?.activated_at ?? null);

    const { error } = await admin.from('org_mini_pitches').upsert({
      org_id: orgId, slides, input_snapshot: snapshot, generated_at: generatedAt, activated_at: activatedAt, updated_at: generatedAt,
    }, { onConflict: 'org_id' });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, configured: true, pitch: { slides, generatedAt, activatedAt, stale: false } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}

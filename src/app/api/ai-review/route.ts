// AI Review — server route calling an LLM. Availability mirrors /api/me's
// `capabilities.ai` exactly (same env check) — the UI checks that before
// ever calling this route, so reaching here unconfigured should be rare,
// but the fallback text still must never name the provider or env var.
// Guardrails: the AI never sends anything and never mutates CRM data — it returns a report.
//
// Prompt 99 §3 — two changes from the original version: (1) every review is
// now persisted to ai_reviews (previously never inserted anywhere, table sat
// at 0 rows), same pattern /api/review/investability already uses for
// review_runs; (2) output is a forced tool-call (a guaranteed shape), not
// free text, so the Train sub-tab (§4) can read weaknesses/risks as data.
// Addenda ai_review_kind: every kind now receives `context`
// (stage/sectors/country/round_target_eur) and calibrates its criteria to
// stage — previously only market_data got context at all; deck_review and
// one_pager_review had none. Each weakness/risk/recommendation is tagged
// with a company_facts.category value (Fase 1 of the ecosystem-intelligence
// groundwork the addendum asked for — no new taxonomy).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient, resolveRole, authEnabled } from '@/lib/supabase-server';
import { resolveUserPlan } from '@/lib/plan-server';
import { planEntitlements, planName } from '@/lib/plans';
import { aiReviewHistoryFieldsAvailable } from '@/lib/ai-review-history-capability';
import { coerceReport, type StructuredReport } from '@/lib/ai-review-shape';
import { recordAiReviewFacts } from '@/lib/ecosystem-facts';
import { assertNotViewer } from '@/lib/developer-viewer';

type ReviewKind =
  | 'message_review' | 'deck_review' | 'one_pager_review' | 'market_data'
  | 'business_plan_review' | 'financial_plan_review' | 'marketing_plan_review' | 'cap_table_review'
  | 'cross_document_review';

const STRUCTURED_KINDS: ReviewKind[] = [
  'deck_review', 'one_pager_review', 'business_plan_review',
  'financial_plan_review', 'marketing_plan_review', 'cap_table_review',
];

const DOC_KIND_NAME: Record<string, string> = {
  deck_review: 'Pitch deck', one_pager_review: 'One-pager', business_plan_review: 'Business plan',
  financial_plan_review: 'Financial plan', marketing_plan_review: 'Commercial & marketing plan',
  cap_table_review: 'Cap table & terms',
};

// Prompt 117 Bloco B — human-readable title for every kind, stored on
// ai_reviews.title so History doesn't have to re-derive it from `kind`.
const KIND_TITLE: Record<ReviewKind, string> = {
  ...DOC_KIND_NAME,
  message_review: 'Outreach draft review',
  market_data: 'Market benchmark',
  cross_document_review: 'Cross-document check',
} as Record<ReviewKind, string>;

const CATEGORIES = ['product', 'traction', 'team', 'positioning', 'financing', 'regulatory', 'market', 'metrics', 'other'] as const;

interface CompanyContext {
  name?: string; sector?: string; stage?: string; country?: string; round_target_eur?: number; one_liner?: string;
  // Prompt 117 §1/Block A — confirmed company_facts (canon), independent of
  // whatever text is pasted for review. Before this, only market_data and
  // /api/review/investability ever received facts; deck/one-pager/business-
  // plan/etc. reviews and cross_document_review got neither facts nor pipeline
  // data, so the model correctly (per its own "never invent" system prompt)
  // reported real confirmed facts as "missing" — see the Prompt 117 report
  // for the business_plan_review that said "team unknown" about a founder
  // whose WomenInTech award was already a confirmed fact it was never shown.
  facts?: string[];
}

// StructuredReport/coerceReport/isRenderableReport live in ai-review-shape.ts
// so this route and the render path (ReportView/ReviewResultBody) share one
// definition of "valid shape" — see that file's header for why.

// Addenda ai_review_kind §1 — the ruler moves with the stage; a thin plan at
// pre-seed is expected, the same thin plan at Series B is a red flag.
function stageGuidance(stage?: string): string {
  switch (stage) {
    case 'pre_seed':
    case 'seed':
      return 'STAGE CONTEXT (pre-seed/seed): what matters is team credibility, clarity of problem/solution, and a plausible '
        + 'plan — weak or absent numbers are expected here; judge the founder\'s clarity about what is not yet known, not the numbers themselves.';
    case 'series_a':
      return 'STAGE CONTEXT (Series A): the bar shifts from "credible plan" to "repeatable proof" — real traction, early '
        + 'unit economics (even if not yet optimized), a first acquisition channel shown to work more than once.';
    case 'series_b':
      return 'STAGE CONTEXT (Series B): expect a clear path to profitability or capital efficiency, a multi-year financial '
        + 'model with cohort retention (not just aggregate totals), evidence growth is intentional not accidental, and some governance maturity.';
    case 'series_c_plus':
      return 'STAGE CONTEXT (Series C+/growth): focus shifts to the expansion thesis (new market/product/geography), capital '
        + 'efficiency vs sector peers, and readiness for the next step (acquisition, IPO, a larger round) — "does this scale with discipline", not "can this work".';
    default:
      return 'STAGE CONTEXT: stage not specified — do not assume seed by default; calibrate conservatively and say so.';
  }
}

function contextBlock(context?: CompanyContext): string {
  if (!context) return 'COMPANY CONTEXT: none provided.';
  const { facts, ...orgFields } = context;
  const factsBlock = facts?.length
    ? `\n\nCONFIRMED COMPANY FACTS (the founder's own canon, independently confirmed — treat as ground truth, `
      + `and NOT as part of the document under review):\n${facts.map((f) => `- ${f}`).join('\n')}`
      // Prompt 117 §1/Block A.3 — without this, a fact the document simply
      // doesn't repeat reads as "missing" rather than "not restated here",
      // and the model (correctly instructed never to invent) has no way to
      // tell a founder the confirmed fact belongs in this document too.
      + `\n\nWhere a confirmed company fact above is materially relevant but absent from the document under review, `
      + `say so explicitly as a recommendation to add it — that gap is itself a finding.`
    : '';
  return `COMPANY CONTEXT:\n${JSON.stringify(orgFields, null, 2)}\n\n${stageGuidance(context.stage)}${factsBlock}`;
}

const FINDING_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    category: { type: 'string', enum: CATEGORIES as unknown as string[] },
  },
  required: ['text', 'category'],
};
const SEVERITY_FINDING_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    category: { type: 'string', enum: CATEGORIES as unknown as string[] },
    severity: { type: 'string', enum: ['low', 'medium', 'high'] },
  },
  required: ['text', 'category', 'severity'],
};
const REPORT_TOOL = {
  name: 'report_review',
  description: 'Return the structured review report.',
  input_schema: {
    type: 'object',
    properties: {
      score: { type: 'number', description: '0-10.' },
      summary: { type: 'string', description: 'One or two sentences: the headline verdict.' },
      strengths: { type: 'array', items: { type: 'string' } },
      weaknesses: { type: 'array', items: SEVERITY_FINDING_SCHEMA },
      risks: { type: 'array', items: SEVERITY_FINDING_SCHEMA },
      recommendations: { type: 'array', items: FINDING_SCHEMA, description: 'Concrete, most impactful first.' },
    },
    required: ['score', 'summary', 'strengths', 'weaknesses', 'risks', 'recommendations'],
  },
};

interface RawContradiction {
  text: string; category: typeof CATEGORIES[number]; severity: 'low' | 'medium' | 'high';
  sideA?: { quote: string }; sideB?: { quote: string };
}
const CONTRADICTION_TOOL = {
  name: 'report_contradictions',
  description: 'Return only genuine contradictions between the two documents, each backed by a literal quote from both sides. If there are none, return an empty array — do not force a result.',
  input_schema: {
    type: 'object',
    properties: {
      contradictions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'One sentence stating the contradiction plainly.' },
            category: { type: 'string', enum: CATEGORIES as unknown as string[] },
            severity: { type: 'string', enum: ['low', 'medium', 'high'] },
            sideA: { type: 'object', properties: { quote: { type: 'string', description: 'Exact quote from Document A.' } }, required: ['quote'] },
            sideB: { type: 'object', properties: { quote: { type: 'string', description: 'Exact quote from Document B.' } }, required: ['quote'] },
          },
          required: ['text', 'category', 'severity', 'sideA', 'sideB'],
        },
      },
    },
    required: ['contradictions'],
  },
};

export async function POST(req: Request) {
  const body = await req.json();
  const { kind, draft, context, kindA, draftA, kindB, draftB } = body as {
    kind: ReviewKind; draft?: string; context?: CompanyContext;
    kindA?: string; draftA?: string; kindB?: string; draftB?: string;
  };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ configured: false, review: 'AI review isn’t available in your workspace yet.' }, { status: 200 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  const { data: member } = user ? await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle() : { data: null };

  // Prompt 117 Bloco G — Cross-document check and Market data are
  // motherfunding-only. Enforced HERE, not just the PlanBadge/TopTierLocked
  // UI in ReviewPanel.tsx — a real 403, not a soft configured:false, since
  // this is a paywall, not a "not yet configured" state. Skipped when auth
  // is disabled (demo mode has no plan to check against).
  if ((kind === 'cross_document_review' || kind === 'market_data') && authEnabled) {
    if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
    const [role, { plan }] = await Promise.all([
      resolveRole(user.id, user.email, sb, user.email_confirmed_at),
      resolveUserPlan(user.id, sb),
    ]);
    if (!planEntitlements(plan, role === 'developer').reviewTopTierTools) {
      return NextResponse.json({ error: `This tool is available on the ${planName('motherfunding')} plan.` }, { status: 403 });
    }
  }

  // Block D — compares two RAW documents directly (not derived ai_reviews
  // results, which don't retain the original text) for genuine factual
  // contradictions. Handled as its own branch, before the generic
  // single-document flow below, since the request/response shape is
  // fundamentally different (two documents in, a contradictions array out).
  // kindA===kindB is rejected server-side, not just discouraged in the UI —
  // two independent reads of the SAME document kind are not a cross-document
  // contradiction, they're the same content re-verbalized (the exact failure
  // mode the Block C verification pass caught in the recurrence ranking).
  if (kind === 'cross_document_review') {
    if (!kindA || !draftA || !kindB || !draftB) {
      return NextResponse.json({ error: 'Both documents are required.' }, { status: 400 });
    }
    if (kindA === kindB) {
      return NextResponse.json({ error: 'Pick two different document types to compare.' }, { status: 400 });
    }
    const nameA = DOC_KIND_NAME[kindA] ?? kindA;
    const nameB = DOC_KIND_NAME[kindB] ?? kindB;
    const crossDocSystem =
      'You compare two documents from the same early-stage startup for genuine factual contradictions — a direct conflict '
      + 'between what one claims and what the other claims, not merely a difference in emphasis, level of detail, or '
      + 'something one document simply omits. Only report an item if you can quote the exact conflicting phrase from BOTH '
      + 'documents verbatim; if you cannot find a literal quote in both, do not report it. Prefer zero contradictions over '
      + 'a low-confidence one. You never send or mutate anything; you always return a report.';
    const crossDocPrompt =
      `${contextBlock(context)}\n\nDOCUMENT A (${nameA}):\n${draftA}\n\nDOCUMENT B (${nameB}):\n${draftB}\n\n`
      + 'Find genuine contradictions between these two documents. Always finish by calling report_contradictions.';
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: process.env.AI_REVIEW_MODEL ?? 'claude-sonnet-4-5',
          max_tokens: 1500,
          system: crossDocSystem,
          messages: [{ role: 'user', content: crossDocPrompt }],
          tools: [CONTRADICTION_TOOL], tool_choice: { type: 'tool', name: 'report_contradictions' },
        }),
      });
      if (!res.ok) {
        console.error('AI review provider error:', (await res.text()).slice(0, 300));
        return NextResponse.json({ error: 'AI review failed — try again in a moment.' }, { status: 502 });
      }
      const data = await res.json();
      const toolUse = (data.content as { type: string; input?: unknown }[]).find((b) => b.type === 'tool_use');
      const parsed = toolUse?.input as { contradictions?: unknown } | undefined;
      if (!parsed) return NextResponse.json({ error: 'AI review failed — try again in a moment.' }, { status: 502 });

      // Verification follow-up (V1) — `(parsed.contradictions ?? [])` used to
      // assume the field was always an array; if the model ever collapses it
      // to something else (the same failure mode seen on structured
      // reports), `.filter()` would throw and the whole request 500s instead
      // of degrading. No sensible coercion exists for this shape (unlike
      // strengths/weaknesses, there's no bullet-string equivalent for a
      // contradictions array) — degrade to zero contradictions, which is
      // already a fully-supported, correct result ("prefer zero over a
      // low-confidence one" is the system prompt's own instruction above).
      if (!Array.isArray(parsed.contradictions)) {
        console.warn(`[ai-review-shape] kind=cross_document_review contradictions field was not an array (${typeof parsed.contradictions}) — coerced to empty`);
      }
      const rawContradictions = (Array.isArray(parsed.contradictions) ? parsed.contradictions : []) as RawContradiction[];

      // sideA.kind/sideB.kind are attached from the request, never trusted
      // from model output — a contradiction can never be mis-attributed to
      // the wrong document. Findings missing either literal quote are
      // dropped rather than surfaced half-cited.
      const contradictions = rawContradictions
        .filter((c) => c.sideA?.quote && c.sideB?.quote)
        .map((c) => ({
          text: c.text, category: c.category, severity: c.severity,
          sideA: { kind: kindA, quote: c.sideA!.quote },
          sideB: { kind: kindB, quote: c.sideB!.quote },
        }));

      if (url && service && member) {
        try {
          const admin = createClient(url, service, { auth: { persistSession: false } });
          const historyFields = (await aiReviewHistoryFieldsAvailable())
            ? {
                title: KIND_TITLE.cross_document_review,
                input_text: `${nameA}:\n${draftA}\n\n${nameB}:\n${draftB}`,
                created_by: user?.id ?? null,
                source: 'paste',
                input_meta: { kindA, kindB },
              }
            : {};
          const { data: inserted } = await admin.from('ai_reviews').insert({
            org_id: member.org_id, kind: 'cross_document_review', status: 'completed',
            result: { contradictions },
            model: process.env.AI_REVIEW_MODEL ?? 'claude-sonnet-4-5',
            ...historyFields,
          }).select('id').single();
          // Prompt 122 Block B (F1) §2.1 — contradictions carry the same
          // category+severity shape as weaknesses/risks; no overall score
          // exists for this kind, so only risk_prevalence facts apply.
          if (inserted) {
            await recordAiReviewFacts(admin, { orgId: member.org_id, reviewId: inserted.id, risks: contradictions });
          }
        } catch (e) {
          console.error('ai_reviews insert failed:', e);
        }
      }
      return NextResponse.json({ contradictions });
    } catch (e) {
      console.error('AI review error:', e);
      return NextResponse.json({ error: 'AI review failed — try again in a moment.' }, { status: 500 });
    }
  }

  // The prompt of every kind below is written generically (stage/sector/etc
  // via `context`, never a hardcoded company name or sector) — see the note
  // on the system prompt just below about NOT extending that generalization
  // to the pre-existing message_review prompt yet.
  const system =
    'You are an investor-readiness reviewer for an early-stage startup founder. You produce a structured, honest report '
    + 'grounded strictly in what is given — never invent traction, revenue, customers, or clinical/regulatory claims not '
    + 'present in the input. You never send or mutate anything; you always return a report, and you flag rule violations bluntly.';

  // message_review keeps its original, ablute_-specific system prompt
  // untouched (Prompt 99 §3.4 — flagged, not fixed: generalizing this one
  // is out of scope while ablute_ is the only real user).
  const messageReviewSystem =
    'You are an investor-outreach reviewer for ablute_, a Portuguese connected-health company raising a €1.3M seed. '
    + 'Hard rules you enforce in every review: line 1 must be a specific/recent/true hook; one small ask only; '
    + 'never claim traction, revenue or clinical results (the pilot is starting, not showing); respect the person\'s kill words; '
    + 'LinkedIn DMs under 900 characters; links only, never attachments; the product is positioned as wellness, never diagnostic. '
    + 'You produce a report — you never draft-and-send, and you flag rule violations bluntly.';

  const prompts: Record<Exclude<ReviewKind, 'cross_document_review'>, string> = {
    message_review:
      `Review this outreach draft.\n\nDRAFT:\n${draft}\n\nCRM CONTEXT (ground truth):\n${JSON.stringify(context, null, 2)}\n\n`
      + 'Return: 1) verdict (send / fix first / do not send), 2) hook strength 0-10 with why, 3) risks (kill words, framing, claims), '
      + '4) ask check, 5) a tightened rewrite.',
    deck_review:
      `${contextBlock(context)}\n\nReview this investor deck content, from an investor's point of view.\n\n${draft}\n\n`
      + 'Assess problem clarity, traction evidence, number credibility, and narrative. Always finish by calling report_review.',
    one_pager_review:
      `${contextBlock(context)}\n\nReview this one-pager content, from an investor's point of view.\n\n${draft}\n\n`
      + 'Same lens as a deck review, adapted to a single page. Always finish by calling report_review.',
    market_data:
      `Market/sector benchmarking for our own company (the startup raising the round):\n${JSON.stringify(context, null, 2)}\n\n`
      + 'Using the company facts and sector above, give: 1) market size & growth direction for this specific sector, '
      + '2) where a company at this stage/traction typically sits vs peers, 3) the metrics investors in this space benchmark on, '
      + '4) comparable/adjacent companies worth knowing (only if you are confident). Mark anything you are not certain about '
      + 'as needing verification, and never invent specific figures.',
    business_plan_review:
      `${contextBlock(context)}\n\nReview this business plan, from a seed/pre-seed investor's point of view.\n\n${draft}\n\n`
      + 'What an investor actually checks here: does the stated strategy match the unit economics a financial plan would show '
      + '(they must not contradict each other); is the go-to-market sequence credible for the sector (not "we will scale" '
      + 'without saying how); does the competitive differentiation survive a direct question ("why doesn\'t an incumbent do '
      + 'this tomorrow") rather than reading as a feature list; clear awareness of regulatory risk/moat when the sector is '
      + 'regulated. Always finish by calling report_review.',
    financial_plan_review:
      `${contextBlock(context)}\n\nReview this financial plan, from an investor's point of view.\n\n${draft}\n\n`
      + 'What an investor actually checks here: burn rate vs runway honesty (does it match what is stated elsewhere); '
      + 'revenue assumptions traceable to named growth engines, not an unexplained top-down percentage; unit economics '
      + 'actually calculated (CAC/LTV or equivalent), not assumed; use of funds specific and tied to milestones, not generic '
      + '("growth", "team"); a simple read of cap table cleanliness (dilution, liquidation preferences). Always finish by calling report_review.',
    marketing_plan_review:
      `${contextBlock(context)}\n\nReview this commercial/marketing plan, from an investor's point of view.\n\n${draft}\n\n`
      + 'What an investor actually checks here: channel realism (not "we will go viral"); CAC assumptions anchored to sector '
      + 'comparables, not invented; honesty about sales-cycle length; evidence of conversion from partnerships/pilots already '
      + 'run, not just planned. Always finish by calling report_review.',
    cap_table_review:
      `${contextBlock(context)}\n\nQuick cap-table & terms read, from an investor's point of view — this is a lighter `
      + `mini-review, not a full document review.\n\n${draft}\n\n`
      + 'Is the round structured in a way an investor will find clean — reasonable dilution, no obvious red flags carried '
      + 'over from prior terms? Always finish by calling report_review.',
  };

  const structured = STRUCTURED_KINDS.includes(kind);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: process.env.AI_REVIEW_MODEL ?? 'claude-sonnet-4-5',
        max_tokens: 1800,
        system: kind === 'message_review' ? messageReviewSystem : system,
        messages: [{ role: 'user', content: prompts[kind] ?? prompts.message_review }],
        ...(structured ? { tools: [REPORT_TOOL], tool_choice: { type: 'tool', name: 'report_review' } } : {}),
      }),
    });
    if (!res.ok) {
      console.error('AI review provider error:', (await res.text()).slice(0, 300));
      return NextResponse.json({ error: 'AI review failed — try again in a moment.' }, { status: 502 });
    }
    const data = await res.json();

    let review: string | undefined;
    let report: StructuredReport | undefined;
    if (structured) {
      const toolUse = (data.content as { type: string; input?: unknown }[]).find((b) => b.type === 'tool_use');
      const rawReport = toolUse?.input;
      if (!rawReport) return NextResponse.json({ error: 'AI review failed — try again in a moment.' }, { status: 502 });

      // Verification follow-up (V1) — the model's tool_use.input occasionally
      // doesn't conform to its own declared array schema (e.g. `strengths`
      // comes back as a markdown bullet string). Previously persisted
      // unvalidated; a History-tab render guard caught it downstream but the
      // live ReviewPanel render (which has no such guard) would have crashed
      // on the same row. Coerce-before-reject, never silently drop the
      // model's real response: recoverable shapes (string → itemized array,
      // via the same bullet-splitting the malformed rows actually used) are
      // repaired and used for BOTH the API response and what gets persisted,
      // so the founder sees a working report, not a crash. Only a truly
      // unrecoverable shape (score/summary themselves wrong, or an array
      // field that's neither an array nor a string) falls through to being
      // persisted as-is with status='malformed' and the request still fails
      // — there is nothing renderable to hand back in that case.
      const coercion = coerceReport(rawReport);
      if (!coercion.ok) {
        console.error(`[ai-review-shape] kind=${kind} unrecoverable malformed report — raw response preserved with status=malformed`);
        if (url && service && member) {
          try {
            const admin = createClient(url, service, { auth: { persistSession: false } });
            await admin.from('ai_reviews').insert({
              org_id: member.org_id, kind, status: 'malformed', result: rawReport,
              model: process.env.AI_REVIEW_MODEL ?? 'claude-sonnet-4-5',
            });
          } catch (e) { console.error('ai_reviews insert (malformed) failed:', e); }
        }
        return NextResponse.json({ error: 'AI review failed — try again in a moment.' }, { status: 502 });
      }
      if (coercion.coerced) {
        console.warn(`[ai-review-shape] kind=${kind} structured report required coercion before use (non-conforming tool-call output)`);
      }
      report = coercion.report;
    } else {
      review = (data.content as { type: string; text?: string }[]).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    }

    // Persist every review (Prompt 99 §3.1 — ai_reviews existed with the
    // right schema but nothing ever inserted into it). Best-effort: a
    // logging failure must never fail the review the founder is looking at.
    if (url && service && member) {
      try {
        const admin = createClient(url, service, { auth: { persistSession: false } });
        const historyFields = (await aiReviewHistoryFieldsAvailable())
          ? { title: KIND_TITLE[kind], input_text: draft ?? null, created_by: user?.id ?? null, source: 'paste' }
          : {};
        const { data: inserted } = await admin.from('ai_reviews').insert({
          org_id: member.org_id, kind, status: 'completed',
          result: structured ? report : { review },
          model: process.env.AI_REVIEW_MODEL ?? 'claude-sonnet-4-5',
          interaction_draft: kind === 'message_review' ? draft ?? null : null,
          ...historyFields,
        }).select('id').single();
        // Prompt 122 Block B (F1) §2.1 — only the structured-report kinds
        // carry a score + weaknesses/risks; message_review/market_data
        // return free text only (`review`), nothing analyzable to capture.
        if (inserted && structured && report) {
          await recordAiReviewFacts(admin, {
            orgId: member.org_id, reviewId: inserted.id, score: report.score,
            weaknesses: report.weaknesses, risks: report.risks,
          });
        }
      } catch (e) {
        console.error('ai_reviews insert failed:', e);
      }
    }

    return NextResponse.json(structured ? { report } : { review });
  } catch (e) {
    console.error('AI review error:', e);
    return NextResponse.json({ error: 'AI review failed — try again in a moment.' }, { status: 500 });
  }
}

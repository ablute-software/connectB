// IRM_SPEC §8b — AI outreach composer. Server route: context in, structured
// draft out. Never sends or stores anything — the founder reviews and saves
// via the existing /log flow. Draft-only, no autonomous dispatch anywhere.
import { NextRequest, NextResponse } from 'next/server';
import { lintMessage } from '@/lib/rules';
import { serverClient, resolveRole, authEnabled } from '@/lib/supabase-server';
import { resolveUserPlan } from '@/lib/plan-server';
import { planEntitlements, AI_COMPOSER_LOCKED_COPY, WATSON_DRAFT_QUOTA } from '@/lib/plans';
import { recordWatsonDraft } from '@/lib/watson-draft-record';
import { logAiCall } from '@/lib/ai-cost-log';
import type { ComposerContext, ComposerIntent } from '@/lib/composer';
import { DOCUMENT_CONTENT_INSTRUCTION } from '@/lib/prompt-injection-defense';
import { providerErrorMessage } from '@/lib/ai-provider-error';
import type { Channel, Entity, Person } from '@/lib/types';
import { buildPrompt } from './build-prompt';

const NOT_CONFIGURED_MSG =
  'AI drafting isn’t available in your workspace yet — compose the message yourself. ' +
  'The linter and pre-flight checks below still apply.';

interface ComposerToolOutput { subject: string; body: string; rationale: string; confidence: number; claims?: { text: string; factId?: string; needsConfirmation?: { question: string; options: string[] } }[] }

// Two schema variants, not one schema with an always-optional field: the
// §11b claims[] contract is only ever REQUIRED of the model when it was
// actually given canon facts to ground against (canonGated=true) — asking
// for it unconditionally would change what every existing caller gets back
// tonight, before any fact is ever confirmed.
function toolSchema(canonGated: boolean) {
  const base = {
    subject: { type: 'string', description: 'Email subject line; empty string for non-email channels.' },
    body: { type: 'string', description: 'The full message body.' },
    rationale: { type: 'string', description: 'One or two sentences: which hooks/context were used, and why.' },
    confidence: { type: 'number', description: '0 to 1 — how confident this draft is ready to send as-is.' },
  };
  if (!canonGated) {
    return { type: 'object', properties: base, required: ['subject', 'body', 'rationale', 'confidence'] };
  }
  return {
    type: 'object',
    properties: {
      ...base,
      claims: {
        type: 'array',
        description: 'One entry per factual sentence about the company in the draft.',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'The claim/sentence from the draft.' },
            factId: { type: 'string', description: 'The confirmed fact id this claim traces to, if any.' },
            needsConfirmation: {
              type: 'object',
              properties: {
                question: { type: 'string' },
                options: { type: 'array', items: { type: 'string' } },
              },
            },
          },
          required: ['text'],
        },
      },
    },
    required: ['subject', 'body', 'rationale', 'confidence', 'claims'],
  };
}

async function callClaude(apiKey: string, model: string, prompt: string, canonGated: boolean, orgId: string | null): Promise<ComposerToolOutput> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: 1200,
      system: 'You are an investor-outreach copywriter for a startup founder. You produce ONE structured draft per call via the compose_outreach tool — you never send anything, you only draft. Be specific, never generic; respect every hard rule given. '
        + DOCUMENT_CONTENT_INSTRUCTION,
      messages: [{ role: 'user', content: prompt }],
      tools: [{ name: 'compose_outreach', description: 'Return the composed outreach draft.', input_schema: toolSchema(canonGated) }],
      tool_choice: { type: 'tool', name: 'compose_outreach' },
    }),
  });
  if (!res.ok) throw new Error(providerErrorMessage('[compose]', await res.text(), 'AI draft failed — try again in a moment.'));
  const data = await res.json();
  // Prompt 469 §B — awaited: ai_call_log is used as an ACCEPTANCE
  // CRITERION (a missing entry has, more than once, been read as proof a
  // pipeline never ran), so losing an entry to a frozen serverless
  // instance invalidates a proof, not just a cost number. logAiCall
  // already swallows its own errors (ai-cost-log.ts) — awaiting it can
  // never fail this route, only add a Supabase insert's tens of
  // milliseconds against a model call that just took seconds. Do not
  // "optimize" this back to void.
  await logAiCall({ route: '/api/compose', purpose: 'compose_outreach', model, usage: data.usage, orgId });
  const toolUse = (data.content as { type: string; input?: unknown }[]).find((b) => b.type === 'tool_use');
  if (!toolUse) throw new Error('AI draft failed — try again in a moment.');
  return toolUse.input as ComposerToolOutput;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { context, channel, intent } = body as { context: ComposerContext; channel: Channel; intent: ComposerIntent };
  if (!context || !channel || !intent) {
    return NextResponse.json({ error: 'Missing context, channel, or intent.' }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ configured: false, message: NOT_CONFIGURED_MSG }, { status: 200 });
  }

  // Plans & Account batch (C) — plan gate. The env key above is the infra half
  // of AI availability; this is the plan half, and BOTH must pass. The free
  // 'idea' tier gets the locked copy (reusing configured:false so the /log
  // handler shows `message` without a client change); paid plans and the
  // platform org proceed. Skipped in demo mode (no auth to resolve a plan).
  // Enforced here server-side, not just hidden in the UI.
  let watsonOrgId: string | null = null;
  let watsonQuota = 0;
  let watsonSb: Awaited<ReturnType<typeof serverClient>> | null = null;
  // Prompt 293 §1 — separate from watsonOrgId on purpose: that one is
  // scoped to the watson-quota exemption (null for developer role even
  // though developer DOES have a real org), but AI cost logging needs the
  // caller's actual org regardless of quota exemption.
  let composeOrgId: string | null = null;
  if (authEnabled) {
    const sb = await serverClient();
    watsonSb = sb;
    const { data: { user } } = await sb.auth.getUser();
    if (user) {
      const [role, { orgId, plan }] = await Promise.all([
        resolveRole(user.id, user.email, sb, user.email_confirmed_at),
        resolveUserPlan(user.id, sb),
      ]);
      composeOrgId = orgId ?? null;
      if (!planEntitlements(plan, role === 'developer').aiComposer) {
        return NextResponse.json({ configured: false, locked: true, message: AI_COMPOSER_LOCKED_COPY }, { status: 200 });
      }
      // Prompt 106 §B — Watson monthly draft credits. The platform org
      // (developer role) is exempt, same spirit as the plan gate above.
      if (orgId && role !== 'developer') {
        watsonOrgId = orgId;
        watsonQuota = WATSON_DRAFT_QUOTA[plan];
        const { data: statusRow } = await sb.rpc('watson_drafts_status', { p_org_id: orgId, p_quota: watsonQuota });
        const status = (statusRow as { used: number; remaining: number; reset_at: string }[] | null)?.[0];
        if (status && status.remaining <= 0) {
          return NextResponse.json({
            configured: false, locked: true,
            message: `You've used all ${watsonQuota} Watson drafts this month — they reset ${new Date(status.reset_at).toLocaleDateString()}. You can still write the message manually below.`,
          }, { status: 200 });
        }
      }
    }
  }

  // Minimal Person/Entity shapes for the existing lintMessage() — it only
  // reads these fields, but rules.ts stays untouched so we satisfy its types
  // with a narrow reconstruction rather than widening the function signature.
  const personLike = {
    full_name: context.person.fullName, kill_words: context.person.killWords, hook: context.person.hook,
  } as Person;
  const entityLike = { name: context.investor.entityName, the_ask: context.investor.theAsk } as Entity;

  const canonGated = !!context.companyFacts?.length;

  try {
    const model = process.env.AI_REVIEW_MODEL ?? 'claude-sonnet-4-5';
    let draft = await callClaude(apiKey, model, buildPrompt(context, channel, intent), canonGated, composeOrgId);
    let findings = lintMessage(draft.body, personLike, entityLike, channel);

    if (findings.some((f) => f.severity === 'error')) {
      const retryPrompt = buildPrompt(context, channel, intent) +
        `\n\nYour previous attempt failed these checks — fix them:\n${findings.filter((f) => f.severity === 'error').map((f) => `- ${f.message}`).join('\n')}`;
      draft = await callClaude(apiKey, model, retryPrompt, canonGated, composeOrgId);
      findings = lintMessage(draft.body, personLike, entityLike, channel);
    }

    // Prompt 106 §B — "incremented whenever a draft is generated successfully"
    // — only reached here, after callClaude actually returned a draft. A
    // Regenerate is a fresh POST to this same route, so it's counted too, per
    // spec ("um Regenerate conta como um novo pedido"). Continua a não falhar
    // o pedido — o founder já tem o draft, e deitá-lo fora por uma falha de
    // contabilidade seria pior — mas a falha deixou de ser muda (Prompt 203
    // §A): fica em log com contexto e sai na resposta.
    //
    // quotaRecorded arranca a true e só desce numa falha real do RPC: quando
    // não há watsonOrgId/watsonSb não há consumo nenhum a registar (developer,
    // ou plano sem gate), portanto não há nada em dívida.
    let quotaRecorded = true;
    if (watsonOrgId && watsonSb) {
      quotaRecorded = await recordWatsonDraft(watsonSb, watsonOrgId, watsonQuota);
    }

    return NextResponse.json({ configured: true, draft, lint: findings, quotaRecorded });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

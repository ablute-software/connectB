// Prompt 298 §2 — AI assist for the gap interrogation flow (GapInterrogation.tsx),
// shared by both Pitch Blueprint and Review. Two distinct roles, chosen
// server-side by gap RULE (never by client input, so a caller can't ask for
// the wrong role): 'draft' rules are where the platform might already have
// the answer somewhere in what the founder already confirmed (accepted
// claims — which already cover company_facts, roadmap, funding rounds,
// vault docs, per company-knowledge-db.ts's own closed list); 'polish'
// rules are where only the founder can actually know the answer (who leads
// X, whether a specific claim is still true) — AI may only improve the
// founder's OWN wording there, never invent the fact itself.
//
// 'draft' is instructed to say so plainly when the accepted claims don't
// support an answer — never a plausible-sounding invention. 'polish' never
// adds a fact that wasn't already in the founder's own draft text.
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { claimsAvailable } from '@/lib/blueprint-capability';
import { readExistingClaims } from '@/lib/company-knowledge-db';
import { detectGaps, gapKey as computeGapKey, templateFor, type GapRule } from '@/lib/company-gaps';
import { logAiCall } from '@/lib/ai-cost-log';

const AI_ROLE: Record<GapRule, 'draft' | 'polish'> = {
  G1: 'polish', G2: 'polish', G3: 'draft', G3b: 'polish', G3c: 'polish', G4: 'draft', G5: 'polish', G6: 'draft',
  // G7 fires exactly when nothing else in the corpus corroborates this
  // claim — there's nothing to draft FROM by definition, only the
  // founder's own elaboration to help phrase.
  G7: 'polish',
};

async function resolveOrg(sb: Awaited<ReturnType<typeof serverClient>>, userId: string) {
  const { data } = await sb.from('org_members').select('org_id').eq('user_id', userId).maybeSingle();
  return (data?.org_id as string | undefined) ?? null;
}

async function gapContext(admin: SupabaseClient, orgId: string) {
  const [{ data: people }, { data: org }] = await Promise.all([
    admin.from('company_people').select('full_name, is_founder').eq('org_id', orgId),
    admin.from('orgs').select('stage, sectors').eq('id', orgId).maybeSingle(),
  ]);
  const orgRow = (org ?? null) as { stage?: string | null; sectors?: string[] | null } | null;
  return {
    founders: ((people ?? []) as { full_name: string; is_founder?: boolean }[]).filter((p) => p.is_founder).map((p) => ({ name: p.full_name })),
    stage: orgRow?.stage ?? null, sector: (orgRow?.sectors ?? [])[0] ?? null, now: new Date(),
  };
}

async function callClaude(apiKey: string, model: string, system: string, prompt: string, tool: { name: string; description: string; input_schema: object }, orgId: string | null, purpose: string) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model, max_tokens: 800, system,
      messages: [{ role: 'user', content: prompt }],
      tools: [tool], tool_choice: { type: 'tool', name: tool.name },
    }),
  });
  if (!res.ok) throw new Error(`Provider error: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  void logAiCall({ route: '/api/blueprint/gap-assist', purpose, model, usage: data.usage, orgId });
  const toolUse = (data.content as { type: string; input?: unknown }[]).find((b) => b.type === 'tool_use');
  if (!toolUse) throw new Error('No draft produced — try again.');
  return toolUse.input;
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!url || !serviceKey || !apiKey) return NextResponse.json({ ok: false, error: 'Not available in this workspace yet.' });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  if (!(await claimsAvailable())) return NextResponse.json({ ok: false, error: 'Not available in this workspace yet.' });

  const orgId = await resolveOrg(sb, user.id);
  if (!orgId) return NextResponse.json({ ok: false, error: 'No organization.' }, { status: 403 });

  const { gapKey, currentAnswer } = await req.json().catch(() => ({})) as { gapKey?: string; currentAnswer?: string };
  if (!gapKey) return NextResponse.json({ ok: false, error: 'Missing gapKey.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const claims = await readExistingClaims(admin, orgId);
  const live = claims.filter((c) => c.status !== 'rejected');
  const gaps = detectGaps(live, await gapContext(admin, orgId));
  const gap = gaps.find((g) => computeGapKey(g) === gapKey);
  if (!gap) return NextResponse.json({ ok: false, error: 'This question no longer needs an answer — it may have just been resolved.' });

  const role = AI_ROLE[gap.rule];
  const { question } = templateFor(gap);
  const model = process.env.AI_REVIEW_MODEL ?? 'claude-sonnet-4-5';

  try {
    if (role === 'polish') {
      if (!currentAnswer?.trim()) return NextResponse.json({ ok: false, error: 'Write your own answer first — AI can only improve your wording here, not invent it.' });
      const output = await callClaude(
        apiKey, model,
        'You improve a startup founder\'s own answer to an investor-readiness question — clarity and phrasing ONLY. '
          + 'Never add a fact, name, number, or claim that wasn\'t already in the founder\'s text. If it\'s already clear, return it close to unchanged.',
        `Question: "${question}"\n\nFounder's own draft answer:\n"${currentAnswer.trim()}"\n\nReturn the same answer, improved for clarity — same facts, better phrasing.`,
        { name: 'polish_answer', description: 'Return the polished answer.', input_schema: { type: 'object', properties: { polishedAnswer: { type: 'string' } }, required: ['polishedAnswer'] } },
        orgId, 'blueprint_gap_polish',
      ) as { polishedAnswer: string };
      return NextResponse.json({ ok: true, role: 'polish', text: output.polishedAnswer });
    }

    // Grounding context: the claims this specific gap is ABOUT when it names
    // them (relatedClaimIds), else every accepted claim — G3/G6 don't tie to
    // one claim id, so the model needs the fuller picture to draft from.
    const contextClaims = (gap.relatedClaimIds.length
      ? live.filter((c) => gap.relatedClaimIds.includes(c.id) && c.status === 'accepted')
      : live.filter((c) => c.status === 'accepted'))
      .map((c) => `- [${c.category}] ${c.statement}`).join('\n');
    const output = await callClaude(
      apiKey, model,
      'You draft a candidate answer to an investor-readiness question using ONLY the confirmed facts given. '
        + 'Never invent a name, number, or detail not present in the context. If the context doesn\'t actually answer the '
        + 'question, set sufficient:false and leave draftAnswer empty — do not guess.',
      `Question: "${question}"\n\nConfirmed facts already on file for this company:\n${contextClaims || '(none)'}\n\nDraft an answer using ONLY the facts above.`,
      {
        name: 'draft_answer', description: 'Return the drafted answer or say the context is insufficient.',
        input_schema: { type: 'object', properties: { sufficient: { type: 'boolean' }, draftAnswer: { type: 'string' } }, required: ['sufficient', 'draftAnswer'] },
      },
      orgId, 'blueprint_gap_draft',
    ) as { sufficient: boolean; draftAnswer: string };
    if (!output.sufficient || !output.draftAnswer?.trim()) {
      return NextResponse.json({ ok: true, role: 'draft', text: null, message: 'Nothing on file yet answers this — you\'ll need to fill it in yourself.' });
    }
    return NextResponse.json({ ok: true, role: 'draft', text: output.draftAnswer });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}

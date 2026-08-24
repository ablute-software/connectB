// Prompt 358 Phase 2.3 — "intelligent answer routing": a free-text answer to
// a gap question is not automatically a brand-new fact. When the gap was
// already ABOUT an existing claim (G4/G5/G7 — relatedClaimIds points at it),
// the founder's free text is very often just adding detail to that SAME
// claim ("Yes, and here's who exactly" for G2's vague-visit follow-up), not
// a second, independent thing worth its own row. Before this, every
// free-text answer became a brand-new company_claims row unconditionally
// (the ORIGINAL /api/blueprint/answer behavior, still correct for gaps with
// no target claim — G1/G3/G6/G3b/G3c never had one to amend into).
//
// This never invents a fact and never silently drops one: 'new_claim' is
// still the default and the only outcome when there is nothing to amend, and
// the founder sees the result either way (the answer route returns which
// path was taken; the UI surfaces it — never a silent choice happening
// behind their back, per Prompt 358's own explicit requirement).
import 'server-only';
import { DOCUMENT_CONTENT_INSTRUCTION, wrapDocumentContent } from './prompt-injection-defense';
import { logAiCall } from './ai-cost-log';
import { providerErrorMessage } from './ai-provider-error';

export interface FreeTextRouting {
  destination: 'amend_target_claim' | 'new_claim';
  reasoning: string;
}

export async function routeFreeTextAnswer(
  apiKey: string, model: string, orgId: string,
  rule: string, targetStatement: string, answerText: string,
): Promise<FreeTextRouting> {
  const system = 'A startup founder was asked a follow-up question about ONE existing claim already on file. '
    + 'Decide whether their free-text answer is just ADDING DETAIL to that same claim (a name, a date, an outcome, '
    + 'a clarification of the same fact) — destination "amend_target_claim" — or whether it states a genuinely '
    + 'SEPARATE, new fact that deserves its own record — destination "new_claim". '
    + 'When in doubt, prefer "amend_target_claim": it is the founder\'s own follow-up to their own claim, and '
    + 'creating a duplicate claim for the same fact is the failure mode being avoided here. '
    + DOCUMENT_CONTENT_INSTRUCTION;

  const userText = `Gap rule: ${rule}\n\n`
    + `Existing claim this question was about:\n${wrapDocumentContent(targetStatement)}\n\n`
    + `Founder's free-text answer:\n${wrapDocumentContent(answerText)}\n\n`
    + 'Return your destination.';

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model, max_tokens: 300, system,
      messages: [{ role: 'user', content: userText }],
      tools: [{
        name: 'route_answer',
        description: 'Return where this answer belongs.',
        input_schema: {
          type: 'object',
          properties: {
            destination: { type: 'string', enum: ['amend_target_claim', 'new_claim'] },
            reasoning: { type: 'string' },
          },
          required: ['destination', 'reasoning'],
        },
      }],
      tool_choice: { type: 'tool', name: 'route_answer' },
    }),
  });
  if (!res.ok) throw new Error(providerErrorMessage('[answer-routing]', await res.text()));
  const data = await res.json();
  void logAiCall({ route: '/api/blueprint/answer', purpose: 'answer_routing', model, usage: data.usage, orgId });

  const toolUse = (data.content as { type: string; input?: unknown }[]).find((b) => b.type === 'tool_use');
  const raw = (toolUse?.input ?? {}) as { destination?: unknown; reasoning?: unknown };
  return {
    destination: raw.destination === 'amend_target_claim' ? 'amend_target_claim' : 'new_claim',
    reasoning: typeof raw.reasoning === 'string' ? raw.reasoning : '',
  };
}

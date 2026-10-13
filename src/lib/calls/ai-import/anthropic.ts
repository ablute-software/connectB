// Prompt 909 (I4) — the real provider behind ModelCaller: the same Anthropic client and the same key the platform
// already uses elsewhere (ai-review, document extraction). No new provider, no new variable.
import 'server-only';
import { providerErrorMessage } from '@/lib/ai-provider-error';
import { PROPOSE_TOOL_NAME } from './prompt';
import type { ModelCaller } from './propose';

export class ImportProviderError extends Error {
  status: number;
  constructor(message: string, status = 502) { super(message); this.status = status; }
}

export const importModel = (): string => process.env.AI_REVIEW_MODEL ?? 'claude-sonnet-4-5';

export const callAnthropic: ModelCaller = async (req) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new ImportProviderError('The import from documents is not available right now.', 503);
  const model = importModel();
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model, max_tokens: 6000, system: req.system,
      messages: [{ role: 'user', content: req.content }],
      tools: [req.tool], tool_choice: { type: 'tool', name: PROPOSE_TOOL_NAME },
    }),
  });
  if (!res.ok) {
    throw new ImportProviderError(providerErrorMessage('[calls/import-ai]', await res.text(), 'We could not read the documents right now. Please try again in a moment.'));
  }
  const data = await res.json() as { content?: { type: string; input?: unknown }[]; usage?: { input_tokens?: number; output_tokens?: number } };
  const toolUse = (data.content ?? []).find((b) => b.type === 'tool_use');
  if (!toolUse) throw new ImportProviderError('We could not read the documents right now. Please try again in a moment.');
  return { input: toolUse.input, usage: data.usage, model };
};

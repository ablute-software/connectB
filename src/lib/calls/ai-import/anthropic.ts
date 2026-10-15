// Prompt 909 (I4) — the real provider behind ModelCaller: the same Anthropic client and the same key the platform
// already uses elsewhere (ai-review, document extraction). No new provider, no new variable.
import 'server-only';
import { providerErrorMessage } from '@/lib/ai-provider-error';
import type { ModelCaller } from './propose';

export const TRUNCATED_MESSAGE = 'The proposal was too long to fit, so it came back cut off and was discarded. Try again with a shorter document, or one document at a time.';

export class ImportProviderError extends Error {
  status: number;
  /** A short code for us (and the back office): 'provider' | 'truncated' | 'not_configured'. */
  code: string;
  constructor(message: string, status = 502, code = 'provider') { super(message); this.status = status; this.code = code; }
}

export const importModel = (): string => process.env.AI_REVIEW_MODEL ?? 'claude-sonnet-4-5';

export const callAnthropic: ModelCaller = async (req) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new ImportProviderError('The import from documents is not available right now.', 503, 'not_configured');
  const model = importModel();
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal: req.signal,
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model, max_tokens: 6000, system: req.system,
      messages: [{ role: 'user', content: req.content }],
      tools: [req.tool], tool_choice: { type: 'tool', name: req.tool.name },
    }),
  });
  if (!res.ok) {
    throw new ImportProviderError(providerErrorMessage('[calls/import-ai]', await res.text(), 'We could not read the documents right now. Please try again in a moment.'));
  }
  const data = await res.json() as { content?: { type: string; input?: unknown }[]; stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number } };
  // A tool call that ran out of tokens is cut in the middle of its JSON: never read it as a proposal, however much of it parses.
  if (data.stop_reason === 'max_tokens') throw new ImportProviderError(TRUNCATED_MESSAGE, 502, 'truncated');
  const toolUse = (data.content ?? []).find((b) => b.type === 'tool_use');
  if (!toolUse) throw new ImportProviderError('We could not read the documents right now. Please try again in a moment.');
  return { input: toolUse.input, usage: data.usage, model };
};

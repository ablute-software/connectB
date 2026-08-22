// Prompt 307 §A — a raw Anthropic provider error body must NEVER reach the
// client: it can carry a request_id and, per this codebase's own existing
// convention (classify-interaction/route.ts: "O corpo do erro vai para o
// log, NUNCA para a resposta: pode trazer detalhe da chave/conta"), account/
// key detail. Confirmed real incident: `gap-assist`'s raw provider body —
// including request_id — reached GapInterrogation.tsx verbatim.
//
// Every route that calls api.anthropic.com/v1/messages should log the raw
// body server-side (console.error, truncated) and use ONLY this helper's
// return value in the client-facing response — never (await res.text())
// or a caught Error's own .message when that Error was built from the raw
// body.
const GENERIC_AI_ERROR = 'AI assist failed — try again in a moment.';

// The account-wide Anthropic spend limit was hit — every AI call fails with
// this exact shape until it resets or is raised (an operational fact, not
// something to expose: no reset date, no account/key detail). Detected
// specifically because the generic "try again in a moment" is actively
// misleading here — retrying cannot succeed until the limit changes.
const USAGE_LIMIT_AI_ERROR = 'AI tools are temporarily unavailable — they\'ll be back soon.';

function isUsageLimitError(rawBody: string): boolean {
  try {
    const parsed = JSON.parse(rawBody) as { error?: { type?: string; message?: string } };
    return parsed?.error?.type === 'invalid_request_error' && /usage limit/i.test(parsed?.error?.message ?? '');
  } catch {
    return /usage limit/i.test(rawBody);
  }
}

// Logs the raw provider error body server-side and returns a client-safe
// message in its place. `label` identifies the call site in the log (e.g.
// '[gap-assist]'); `genericMessage` lets a caller keep its own existing
// copy for the non-usage-limit case.
export function providerErrorMessage(label: string, rawBody: string, genericMessage: string = GENERIC_AI_ERROR): string {
  console.error(`${label} provider error:`, rawBody.slice(0, 300));
  return isUsageLimitError(rawBody) ? USAGE_LIMIT_AI_ERROR : genericMessage;
}

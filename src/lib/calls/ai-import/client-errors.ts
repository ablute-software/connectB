// Prompt 909 (Adenda 2) — what the person is told when starting or following a reading of their documents goes wrong. Pure, client-safe.
//
// The case that hid the real problem: the browser got a gateway timeout (HTML or empty, not JSON) and the screen fell back to "We could not read the
// documents." with nothing to act on. Every route answer that is JSON carries its own `error`; an answer that is NOT JSON is a failure on the
// platform's side, said as such, with the HTTP code in small letters for whoever has to look into it.
export const NON_JSON_MESSAGE = 'Reading took too long or failed on our side. Please try again; if it keeps failing, contact us at sherlockdeal.com/contact.';
export const NETWORK_MESSAGE = 'We could not reach the server. Check your connection and try again.';
export const LOST_POLL_MESSAGE = 'We cannot check on the reading right now. It carries on in the background: close this window and open “Import from documents” again in a minute.';
export const CONTACT_TEXT = 'sherlockdeal.com/contact';

export interface ImportFailure { message: string; httpStatus: number | null }

/** `parsed` is whether the response body was JSON at all. */
export function importFailure(status: number, body: { error?: string } | null, parsed: boolean): ImportFailure {
  if (status === 0) return { message: NETWORK_MESSAGE, httpStatus: null };
  if (parsed && body && typeof body.error === 'string' && body.error.trim() !== '') return { message: body.error, httpStatus: status };
  return { message: NON_JSON_MESSAGE, httpStatus: status };
}

/** The sentence cut around the contact address, so the screen can make that part a link. */
export function splitContact(message: string): { before: string; after: string } | null {
  const i = message.indexOf(CONTACT_TEXT);
  return i < 0 ? null : { before: message.slice(0, i), after: message.slice(i + CONTACT_TEXT.length) };
}

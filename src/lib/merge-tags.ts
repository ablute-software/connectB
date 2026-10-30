// Prompt 924 (acerto, 29/10/2026) — "merge tags": the fields a message fills in for each person ({applicant_name}, {call_title}…) are shown to whoever WRITES the message as small labelled tags ("Applicant name"), never as code.
// What is stored does not change: it is still the code, `{applicant_name}`, in the text (so sending, the preview and the server's cleaning are untouched; the server accepts only the fields it knows). This file is the
// pure half of the one component that does it everywhere (RichTextEditor with `mergeFields`, and RichText to show a message): turning codes into tags, tags back into codes, and finding the fields that do not exist.
// A tag is ONE block: it is not edited inside, it goes with one Backspace, and copying and pasting it keeps it. An unknown field is shown as a red tag, "Unknown field", and stays in the text as it was written.
export interface MergeField { key: string; label: string }

const CODE = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The HTML of ONE tag. A known field shows its label; an unknown one says so (and keeps what was written, for saving it back as it was). */
export function tagHtml(key: string, fields: MergeField[]): string {
  const known = fields.find((f) => f.key === key);
  return known
    ? `<span class="merge-tag" data-merge="${esc(known.key)}" contenteditable="false">${esc(known.label)}</span>`
    : `<span class="merge-tag merge-tag-unknown" data-merge="${esc(key)}" data-merge-unknown="1" contenteditable="false" title="This field does not exist: ${esc(key)}">Unknown field</span>`;
}

/** `{applicant_name}` in the TEXT of an html string becomes a tag (markup and attributes are never touched). Idempotent: a tag stays a tag. */
export function codesToTags(html: string, fields: MergeField[]): string {
  return html.split(/(<[^>]*>)/).map((part) => (part.startsWith('<') ? part : part.replace(CODE, (_m, key: string) => tagHtml(key, fields)))).join('');
}

/** The other way: every tag goes back to its code. What the editor hands over, and what is stored. */
export function tagsToCodes(html: string): string {
  return html.replace(/<span\b[^>]*\bdata-merge="([^"]*)"[^>]*>[\s\S]*?<\/span>/gi, (_m, key: string) => `{${key.replace(/&amp;/g, '&')}}`);
}

/** The codes in a text (or html) that are not fields of this editor, in order, once each. */
export function unknownCodes(text: string, fields: MergeField[]): string[] {
  const known = new Set(fields.map((f) => f.key));
  const found: string[] = [];
  for (const m of text.matchAll(CODE)) if (!known.has(m[1]) && !found.includes(m[1])) found.push(m[1]);
  return found;
}

/** The plain text of a copied piece, with each tag as its code (what other editors and a text file receive). */
export function plainWithCodes(html: string): string {
  return tagsToCodes(html).replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|h2|h3|li)>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\n{3,}/g, '\n\n').trim();
}

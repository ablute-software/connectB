// Prompt 918 (Adenda 1, D) — the description of a call can be formatted: bold, italic, two heading sizes, bulleted and numbered lists, links and text colour from a short palette. What is
// stored is HTML, but ONLY the HTML this file would write: every string goes through `sanitizeRichText`, which does not "remove the dangerous parts" — it REBUILDS the text from a closed list of
// tags and attributes, escaping everything else. So `script`, free `style`, `on*` attributes, `iframe`, `javascript:` links and the like cannot get through, whatever they are wrapped in.
// It runs on the server when the description is saved (and when the import proposes one) AND again wherever it is shown. No dependency, no DOM: the same function runs in the browser, on the
// server and in the tests. Old descriptions, in plain text, keep working and look the same.

export const RICH_MAX_HTML = 20000;
export const RICH_MAX_TEXT = 5000;
const MAX_DEPTH = 24;

/** The only text colours: the brand's and a few neutrals and signals that stay readable on white. No free choice. */
export const RICH_PALETTE = [
  { key: 'ink', label: 'Black', hex: '#111827' },
  { key: 'gray', label: 'Grey', hex: '#4B5563' },
  { key: 'teal', label: 'Sherlock teal', hex: '#0E7490' },
  { key: 'green', label: 'Green', hex: '#047857' },
  { key: 'blue', label: 'Blue', hex: '#1D4ED8' },
  { key: 'purple', label: 'Purple', hex: '#6D28D9' },
  { key: 'amber', label: 'Amber', hex: '#B45309' },
  { key: 'red', label: 'Red', hex: '#B91C1C' },
] as const;
const PALETTE_HEX = new Set<string>(RICH_PALETTE.map((c) => c.hex));

/** Tags whose CONTENT is dropped with them (it would otherwise show as text, or run). */
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'svg', 'math', 'textarea', 'title', 'head', 'select', 'xmp', 'plaintext', 'noframes', 'frameset', 'applet']);
const TAG_ALIAS: Record<string, string> = { b: 'strong', i: 'em', h1: 'h2', h4: 'h3', h5: 'h3', h6: 'h3', div: 'p' };
const ALLOWED = new Set(['p', 'br', 'strong', 'em', 'h2', 'h3', 'ul', 'ol', 'li', 'a', 'span']);
const BLOCKS = new Set(['p', 'h2', 'h3', 'ul', 'ol']);

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', colon: ':', tab: '\t', newline: '\n', lpar: '(', rpar: ')', sol: '/', period: '.', comma: ',' };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);?/gi, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '';
      return String.fromCodePoint(code);
    }
    const v = NAMED_ENTITIES[body.toLowerCase()];
    return v === undefined ? m : v;
  });
}
/** Removes what is invisible or a control character (NUL, backspace, escape…, zero-width spaces, line/paragraph separators, the byte-order mark): what browsers ignore inside a scheme or a tag name. Tab, newline and carriage return stay. */
function stripControl(s: string): string {
  let out = '';
  for (let k = 0; k < s.length; k++) {
    const c = s.charCodeAt(k);
    if (c <= 8 || c === 0x0b || c === 0x0c || (c >= 0x0e && c <= 0x1f) || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029 || (c >= 0x200b && c <= 0x200f) || c === 0x2060 || c === 0xfeff) continue;
    out += s[k];
  }
  return out;
}
const escapeText = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string): string => escapeText(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Sticky expressions: each reads at one position and never copies the rest of the input (a hostile text must not make this quadratic).
const NAME = /[a-zA-Z][a-zA-Z0-9:-]*/y;
const ATTR = /[^\s=>/]+/y;
const UNQUOTED = /[^\s>]*/y;

interface Tag { name: string; closing: boolean; attrs: Record<string, string>; end: number }

/** Reads the tag that starts at `i` (a "<" followed by a letter or "/" and a letter). Null when it never ends: the rest of the input is then dropped. */
function readTag(src: string, i: number): Tag | null {
  let j = i + 1;
  const closing = src[j] === '/';
  if (closing) j++;
  NAME.lastIndex = j;
  const m = NAME.exec(src);
  if (!m) return null;
  const name = m[0].slice(0, 40).toLowerCase(); j += m[0].length;
  const attrs: Record<string, string> = {};
  for (;;) {
    while (j < src.length && /[\s/]/.test(src[j])) j++;
    if (j >= src.length) return null;
    if (src[j] === '>') return { name, closing, attrs, end: j + 1 };
    ATTR.lastIndex = j;
    const an = ATTR.exec(src);
    if (!an) { j++; continue; }
    const attr = an[0].slice(0, 60).toLowerCase(); j += an[0].length;
    while (j < src.length && /\s/.test(src[j])) j++;
    let value = '';
    if (src[j] === '=') {
      j++;
      while (j < src.length && /\s/.test(src[j])) j++;
      const q = src[j];
      if (q === '"' || q === "'") {
        const close = src.indexOf(q, j + 1);
        if (close < 0) return null;
        value = src.slice(j + 1, close); j = close + 1;
      } else {
        UNQUOTED.lastIndex = j;
        const v = UNQUOTED.exec(src)![0];
        value = v; j += v.length;
      }
    }
    if (!(attr in attrs)) attrs[attr] = value;
  }
}

/** A link target we accept: http(s) or mailto, after decoding entities and removing what browsers ignore inside a scheme. Anything else is not a link. */
export function safeHref(raw: string): string | null {
  // Browsers ignore tabs and line breaks inside a URL (that is how "java<tab>script:" is disguised): remove them, then judge. A space inside the address is not a link.
  const v = stripControl(decodeEntities(raw)).replace(/[\t\n\r]/g, '').trim();
  if (v === '' || v.length > 2000) return null;
  return /^(?:https?:\/\/[^\s<>"'`]+|mailto:[^\s<>"'`]+)$/i.test(v) ? v : null;
}

function hexOf(css: string): string | null {
  const m = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(css);
  if (!m) return null;
  const v = m[1].trim().toLowerCase();
  let hex: string | null = null;
  const h = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (h) hex = '#' + (h[1].length === 3 ? h[1].split('').map((c) => c + c).join('') : h[1]);
  const r = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(v);
  if (r) hex = '#' + [r[1], r[2], r[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('');
  hex = hex ? hex.toUpperCase() : null;
  return hex && PALETTE_HEX.has(hex) ? hex : null;
}

/**
 * Rebuilds the HTML from the closed list: p, br, strong, em, h2, h3, ul, ol, li, a (http, https or mailto only, always rel="noopener noreferrer" target="_blank") and span with a colour from the
 * palette. Everything else is dropped (its text kept, except for script, style, iframe, svg… whose content goes with it). Always returns balanced, escaped markup.
 */
export function sanitizeRichText(input: unknown): string {
  if (typeof input !== 'string' || input === '') return '';
  const src = stripControl(input.slice(0, RICH_MAX_HTML * 4));
  const lower = src.replace(/[A-Z]/g, (c) => c.toLowerCase());          // ASCII only: the same length, so the positions agree
  const out: string[] = [];
  const stack: { name: string; emit: boolean }[] = [];
  let size = 0; let i = 0;
  const push = (s: string) => { size += s.length; out.push(s); };
  const full = () => size > RICH_MAX_HTML;
  const closeTop = () => { const e = stack.pop()!; if (e.emit) push(`</${e.name}>`); };
  const closeTo = (pred: (e: { name: string; emit: boolean }) => boolean) => { while (stack.length && !pred(stack[stack.length - 1])) closeTop(); };
  const text = (raw: string) => {
    let t = escapeText(stripControl(decodeEntities(raw)));
    const room = RICH_MAX_HTML - size;
    if (room <= 0) return;
    if (t.length > room) { t = t.slice(0, room); const amp = t.lastIndexOf('&'); if (amp >= 0 && t.length - amp < 7 && !t.slice(amp).includes(';')) t = t.slice(0, amp); }
    if (t) push(t);
  };

  while (i < src.length && !full()) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { text(src.slice(i)); break; }
    if (lt > i) text(src.slice(i, lt));
    const next = src[lt + 1];
    // comments, CDATA, doctype, processing instructions: dropped whole
    if (src.startsWith('<!--', lt)) { const e = src.indexOf('-->', lt + 4); i = e < 0 ? src.length : e + 3; continue; }
    if (next === '!' || next === '?') { const e = src.indexOf('>', lt); i = e < 0 ? src.length : e + 1; continue; }
    if (!(next === '/' ? /[a-zA-Z]/.test(src[lt + 2] ?? '') : /[a-zA-Z]/.test(next ?? ''))) { text('<'); i = lt + 1; continue; }      // a "<" that is just a character
    const tag = readTag(src, lt);
    if (!tag) break;                                                                                            // a tag that never ends: the rest is dropped
    i = tag.end;
    const raw = tag.name;
    if (DROP_WITH_CONTENT.has(raw)) {
      if (!tag.closing) { const at = lower.indexOf(`</${raw}`, i); if (at < 0) { i = src.length; } else { const e = src.indexOf('>', at); i = e < 0 ? src.length : e + 1; } }
      continue;
    }
    const name = TAG_ALIAS[raw] ?? raw;
    if (tag.closing) {
      const at = stack.map((e) => e.name).lastIndexOf(name);
      if (at >= 0) { while (stack.length > at + 1) closeTop(); closeTop(); }
      continue;
    }
    if (name === 'br') { if (stack.length < MAX_DEPTH + 2) push('<br>'); continue; }
    let emit = ALLOWED.has(name);
    let open = '';
    if (emit) {
      if (BLOCKS.has(name)) closeTo((e) => e.name === 'ul' || e.name === 'ol' || e.name === 'li' ? true : !(e.name === 'p' || e.name === 'h2' || e.name === 'h3' || e.name === 'strong' || e.name === 'em' || e.name === 'a' || e.name === 'span'));
      if (name === 'li') { while (stack.length && stack[stack.length - 1].name !== 'ul' && stack[stack.length - 1].name !== 'ol') closeTop(); }
      if (name === 'a') {
        closeTo((e) => e.name !== 'a');
        const href = safeHref(tag.attrs.href ?? '');
        if (!href) emit = false; else open = `<a href="${escapeAttr(href)}" rel="noopener noreferrer" target="_blank">`;
      } else if (name === 'span') {
        const hex = hexOf(decodeEntities(tag.attrs.style ?? ''));
        if (!hex) emit = false; else open = `<span style="color:${hex}">`;
      } else if (name === 'strong' || name === 'em') {
        // A browser puts the colour of text that is already bold or italic on that very tag (style="color: rgb(…)"): the palette colour is kept there too, nothing else of the style.
        const hex = hexOf(decodeEntities(tag.attrs.style ?? ''));
        open = hex ? `<${name} style="color:${hex}">` : `<${name}>`;
      } else open = `<${name}>`;
    }
    if (stack.length >= MAX_DEPTH) continue;
    stack.push({ name, emit });
    if (emit) push(open);
  }
  while (stack.length) closeTop();
  return out.join('').replace(/<p><\/p>/g, '').trim();
}

/** The text of a description, for places that cannot show formatting (emails, a card's snippet, length checks): lists keep their bullets, paragraphs their breaks. */
export function richTextToPlain(value: unknown): string {
  if (typeof value !== 'string' || value === '') return '';
  const html = looksLikeHtml(value) ? sanitizeRichText(value) : null;
  if (html === null) return value;
  return decodeEntities(html
    .replace(/<br>/g, '\n').replace(/<(?:ul|ol)>/g, '\n').replace(/<li>/g, '• ').replace(/<\/(?:p|h2|h3|li|ul|ol)>/g, '\n').replace(/<[^>]*>/g, ''))
    .replace(/\n{3,}/g, '\n\n').trim();
}

/** Does this stored description carry markup? (Old descriptions are plain text: they have none.) */
export const looksLikeHtml = (s: string): boolean => /<\/?[a-z][^>]*>/i.test(s);

/** What to put in the page for a stored description: the sanitised HTML, or — for an old plain-text one — its paragraphs, escaped. Safe to give to dangerouslySetInnerHTML. */
export function renderDescription(value: string | null | undefined): string {
  if (!value) return '';
  if (looksLikeHtml(value)) return sanitizeRichText(value);
  return value.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${escapeText(p).replace(/\n/g, '<br>')}</p>`).join('');
}

/**
 * What the server stores for a description: sanitised HTML (or the plain text, if it never had markup), at most RICH_MAX_TEXT characters of text. Empty -> null.
 * A text too long is cut as PLAIN text: cutting HTML in the middle is how markup gets unbalanced.
 */
export function normalizeDescription(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  if (!looksLikeHtml(s)) return stripControl(s).slice(0, RICH_MAX_TEXT) || null;
  const html = sanitizeRichText(s);
  const plain = richTextToPlain(html);
  if (!plain.replace(/\s/g, '')) return null;
  if (plain.length > RICH_MAX_TEXT) return plain.slice(0, RICH_MAX_TEXT);
  return html;
}

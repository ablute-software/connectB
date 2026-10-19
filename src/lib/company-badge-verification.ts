// Prompt 918 B — the pure half of badge verification: what the model is asked, how much of a page it is allowed to read, which
// source is trusted, and what a verdict becomes. No I/O here (the fetches, the model call and the database live in the route and in
// company-badge-verify-core.ts); everything a test needs to prove is on this side of that line.
//
// WHY THE CAPS EXIST. The three verifications that ran for Mob2is on 14/10 (ai_call_log, purpose 'badge_verification') read 65 765,
// 72 925 and 92 529 input tokens each (EUR 0.42 for the three) because the tool config allowed five web searches and every search
// result is read back into the context. The new budget is explicit: a page is read at most PAGE_TOKEN_CAP tokens, the whole
// context we assemble stays under CONTEXT_TOKEN_CAP, and the search is limited to one use when the founder already gave a link.
// Text is cut; a PDF the founder attached is never cut (a half-read proof is worse than a long one).
import { DOCUMENT_CONTENT_INSTRUCTION, wrapDocumentContent } from './prompt-injection-defense';
import { normalizeSourceUrl } from './company-badges';

export const PAGE_TOKEN_CAP = 8_000;
export const CONTEXT_TOKEN_CAP = 30_000;
export const SEARCHES_WITH_LINK = 1;
export const SEARCHES_WITHOUT_LINK = 3;
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
export const MAX_PAGE_BYTES = 1_500_000;
const PDF_TOKENS_PER_PAGE = 2_000;
const MAX_NOTE_CHARS = 300;
const MAX_LOGO_CANDIDATES = 8;

/** A deliberately plain estimate (4 characters per token): the cap is a budget we plan against, not a meter. The real usage is logged per call. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Pages are counted from the file's own page objects (`/Type /Page`, not `/Pages`); a file whose objects are compressed away falls back to its size. */
export function estimatePdfTokens(bytes: Uint8Array): number {
  const text = new TextDecoder('latin1').decode(bytes);
  const found = text.match(/\/Type\s*\/Page(?![s\w])/g)?.length ?? 0;
  const pages = found > 0 ? found : Math.max(1, Math.ceil(bytes.byteLength / 60_000));
  return pages * PDF_TOKENS_PER_PAGE;
}

const CUT_MARKER = '\n[…the rest of the page was left out to stay within the reading budget…]';

/**
 * Cuts page text to the room that is left: at most PAGE_TOKEN_CAP, and never more than what keeps the whole context under
 * CONTEXT_TOKEN_CAP once the fixed parts (instructions, the claim, the tool definitions) and the PDF (never cut) are counted.
 */
export function fitPageText(text: string, budget: { fixedTokens: number; pdfTokens: number }): { text: string; tokens: number; truncated: boolean } {
  const room = Math.max(0, Math.min(PAGE_TOKEN_CAP, CONTEXT_TOKEN_CAP - budget.fixedTokens - budget.pdfTokens));
  const maxChars = room * 4;
  if (text.length <= maxChars) return { text, tokens: estimateTokens(text), truncated: false };
  const usable = Math.max(0, maxChars - CUT_MARKER.length);
  let cut = text.slice(0, usable);
  const boundary = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('. '));
  if (boundary > usable * 0.6) cut = cut.slice(0, boundary + 1);
  const out = usable === 0 ? '' : cut.trimEnd() + CUT_MARKER;
  return { text: out, tokens: estimateTokens(out), truncated: true };
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading a page

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' };
function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Readable text of an HTML page: the body without scripts, styles, navigation, footers and forms, one line per block. */
export function htmlToText(html: string): string {
  const body = (/<body[\s>][\s\S]*$/i.exec(html)?.[0] ?? html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|nav|footer|form|iframe|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|ul|ol|h[1-6]|tr|section|article|header|blockquote|table)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(body)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length >= 3)
    .join('\n');
}

export interface PageSignals { title: string | null; siteName: string | null; text: string; logoCandidates: string[] }

function metaContent(html: string, attr: 'property' | 'name' | 'itemprop', key: string): string | null {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const a = new RegExp(`\\b${attr}\\s*=\\s*["']${key}["']`, 'i').test(tag);
    if (!a) continue;
    const c = /\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i.exec(tag);
    const value = (c?.[1] ?? c?.[2] ?? '').trim();
    if (value) return decodeEntities(value);
  }
  return null;
}

function resolveHttps(raw: string, base: string): string | null {
  try {
    const url = new URL(raw, base);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.protocol === 'http:') url.protocol = 'https:';
    return normalizeSourceUrl(url.toString());
  } catch { return null; }
}

/** What the page says about itself (title, site name, text) plus the image URLs that could be the logo of whoever grants the award. */
export function extractPageSignals(html: string, baseUrl: string): PageSignals {
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const title = (metaContent(html, 'property', 'og:title') ?? (titleTag ? decodeEntities(titleTag.replace(/\s+/g, ' ').trim()) : null))?.slice(0, MAX_NOTE_CHARS) || null;
  const siteName = metaContent(html, 'property', 'og:site_name')?.slice(0, 120) ?? null;

  const raw: (string | null)[] = [
    metaContent(html, 'property', 'og:image'), metaContent(html, 'name', 'twitter:image'), metaContent(html, 'itemprop', 'logo'),
  ];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (/\brel\s*=\s*["'][^"']*(icon|apple-touch-icon)[^"']*["']/i.test(tag)) raw.push(/\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] ?? null);
  }
  for (const tag of (html.match(/<img\b[^>]*>/gi) ?? []).slice(0, 60)) {
    if (/logo/i.test(tag)) raw.push(/\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] ?? null);
  }
  const logoCandidates: string[] = [];
  for (const r of raw) {
    const url = r ? resolveHttps(decodeEntities(r), baseUrl) : null;
    if (url && !logoCandidates.includes(url)) logoCandidates.push(url);
    if (logoCandidates.length >= MAX_LOGO_CANDIDATES) break;
  }
  return { title, siteName, text: htmlToText(html), logoCandidates };
}

// ---------------------------------------------------------------------------------------------------------------------
// Which source may be stored

const TRACKING_PARAMS = /^(utm_[a-z]+|fbclid|gclid|mc_[a-z]+|ref|ref_src|igshid)$/i;

/** One page, one key: host without "www.", path without a trailing slash, query without tracking parameters, no fragment. */
export function documentKey(raw: string): string | null {
  const normalized = normalizeSourceUrl(raw);
  if (!normalized) return null;
  const url = new URL(normalized);
  const params = [...url.searchParams.entries()].filter(([k]) => !TRACKING_PARAMS.test(k)).sort(([a], [b]) => a.localeCompare(b));
  const query = params.map(([k, v]) => `${k}=${v}`).join('&');
  return `${url.hostname.replace(/^www\./i, '').toLowerCase()}${url.pathname.replace(/\/+$/, '').toLowerCase()}${query ? `?${query}` : ''}`;
}

export function sameDocument(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = a ? documentKey(a) : null;
  const kb = b ? documentKey(b) : null;
  return !!ka && ka === kb;
}

/** Every URL the web search actually returned in this response (results and citations) — the only addresses the model may name as a source it found. */
export function collectSearchResultUrls(content: unknown[]): string[] {
  const urls: string[] = [];
  const add = (u: unknown) => { if (typeof u === 'string') { const n = normalizeSourceUrl(u); if (n && !urls.includes(n)) urls.push(n); } };
  for (const block of content as { type?: string; content?: unknown; citations?: unknown }[]) {
    if (block?.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const r of block.content as { url?: unknown }[]) add(r?.url);
    }
    if (block?.type === 'text' && Array.isArray(block.citations)) {
      for (const c of block.citations as { url?: unknown }[]) add(c?.url);
    }
  }
  return urls;
}

/**
 * The source that may be stored next to a verified badge, or null. Never invented: the model's URL counts only if it is the founder's own
 * link (or the page that link led to) or a page the search really returned. If the founder's page was read and the model confirmed
 * without naming a different source, the founder's link is the source. Anything else is "no stable public source".
 */
export function chooseSource(args: {
  confirmed: boolean; founderUrl: string | null; founderFinalUrl: string | null; founderPageRead: boolean;
  modelUrl: unknown; searchUrls: string[];
}): { url: string; foundBy: 'founder' | 'sherlock' } | null {
  if (!args.confirmed) return null;
  const founder = args.founderUrl ? normalizeSourceUrl(args.founderUrl) : null;
  const isFounders = (u: string) => (!!founder && sameDocument(u, founder)) || (!!args.founderFinalUrl && sameDocument(u, args.founderFinalUrl));
  const model = typeof args.modelUrl === 'string' ? normalizeSourceUrl(args.modelUrl) : null;
  if (model) {
    if (isFounders(model)) return { url: founder ?? model, foundBy: 'founder' };
    if (args.searchUrls.some((s) => sameDocument(s, model))) return { url: model, foundBy: 'sherlock' };
    return null;
  }
  if (founder && args.founderPageRead) return { url: founder, foundBy: 'founder' };
  return null;
}

/** The logo the model picked is accepted only if it is one of the images the source page itself offered. */
export function pickLogoCandidate(modelLogo: unknown, candidates: string[]): string | null {
  const wanted = typeof modelLogo === 'string' ? normalizeSourceUrl(modelLogo) : null;
  return wanted && candidates.includes(wanted) ? wanted : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// The question and the answer

export interface Verdict {
  foundCredibleConfirmation: boolean; foundContradiction: boolean; note: string;
  sourceUrl: string | null; sourceTitle: string | null; logoUrl: string | null;
}

export function parseVerdict(content: unknown[]): Verdict | null {
  const toolUse = (content as { type?: string; name?: string; input?: unknown }[])
    .filter((b) => b?.type === 'tool_use' && b.name === 'report_verification').pop();
  if (!toolUse) return null;
  const i = (toolUse.input ?? {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
  return {
    foundCredibleConfirmation: i.found_credible_confirmation === true,
    foundContradiction: i.found_contradiction === true,
    note: str(i.note, MAX_NOTE_CHARS) ?? '',
    sourceUrl: str(i.source_url, 2000), sourceTitle: str(i.source_title, MAX_NOTE_CHARS), logoUrl: str(i.logo_url, 2000),
  };
}

export const VERIFY_SYSTEM_PROMPT =
  'You verify a startup’s claimed award, certification, programme or recognition against PUBLIC sources. '
  + 'A confirmation means a public source shows the company actually RECEIVED or took part in exactly what is claimed (the named award, programme or '
  + 'certification, in the stated year when one is given). A nomination, shortlist, finalist place, application or similar is NOT a confirmation of a claimed '
  + 'award unless the claim itself says so: report found_credible_confirmation=false and say in the note what you did find (for example "listed as a finalist, '
  + 'not as a winner"). A contradiction is only a source that clearly says otherwise (another winner, another year); the absence of evidence is neither '
  + 'confirmation nor contradiction — it is simply "not found". The founder’s link is a lead, not proof: a page the company published itself (its own '
  + 'website, blog or press release) confirms nothing on its own — it counts only when the organisation that grants the award, an official register or '
  + 'independent press shows the same thing, and the note must say which. Never fabricate a source and never rely on prior knowledge without a fresh check. '
  + 'When you confirm, report in source_url the exact public page that shows it — a page you read or one the search returned, never a guess — and in '
  + 'source_title that page’s title. If an image URL is offered as a possible logo and one is clearly the logo of the organisation that grants the '
  + 'award (not a photograph), report it in logo_url, copied exactly from the list; otherwise leave it out. You finish every check by calling the '
  + 'report_verification tool. ' + DOCUMENT_CONTENT_INSTRUCTION;

export function buildVerifyTools(searchUses: number): unknown[] {
  return [
    { type: 'web_search_20250305', name: 'web_search', max_uses: searchUses },
    {
      name: 'report_verification',
      description: 'Report the verification outcome.',
      input_schema: {
        type: 'object',
        properties: {
          found_credible_confirmation: { type: 'boolean' },
          found_contradiction: { type: 'boolean' },
          note: { type: 'string', description: 'Short (max ~200 chars) explanation of what was found or not found, including whether the company won or was only a finalist.' },
          source_url: { type: 'string', description: 'The exact public page that confirms the claim (required to confirm).' },
          source_title: { type: 'string', description: 'The title of that page.' },
          logo_url: { type: 'string', description: 'Optional: one of the offered logo image URLs, copied exactly.' },
        },
        required: ['found_credible_confirmation', 'found_contradiction', 'note'],
      },
    },
  ];
}

export interface VerifyRequestInput {
  model: string; orgName: string;
  badge: { name: string; description: string | null; year: number | null; kind: string };
  founderUrl: string | null;
  /** The founder's page, already read — absent when there is no link or it could not be read. */
  page: { finalUrl: string; title: string | null; siteName: string | null; text: string; logoCandidates: string[] } | null;
  pdf: { base64: string; tokens: number } | null;
}

/**
 * The whole request, with the page text cut to the budget. `estimatedInputTokens` is what WE assemble (instructions, claim, tools,
 * page text, the PDF); the search results the model reads back come on top, which is why searches are capped, not just text.
 */
export function buildVerifyRequest(input: VerifyRequestInput): {
  body: Record<string, unknown>; searchUses: number; estimatedInputTokens: number; pageTruncated: boolean;
} {
  // One search to cross-check a page we READ; three when there is nothing to read — no link, or a link that could not be opened.
  const searchUses = input.page ? SEARCHES_WITH_LINK : SEARCHES_WITHOUT_LINK;
  const tools = buildVerifyTools(searchUses);

  const claim = wrapDocumentContent(
    `Company: ${input.orgName}\nClaimed ${input.badge.kind}: ${input.badge.name}`
    + (input.badge.description ? `\nDescription: ${input.badge.description}` : '')
    + (input.badge.year ? `\nYear: ${input.badge.year}` : '')
    + (input.founderUrl ? `\nThe founder’s link for this claim: ${input.founderUrl}` : '\nThe founder gave no link: search for a public source.')
    + (input.founderUrl && !input.page ? '\nThat link could not be read from here: search for the public source instead.' : ''),
  );
  const lead = `Verify this claimed award, certification, programme or recognition. ${claim}`;
  const logoList = input.page && input.page.logoCandidates.length > 0
    ? `\n\nImages on that page that might be the logo of the organisation granting it:\n${input.page.logoCandidates.map((u) => `- ${u}`).join('\n')}`
    : '';
  const pageHead = input.page
    ? `\n\nThe founder’s link was read (${input.page.finalUrl}). Page title: ${input.page.title ?? '(none)'}${input.page.siteName ? ` · site: ${input.page.siteName}` : ''}. Its text follows.`
    : '';

  const fixedText = VERIFY_SYSTEM_PROMPT + JSON.stringify(tools) + lead + pageHead + logoList + wrapDocumentContent('');
  const fixedTokens = estimateTokens(fixedText) + 50;
  const pdfTokens = input.pdf?.tokens ?? 0;
  const fitted = input.page ? fitPageText(input.page.text, { fixedTokens, pdfTokens }) : null;

  const content: unknown[] = [{ type: 'text', text: lead + pageHead + (fitted ? `\n${wrapDocumentContent(fitted.text)}` : '') + logoList }];
  if (input.pdf) {
    content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: input.pdf.base64 } });
    content.push({ type: 'text', text: 'The attached document is the founder’s own supporting evidence for this claim.' });
  }

  return {
    body: { model: input.model, max_tokens: 1000, system: VERIFY_SYSTEM_PROMPT, messages: [{ role: 'user', content }], tools, tool_choice: { type: 'auto' } },
    searchUses,
    estimatedInputTokens: fixedTokens + (fitted?.tokens ?? 0) + pdfTokens,
    pageTruncated: fitted?.truncated ?? false,
  };
}

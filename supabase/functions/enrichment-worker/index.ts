// Prompt 137 — motor de enriquecimento de investidores. Worker.
//
// Invocado por pg_cron a cada 10-15 min (mesmo padrao que matchdeal_sla_sweep,
// ver 0053_retroactive_matchdeal_schema_capture.sql), ou manualmente via POST
// para testes/ensaio a seco. Le a fila enrichment_jobs (0146), processa
// Camada 1 (entidade: pagina de equipa) e Camada 2 (pessoa: hook), escreve em
// catalog_people / catalog_people_research / catalog_person_affiliations /
// catalog_entity_enrichment_sources, sempre via service role (bypassa RLS).
//
// Desenho confirmado com o Nuno antes de escrever este ficheiro:
//
// D1 (verificavel, nao confiavel): o modelo NUNCA devolve a biografia em si.
// Devolve duas ancoras literais (inicio/fim, ~6-10 palavras cada) que tem de
// aparecer na pagina. O codigo localiza as ancoras no texto da pagina
// (normalizado — espacos, aspas tipograficas, travessoes) e corta bio_raw
// dessa fatia. Se nao encontrar, e erro de validacao (repete, depois falha) —
// nunca grava o que o modelo "acha" que disse a pagina.
//
// Escala: caso comum e UMA chamada sobre a pagina de equipa. So se vai buscar
// a pagina individual de uma pessoa quando a bio extraida da pagina de equipa
// fica abaixo do limiar (300 caracteres, o mesmo que despoleta Camada 2) — e
// nesse caso e uma chamada por pagina, nunca concatenada. A verificacao de
// subcadeia e sempre contra o texto DAQUELA pagina especifica.
//
// D1 estendido (incidente Faber, 2026-08-08): D1 so cobria bio_raw. O
// worker pedia linkedin_url e individual_profile_url ao modelo como texto
// livre, mas htmlToText() descarta todos os href antes do texto chegar ao
// prompt — o modelo nunca via um URL real e pattern-completava um slug
// plausivel a partir do nome (13 de 16 URLs errados, 3 certos por acaso).
// Regra geral daqui em diante: nenhum campo cujo valor nao exista
// literalmente no texto entregue ao modelo pode ser pedido como string
// livre — ou entra no texto (candidato extraido por codigo, o modelo so
// escolhe), ou e extraido por codigo directamente, ou nao se pede.
// extractLinkedinCandidates/extractInternalLinkCandidates fazem essa
// extraccao por DOM antes da chamada; full_name/title/submission_channel
// sao validados por presenca literal no texto (isLiterallyOnPage) em vez
// de assumidos. thesis/sectors ficam de fora — sao sintese por natureza,
// nao extraccao, o mesmo risco residual do hook da Camada 2, nao fechado
// por esta correccao.
//
// D1 estendido a email (Prompt 284, caso Nalka Invest): a pagina de equipa
// publica "Email: sigrid.fjermeros@nalka.com" como texto literal — uma
// fonte primaria oficial, nao um guess. extractEmailCandidates() extrai por
// codigo (mailto: hrefs + regex no texto visivel) ANTES da chamada, mesmo
// principio D1 estendido do linkedin_url: o modelo so escolhe de uma lista
// fechada, nunca escreve o valor livremente. Gravado em
// catalog_people_research.email_verified (migracao 0198, propose-only) —
// distinto de email_guess/email_guess_confidence (Camada 2, ja existentes),
// que continuam a ser um guess a partir de fontes de pesquisa, nao um
// email publicado. isEmailVerifiedColumnAvailable() sonda a coluna antes
// de gravar (este worker Deno nao tem acesso ao makeCapabilityProbe da
// app Next.js), para nao falhar silenciosamente antes da migracao aterrar.
//
// Camada 2: hook so se escreve se houver pelo menos uma fonte LIDA (nao so
// encontrada) em catalog_entity_enrichment_sources — um hook inventado
// queima o contacto de forma permanente, pior que hook nenhum. Sem fonte
// lida: hook_status='none_found', campo vazio. Os restantes campos da
// Camada 2 (intro_path, watch_outs, kill_words, background) nao levam esta
// obrigacao — so hook, por instrucao explicita.
//
// Camada 2 estendida (piloto de 3 angels, 2026-08-08): pesquisar sem ler
// nunca deu material para um gancho — so titulos e snippets. Agora e
// pesquisa -> escolhe ate 3 fontes reais (mesma lista-fechada-validada-por-
// codigo do linkedin_url) -> le-as com o mesmo fetchPage/htmlToText da
// Camada 1 -> so entao sintetiza, a partir do texto lido, nao dos
// snippets. Reaproveita fontes ja registadas em vez de pesquisar de novo
// quando ja existem para a pessoa. max_uses subiu de 3 para 10, e o prompt
// de pesquisa diz explicitamente que atingir esse tecto e normal — era o
// nosso proprio limite mal interpretado pelo modelo como a ferramenta
// estar indisponivel.
//
// Falhas: robots.txt / site so JavaScript / pagina de equipa inexistente ->
// 'skipped', sem incrementar attempts (nao entram no ciclo de repeticoes).
// Erros transitorios (rede, 5xx, falha de validacao D1) -> 'failed' apos 3
// tentativas. Custo acumula-se SEMPRE (mesmo em jobs skipped/failed) — nunca
// sobreposto entre tentativas.
//
// Travoes antes de qualquer corrida paga: autenticacao do chamador (so
// is_platform_admin() ou o proprio pg_cron via service role — ver bloco de
// auth abaixo, mesmo padrao de matchdeal-pair/index.ts), ENRICHMENT_ENABLED,
// tecto diario, is_test bloqueado (na fila E aqui, defensivo), e modo de
// ensaio a seco (dryRun no corpo do POST) que faz os fetches e reporta sem
// chamar o modelo nem escrever nada — dryRun fica ATRAS da mesma porta de
// autenticacao que a corrida a serio, porque continua a fazer fetches reais
// contra sites de terceiros mesmo sem chamar o modelo.
//
// NAO TOCA em access_grants, matchdeal_eligible_deck, matchdeal_profiles, nem
// nas tabelas privadas people/person_affiliations/entity_enrichment_sources.
//
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.45/deno-dom-wasm.ts';
// Prompt 634 — the Article 9 net and the kill-word check, kept in their own
// file so src/lib/special-category-guard.test.ts tests the deployed code.
import { hookContainsKillWord, stripSpecialCategoryFields } from './special-category.ts';
// Prompt 638 §3.2 — rule (a) of the hook bar, checked by code before the write.
import { hookIsAboutTheFund } from './hook-rules.ts';
// Prompt 642 §4 — the worker never writes over a human-stamped field and never null over a value.
import { isHumanVerified, stripHumanVerified, withoutNulls } from './human-guard.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;

const ENRICHMENT_ENABLED = (Deno.env.get('ENRICHMENT_ENABLED') ?? 'false').toLowerCase() === 'true';
const DAILY_COST_CAP_EUR = Number(Deno.env.get('ENRICHMENT_DAILY_COST_CAP_EUR') ?? '5');
const LAYER1_MODEL = Deno.env.get('ENRICHMENT_LAYER1_MODEL') ?? 'claude-haiku-4-5';
// Prompt 583 §B.1 — "claude-sonnet-5 sai do worker": the measured Layer 2
// average (152,229 input / 6,433 output tokens, €0.32/person) was mostly a
// consequence of running every person through sonnet-5's per-token price
// (2x haiku's input, 2x its output) regardless of whether a cheap bio-only
// pass could have answered it for ~€0.005. haiku-4-5 is now the default
// for every Layer 2 call; a future "deep research" override for a
// specific person would pass a different model explicitly, but no call
// site asks for that today, so it isn't built here.
const LAYER2_MODEL = Deno.env.get('ENRICHMENT_LAYER2_MODEL') ?? 'claude-haiku-4-5';
const BATCH_SIZE = Number(Deno.env.get('ENRICHMENT_BATCH_SIZE') ?? '5');
// Prompt 583 §B.1b — web fallback caps: at most 3 sources actually read
// (unchanged from before), each truncated to ~4k tokens' worth of text
// before entering the prompt (~4 chars/token, so 16,000 chars), keeping
// total page-text input for 3 sources around 12k tokens — well inside the
// prompt's own ≤20k-token budget once the rest of the prompt (person
// context, instructions) is added. max_uses on the search tool itself
// drops from 10 to 5: the old value existed to stop the model from
// mistaking OUR cap for the search tool being broken (Prompt 281), not
// because 10 searches were ever needed — 5 keeps that same headroom at
// roughly half the multi-turn context this tool's own pause_turn loop can
// accumulate.
const WEB_FALLBACK_MAX_SOURCES_READ = 3;
const WEB_FALLBACK_PAGE_CHAR_LIMIT = 16000;
const WEB_FALLBACK_SEARCH_MAX_USES = 5;
// Below this confidence, the bio-only pass (§B.1a) doesn't get to decide
// alone — falls through to the web-search path (§B.1b) instead.
const BIO_HOOK_CONFIDENCE_THRESHOLD = 0.6;
const MAX_PROFILE_PAGES_PER_ENTITY = 10; // doc §3.2 step 3
const BIO_LENGTH_THRESHOLD = 300; // doc's own heuristic, reused for D1-b scaling decision

// Prompt 583 §D.2 — a custom bot UA is exactly what the measured 403/429
// pattern (19 http_403, 5 http_429 in one production sample) points at:
// many sites block-list unrecognized bot user-agents by pattern while
// accepting ordinary browser traffic. A real browser UA + Accept-Language
// is not deception about WHAT is fetching (robots.txt is still checked
// first, same as before) — it is fetching the same way a human visitor's
// browser would, which is what most of these sites' bot-blocking is
// actually trying to distinguish from.
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const ACCEPT_LANGUAGE = 'en-US,en;q=0.9';
// One retry after a 403/429, per §D.2 — a bot-blocking site is not going
// to reconsider in 1.5s, but this catches the genuinely transient case
// (a WAF's momentary rate-limit blip) before concluding it's structural.
const BLOCK_RETRY_DELAY_MS = 1500;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// ============================================================
// Pricing — secao 5 do prompt. USD/1M tokens, taxa 1 USD = 0.865 EUR
// (confirmada, nao 0.92). Precos intro Sonnet 5 (validos ate 2026-08-31),
// como pedido explicitamente no prompt.
// ============================================================
const USD_TO_EUR = 0.865;
const PRICING: Record<string, { inUsd: number; outUsd: number }> = {
  'claude-haiku-4-5': { inUsd: 1.0, outUsd: 5.0 },
  'claude-sonnet-5': { inUsd: 2.0, outUsd: 10.0 },
};

function costEur(model: string, usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number }) {
  const p = PRICING[model];
  if (!p) return 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const freshInput = Math.max(0, usage.input_tokens - cacheRead);
  const usd =
    (freshInput / 1_000_000) * p.inUsd +
    (cacheRead / 1_000_000) * p.inUsd * 0.1 + // cache read = 10% do preco de entrada
    (usage.output_tokens / 1_000_000) * p.outUsd;
  return usd * USD_TO_EUR;
}

// ============================================================
// Telemetria — acumula, nunca sobrepoe (secao 3 confirmada com o Nuno).
// ============================================================
type Telemetry = { tokensIn: number; tokensOut: number; webCalls: number; costEur: number; models: Set<string> };
function newTelemetry(): Telemetry {
  return { tokensIn: 0, tokensOut: 0, webCalls: 0, costEur: 0, models: new Set() };
}
function addUsage(t: Telemetry, model: string, usage: any) {
  t.tokensIn += usage.input_tokens ?? 0;
  t.tokensOut += usage.output_tokens ?? 0;
  t.costEur += costEur(model, usage);
  t.models.add(model);
}

async function flushTelemetry(jobId: string, t: Telemetry, extra: Record<string, unknown> = {}, target?: { targetType: string; targetId: string }) {
  const { data: current } = await supabase
    .from('enrichment_jobs')
    .select('tokens_in, tokens_out, web_calls, cost_eur, model')
    .eq('id', jobId)
    .single();
  // Junta modelos (nunca sobrepoe) — uma tentativa que muda de modelo (ex.
  // repeticao com config diferente) nao pode perder o registo da primeira.
  const priorModels = (current?.model ?? '').split(',').map((m: string) => m.trim()).filter(Boolean);
  const mergedModels = new Set([...priorModels, ...t.models]);
  await supabase
    .from('enrichment_jobs')
    .update({
      tokens_in: (current?.tokens_in ?? 0) + t.tokensIn,
      tokens_out: (current?.tokens_out ?? 0) + t.tokensOut,
      web_calls: (current?.web_calls ?? 0) + t.webCalls,
      cost_eur: Number(((current?.cost_eur ?? 0) + t.costEur).toFixed(5)),
      model: [...mergedModels].join(','),
      ...extra,
    })
    .eq('id', jobId);

  // Prompt 293 §1 — mirror THIS flush's own delta into ai_call_log too, so
  // the Next app's "AI Costs" tab has one single table to read instead of
  // also having to special-case enrichment_jobs. Deliberately never
  // duplicated the running total above (that's still enrichment_jobs'
  // own job, unchanged) — one ai_call_log row per flush, org_id always
  // null: enrichment benefits every org that has or will have this
  // catalog record, never the one org that happened to trigger the job.
  // Skipped when this flush did no real AI work (e.g. a job that ended
  // 'skipped' before ever calling the model) — nothing to log.
  if (t.tokensIn > 0 || t.tokensOut > 0) {
    try {
      await supabase.from('ai_call_log').insert({
        route: 'enrichment-worker', purpose: `enrichment:${target?.targetType ?? 'unknown'}`,
        model: [...t.models].join(',') || 'unknown',
        tokens_in: t.tokensIn, tokens_out: t.tokensOut, cost_eur: Number(t.costEur.toFixed(5)),
        org_id: null, target_type: target?.targetType ?? null, target_id: target?.targetId ?? null,
      });
    } catch (e) {
      // ai_call_log may not exist yet (migration 0202 not applied) — never
      // let cost-observability mirroring break the actual enrichment job.
      console.error('[ai_call_log mirror] failed', e);
    }
  }
}

// ============================================================
// HTML -> texto deterministico. Nunca guardamos a pagina inteira
// permanentemente — so o excerto ja validado por ancoras (D1c).
// ============================================================
function normalizeForMatch(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (!doc?.body) return '';
  doc.querySelectorAll('script, style, noscript').forEach((el: any) => el.remove());
  return normalizeForMatch(doc.body.textContent ?? '');
}

// D1(c): o codigo corta a fatia — o modelo nunca devolve a biografia, nem
// sequer no ramo sem ancora de fim (ai tambem se corta da pagina, nunca se
// devolve a string vinda do modelo directamente). Se as ancoras nao
// aparecerem literalmente no texto normalizado da pagina, e tratado como
// falha de validacao (retry), nunca como paraphrase aceite.
//
// Ancora de inicio ambigua = corrupcao silenciosa, nao um caso a tolerar: se
// aparecer mais do que uma vez na pagina, o corte podia comecar no sitio
// errado e colar a biografia de outra pessoa a esta. Rejeita (null -> retry
// a pedir uma ancora mais longa) em vez de assumir a primeira ocorrencia.
// Tecto de comprimento (4000 caracteres) protege o caso simetrico do lado do
// fim: uma ancora de fim que so casa muito mais tarde colaria varias
// biografias seguidas sem que isso apareca como erro.
const MAX_BIO_SLICE_LENGTH = 4000;

function sliceByAnchors(pageTextNormalized: string, startAnchor: string | null, endAnchor: string | null): string | null {
  if (!startAnchor) return null;
  const startNeedle = normalizeForMatch(startAnchor);
  const start = pageTextNormalized.indexOf(startNeedle);
  if (start === -1) return null;
  if (pageTextNormalized.indexOf(startNeedle, start + 1) !== -1) return null; // ancora de inicio ambigua

  let slice: string;
  if (!endAnchor) {
    // sem ancora de fim: aceita so a ancora de inicio como bio curta (raro,
    // mas mais seguro que inventar um fim) — cortada da pagina, nao devolvida
    // a partir da string do modelo.
    slice = pageTextNormalized.slice(start, start + startNeedle.length);
  } else {
    const endNeedle = normalizeForMatch(endAnchor);
    const endIdx = pageTextNormalized.indexOf(endNeedle, start);
    if (endIdx === -1) return null;
    slice = pageTextNormalized.slice(start, endIdx + endNeedle.length);
  }
  slice = slice.trim();
  if (slice.length > MAX_BIO_SLICE_LENGTH) return null;
  return slice;
}

// ============================================================
// robots.txt — minimo suficiente: User-agent: * , Disallow por prefixo.
// Ausencia de robots.txt = permitido (comportamento standard).
// ============================================================
async function isAllowedByRobots(targetUrl: string): Promise<boolean> {
  const u = new URL(targetUrl);
  try {
    const res = await fetch(`${u.origin}/robots.txt`, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return true;
    const text = await res.text();
    const lines = text.split('\n').map((l) => l.trim());
    let inStarBlock = false;
    const disallows: string[] = [];
    for (const line of lines) {
      const [rawKey, ...rest] = line.split(':');
      const key = rawKey?.toLowerCase().trim();
      const value = rest.join(':').trim();
      if (key === 'user-agent') inStarBlock = value === '*';
      else if (inStarBlock && key === 'disallow' && value) disallows.push(value);
    }
    return !disallows.some((path) => u.pathname.startsWith(path));
  } catch {
    return true; // fetch falhou (timeout, DNS) — nao bloqueamos por causa disso
  }
}

async function fetchPage(url: string): Promise<{ ok: true; html: string } | { ok: false; reason: string }> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': ACCEPT_LANGUAGE }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('html')) return { ok: false, reason: 'not_html' };
    return { ok: true, html: await res.text() };
  } catch (err) {
    return { ok: false, reason: `fetch_error: ${(err as Error).message}` };
  }
}

// Prompt 583 §D.2 — 403/429 get exactly one retry after a short backoff
// before being called structurally "blocked" rather than "failed": a real
// network/5xx error keeps its existing behavior (immediate 'failed'
// reason, retried on a later cron cycle via the job's own attempts
// counter) — only a bot-rejection status code gets this distinct
// treatment, because retrying it every few minutes like a transient error
// has no realistic chance of a different outcome.
async function fetchPageWithBlockRetry(url: string): Promise<{ ok: true; html: string } | { ok: false; reason: string; blocked: boolean }> {
  const first = await fetchPage(url);
  if (first.ok) return first;
  if (first.reason !== 'http_403' && first.reason !== 'http_429') return { ...first, blocked: false };
  await new Promise((resolve) => setTimeout(resolve, BLOCK_RETRY_DELAY_MS));
  const second = await fetchPage(url);
  if (second.ok) return second;
  if (second.reason !== 'http_403' && second.reason !== 'http_429') return { ...second, blocked: false };
  return { ok: false, reason: `blocked_${second.reason}`, blocked: true };
}

// Prompt 583 §D.1 — pattern expanded to the prompt's own exact list
// (team|people|partners|about|who-we-are|equipa|equipo|équipe|team-and-
// advisors), union'd with what was already here rather than replacing it —
// dropping an already-working match (nosotros, qui-sommes, quem-somos,
// our-team, sobre-nos) to satisfy a differently-worded new list would be a
// regression, not a fix.
const TEAM_PAGE_PATTERN = /team|about|people|partners|equipa|equipo|équipe|team-and-advisors|nosotros|qui-sommes|quem-somos|who-we-are|our-team|sobre-nos/i;

function discoverTeamPageUrl(homepageHtml: string, baseUrl: string): string | null {
  const doc = new DOMParser().parseFromString(homepageHtml, 'text/html');
  if (!doc) return null;
  const anchors = [...doc.querySelectorAll('a')] as any[];
  let best: string | null = null;
  let bestScore = -1;
  for (const a of anchors) {
    const href = a.getAttribute('href');
    if (!href) continue;
    const text = (a.textContent ?? '').trim();
    const hrefMatch = TEAM_PAGE_PATTERN.test(href);
    const textMatch = TEAM_PAGE_PATTERN.test(text);
    if (!hrefMatch && !textMatch) continue;
    const score = (hrefMatch ? 2 : 0) + (textMatch ? 1 : 0) - (href.length > 60 ? 1 : 0);
    if (score > bestScore) {
      try {
        best = new URL(href, baseUrl).toString();
        bestScore = score;
      } catch {
        // href invalido (mailto:, javascript:, etc.) — ignora
      }
    }
  }
  return best;
}

// Prompt 583 §D.1 — sitemap.xml first, before the nav-link scan: a
// sitemap lists every real URL on the site regardless of how (or whether)
// the homepage's own nav menu links to it, which is exactly what the
// nav-link scan below cannot see when a menu is rendered by JavaScript
// (the kimaventures.com/team case that motivated the fallback-paths list
// in the first place — a sitemap sidesteps that failure mode entirely
// rather than working around it after the fact).
//
// No cost, no model call: a plain XML fetch and a regex over <loc> text.
// Absent/unreachable sitemap (very common) is not an error — it just
// means this step finds nothing and the nav-link scan runs as before.
async function discoverTeamPageUrlViaSitemap(baseUrl: string): Promise<string | null> {
  let sitemapUrl: string;
  try {
    sitemapUrl = new URL('/sitemap.xml', baseUrl).toString();
  } catch {
    return null;
  }
  if (!(await isAllowedByRobots(sitemapUrl))) return null;
  // fetchPage() rejects a non-HTML content-type — sitemap.xml is served
  // as XML, so this reads the body directly rather than reusing fetchPage.
  let xml: string;
  // Prompt 627 §6.3 — where the sitemap ACTUALLY came from, which is not
  // always where we asked. Relative <loc> entries have to resolve against
  // the document that contains them, and a sitemap that redirected to
  // another host carries that host's paths, not ours.
  let sitemapFinalUrl = sitemapUrl;
  try {
    const res = await fetch(sitemapUrl, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    if (res.url) sitemapFinalUrl = res.url;
    xml = await res.text();
  } catch {
    return null;
  }
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
  // Prompt 627 §6.3 — a <loc> is NOT required to be absolute, and this is
  // the one discovery path that was handing its result straight to fetch()
  // without resolving it. firstfellow.com's sitemap lists `/team`, `/family`,
  // `/contact` — bare paths — so the job died on `Invalid URL: '/team'`
  // (3 jobs, still failing 2026-09-09) while a perfectly good team page sat
  // one `new URL()` away. Every other discovery path here already resolved;
  // this one just never did.
  const resolved: string[] = [];
  for (const loc of locs) {
    if (!TEAM_PAGE_PATTERN.test(loc)) continue;
    try {
      const u = new URL(loc, sitemapFinalUrl);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
      resolved.push(u.toString());
    } catch {
      // A <loc> we cannot make sense of is not an error worth failing on.
    }
  }
  if (resolved.length === 0) return null;
  // Shortest path wins — /team beats /team/jane-doe/bio, the same
  // "prefer the index page, not a deep sub-page" intuition the nav-link
  // scorer expresses via its href-length penalty.
  resolved.sort((a, b) => a.length - b.length);
  return resolved[0];
}

// Recurso barato quando discoverTeamPageUrl nao encontra nada (menu
// renderizado por JavaScript e o caso medido — kimaventures.com/team). Sem
// custo de modelo: so caminhos directos comuns, tentados por ordem.
const TEAM_PATH_FALLBACKS = ['/team', '/about', '/people', '/our-team', '/about-us', '/equipa'];

function looksLikeJsOnlyShell(html: string, extractedTextLength: number): boolean {
  const scriptCount = (html.match(/<script/gi) ?? []).length;
  return extractedTextLength < 200 && scriptCount > 5;
}

// ============================================================
// Regra geral (confirmada com o Nuno apos o incidente do linkedin_url de
// Faber): qualquer campo cujo valor nao exista literalmente no texto
// entregue ao modelo NAO pode ser pedido ao modelo como string livre. Ou
// entra no texto (como candidato de uma lista fechada), ou e extraido por
// codigo, ou nao se pede. htmlToText() descarta todos os href — por isso
// linkedin_url e individual_profile_url nunca estiveram, de facto, no texto
// que o modelo via, e o modelo preenchia-os por padrao a partir do nome
// (ex.: "brunoferreira" em vez do real "brunosommerferreira"). Estas
// funcoes extraem os candidatos reais por DOM, ANTES de qualquer chamada ao
// modelo; o modelo so pode escolher um da lista (passada no prompt), e o
// codigo valida a escolha contra essa mesma lista antes de gravar —
// gravando sempre o candidato do codigo, nunca a string do modelo, mesmo
// quando coincidem (mesmo principio D1(c) do bio_raw).
// ============================================================

// LinkedIn e sempre um dominio absoluto, por isso procura-se o padrao
// directamente na string do href (nao resolvida via new URL) — isto
// reconhece mesmo um href malformado/sem protocolo, como o encontrado em
// faber.vc/team/ ("www.linkedin.com/in/lara-branco-1b84b82b0", sem
// "https://"), que new URL(href, baseUrl) resolveria incorrectamente para
// dentro do proprio dominio do fundo em vez de o descartar ou corrigir.
function extractLinkedinCandidates(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (!doc) return [];
  const out = new Set<string>();
  const pattern = /linkedin\.com\/in\/([a-zA-Z0-9\-_%]+)/i;
  // Prompt 562b — `area` as well as `a`. An <area> is an image-map region and
  // carries href exactly like an anchor; DOM-wise it is simply not an <a>, so
  // querySelectorAll('a') never returned one.
  //
  // Found by re-running DN Capital after 562 and getting zero change on all
  // 37 people. Their site publishes each partner's LinkedIn through an image
  // map — `<area shape="rect" coords="5,4,44,48" href="…/in/raoul-oscar-fiano/">`
  // — with zero <a href> LinkedIn links on the page. Confirmed on raoul,
  // ianmarsh and johnhorton: 0 in <a>, 1 in <area>, each.
  //
  // This corrects 562's own diagnosis, which is worth stating because the
  // mistake is easy to repeat: that prompt concluded the code "had the URL in
  // hand and discarded it because the model did not echo it back". It did
  // not. The candidate list was empty. The measurement that produced the
  // wrong conclusion was a grep for `linkedin.com/in/` over the raw HTML,
  // which finds the string anywhere — including inside an <area>, a script
  // tag or a JSON blob — while this function only ever saw <a> elements.
  // Measuring with a different instrument than the code uses is how a real
  // href in the page and an empty candidate list looked like the same thing.
  //
  // Only this extractor is widened. There are three other
  // querySelectorAll('a') calls in this file (team-page discovery, internal
  // profile links, email candidates); an <area> is a plausible carrier for
  // some of them too, but each has its own matching rules and deserves its
  // own look rather than a blanket sweep.
  for (const a of [...doc.querySelectorAll('a, area')] as any[]) {
    const href = a.getAttribute('href');
    if (!href) continue;
    const m = href.match(pattern);
    if (m) out.add(`https://www.linkedin.com/in/${m[1].replace(/\/+$/, '')}`);
  }
  return [...out];
}

// Paginas individuais de perfil sao internas ao proprio site (nunca um
// dominio fixo como o LinkedIn) — por isso, ao contrario do LinkedIn, tem
// de se resolver o href contra baseUrl e ficar so com o mesmo origin.
function extractInternalLinkCandidates(html: string, baseUrl: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (!doc) return [];
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }
  const out = new Set<string>();
  for (const a of [...doc.querySelectorAll('a')] as any[]) {
    const href = a.getAttribute('href');
    if (!href) continue;
    if (/^(mailto|tel|javascript):/i.test(href)) continue;
    if (/linkedin\.com/i.test(href)) continue;
    try {
      const resolved = new URL(href, baseUrl);
      if (resolved.origin !== base.origin) continue;
      out.add(resolved.toString());
    } catch {
      // href invalido — ignora
    }
  }
  return [...out];
}

// Prompt 284 §2 — mesma disciplina D1 estendida do linkedin_url/individual_
// profile_url (ver o bloco de comentario acima dessas duas funcoes): um
// email so pode ser "verified" se vier de uma lista de candidatos extraida
// por CODIGO da propria pagina, nunca de texto livre do modelo. Duas
// fontes, porque o caso real (Nalka: "Email: sigrid.fjermeros@nalka.com")
// e texto visivel simples, sem <a href="mailto:"> nenhum — so procurar
// mailto: teria falhado exactamente no caso que motivou este pedido.
// htmlToText() e o mesmo texto que o modelo realmente le, por isso e onde
// o regex de texto livre corre, nao no html cru.
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

function extractEmailCandidates(html: string): string[] {
  const out = new Set<string>();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (doc) {
    for (const a of [...doc.querySelectorAll('a')] as any[]) {
      const href = a.getAttribute('href');
      if (!href || !/^mailto:/i.test(href)) continue;
      const addr = href.replace(/^mailto:/i, '').split('?')[0].trim();
      if (addr) out.add(addr.toLowerCase());
    }
  }
  for (const m of htmlToText(html).matchAll(EMAIL_PATTERN)) out.add(m[0].toLowerCase());
  return [...out];
}

function formatCandidateList(candidates: string[]): string {
  return candidates.length ? candidates.map((c) => `- ${c}`).join('\n') : '(nenhum encontrado nesta pagina)';
}

// Devolve sempre o candidato do CODIGO, nunca a string do modelo — mesmo
// quando coincidem, para que o valor gravado seja sempre, por construcao,
// um href real extraido da pagina.
function pickMatchingLinkedinCandidate(modelValue: string | null, candidates: string[]): string | null {
  if (!modelValue) return null;
  const target = normalizeLinkedinForLookup(modelValue);
  return candidates.find((c) => normalizeLinkedinForLookup(c) === target) ?? null;
}

// Prompt 562 — o unico caso em que nao e preciso o modelo escolher: UMA
// pagina individual, de UMA pessoa, com EXACTAMENTE um link de LinkedIn.
// Nao ha ambiguidade sobre a quem pertence, e o valor continua a vir do DOM
// da pagina, nunca do modelo — a disciplina D1 do incidente Faber esta
// intacta (o que ela proibe e o modelo INVENTAR um valor a partir do nome,
// nao o codigo ler um href real).
//
// Porque e que isto faltava: pickMatchingLinkedinCandidate devolve null
// quando o modelo devolve null, e a chamada da pagina individual
// (extract_person_bio) e focada na biografia — na pratica devolvia null no
// linkedin_url mesmo com um unico candidato listado no prompt. O codigo
// tinha o URL verdadeiro na mao, extraido por DOM, e deitava-o fora. Medido
// na DN Capital: 10 paginas lidas (o tecto por entidade), 10 candidatos
// reais, 0 gravados.
//
// Deliberadamente NAO se aplica a pagina de equipa: la ha dezenas de links e
// atribuir um deles a uma pessoa exigiria adivinhar. So o caso de um-para-um
// e seguro.
function soleLinkedinCandidateOnPersonPage(candidates: string[]): string | null {
  return candidates.length === 1 ? candidates[0] : null;
}

function pickMatchingUrlCandidate(modelValue: string | null, candidates: string[]): string | null {
  if (!modelValue) return null;
  const norm = (u: string) => u.replace(/\/+$/, '');
  const target = norm(modelValue);
  return candidates.find((c) => norm(c) === target) ?? null;
}

function pickMatchingEmailCandidate(modelValue: string | null, candidates: string[]): string | null {
  if (!modelValue) return null;
  const target = modelValue.trim().toLowerCase();
  return candidates.find((c) => c.trim().toLowerCase() === target) ?? null;
}

// Para campos de texto livre (nome, cargo, canal de submissao) que devem
// ser literais mas nao tem um dominio fixo para gerar uma lista fechada de
// candidatos — verifica presenca no texto normalizado da pagina.
function isLiterallyOnPage(value: string | null | undefined, pageTextNormalized: string): boolean {
  if (!value) return false;
  return pageTextNormalized.includes(normalizeForMatch(value));
}

// ============================================================
// Anthropic Messages API — fetch directo (sem SDK, edge function Deno).
// claude-haiku-4-5 e claude-sonnet-5 sao os IDs correntes (nao datados).
// ============================================================
async function callClaude(opts: {
  model: string;
  system: string;
  messages: any[];
  tools?: any[];
  toolChoice?: any;
  timeoutMs?: number;
  maxTokens?: number;
}): Promise<any> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 4096,
      system: opts.system,
      messages: opts.messages,
      ...(opts.tools ? { tools: opts.tools } : {}),
      ...(opts.toolChoice ? { tool_choice: opts.toolChoice } : {}),
    }),
    // 60s (default) chega para as chamadas de extraccao da Camada 1. A
    // chamada de pesquisa da Camada 2 (web_search) mede-se diferente: o
    // servidor da Anthropic pode fazer varias pesquisas dentro da MESMA
    // chamada ate max_uses, e isso ultrapassa 60s com frequencia — medido
    // no piloto, 3 tentativas seguidas com "Signal timed out." no mesmo
    // job antes de se perceber que nao era falha transitoria de rede.
    signal: AbortSignal.timeout(opts.timeoutMs ?? 60000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`anthropic_${res.status}: ${body.slice(0, 500)}`);
  }
  return await res.json();
}

function extractToolInput(response: any, toolName: string): any | null {
  const block = (response.content ?? []).find((b: any) => b.type === 'tool_use' && b.name === toolName);
  return block?.input ?? null;
}

// ============================================================
// Camada 1 — tool schemas
// ============================================================
const EXTRACT_TEAM_TOOL = {
  name: 'extract_team',
  description:
    'Regista as pessoas e factos do fundo encontrados NESTA pagina especifica. bio_start_anchor/bio_end_anchor tem de ser copiados literalmente do texto da pagina (6-10 palavras cada) — nunca parafraseados. linkedin_url, individual_profile_url e email tem de ser copiados EXACTAMENTE (byte a byte) de uma das listas de candidatos fornecidas no texto — nunca inventados, nunca derivados do nome da pessoa. Se nenhum candidato corresponder a esta pessoa, usa null.',
  input_schema: {
    type: 'object',
    properties: {
      fund: {
        type: 'object',
        properties: {
          thesis: { type: ['string', 'null'] },
          sectors: { type: 'array', items: { type: 'string' } },
          submission_channel: { type: ['string', 'null'], description: 'email ou URL de submissao de pitches — so se aparecer literalmente no texto da pagina' },
          submission_channel_type: { type: ['string', 'null'] },
          // Prompt 627 §2.5 — 106 entidades sem pais nenhum, e 40 delas
          // verificadas. A mesma disciplina literal do submission_channel:
          // so se o pais aparecer ESCRITO na pagina (rodape, morada, pagina
          // de contactos). Nunca deduzido do TLD do dominio — .com nao diz
          // nada e .vc diz menos ainda — e nunca do nome do fundo.
          hq_country: { type: ['string', 'null'], description: 'pais da sede, so se aparecer literalmente escrito no texto da pagina (rodape, morada, contactos). Nome do pais ou codigo ISO-2. NUNCA deduzido do dominio, do TLD, do nome do fundo ou da lingua da pagina — se nao estiver escrito, null' },
        },
      },
      people: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            full_name: { type: 'string' },
            title: { type: ['string', 'null'] },
            linkedin_url: { type: ['string', 'null'], description: 'copiado EXACTAMENTE de uma das linhas em "Links LinkedIn encontrados nesta pagina" abaixo, ou null' },
            individual_profile_url: { type: ['string', 'null'], description: 'copiado EXACTAMENTE de uma das linhas em "Links de perfil individual encontrados nesta pagina" abaixo, ou null' },
            // Prompt 284 §2 — mesma disciplina: copiado de uma lista fechada
            // de candidatos ja extraidos do texto, nunca escrito livremente.
            // So um email PESSOAL desta pessoa especifica, nunca um email
            // generico do fundo (info@, contact@, hello@, press@) mesmo que
            // esteja na mesma pagina — esse nao pertence a ninguem em concreto.
            email: { type: ['string', 'null'], description: 'copiado EXACTAMENTE de uma das linhas em "Emails encontrados nesta pagina" abaixo, so se for pessoal desta pessoa (nunca um email generico do fundo), ou null' },
            bio_start_anchor: { type: ['string', 'null'], description: 'primeiras 6-10 palavras da bio desta pessoa, copiadas exactamente do texto da pagina' },
            bio_end_anchor: { type: ['string', 'null'], description: 'ultimas 6-10 palavras da bio desta pessoa, copiadas exactamente do texto da pagina' },
          },
          required: ['full_name'],
        },
      },
    },
    required: ['people', 'fund'],
  },
};

const EXTRACT_PERSON_BIO_TOOL = {
  name: 'extract_person_bio',
  description:
    'Regista a biografia desta pessoa a partir da sua pagina individual. bio_start_anchor/bio_end_anchor tem de ser copiados literalmente do texto da pagina. linkedin_url e email tem de ser copiados EXACTAMENTE de uma das linhas nas listas de candidatos fornecidas — nunca inventados.',
  input_schema: {
    type: 'object',
    properties: {
      linkedin_url: { type: ['string', 'null'] },
      // Prompt 284 §2 — mesma lista fechada, mesma disciplina que no
      // extract_team acima: so pessoal, nunca um email generico do fundo.
      email: { type: ['string', 'null'], description: 'copiado EXACTAMENTE de uma das linhas em "Emails encontrados nesta pagina" abaixo, so se for pessoal desta pessoa, ou null' },
      bio_start_anchor: { type: ['string', 'null'] },
      bio_end_anchor: { type: ['string', 'null'] },
    },
  },
};

const RECORD_RESEARCH_TOOL = {
  name: 'record_research',
  description: 'Regista a sintese da investigacao sobre esta pessoa, com base apenas no texto das fontes lidas.',
  input_schema: {
    type: 'object',
    properties: {
      // Prompt 281 §2 — o critério que faltava, para além da língua (280).
      // A 2ª corrida real gravou 4 hooks tecnicamente cumpridores da regra
      // "só com fonte lida" mas inúteis: o nome do fundo veio do metro de
      // Londres, uma opinião sobre Schengen/portos — anedotas biográficas
      // interessantes, não algo que sirva de abertura a uma aproximação de
      // investimento. A descrição abaixo é a MESMA regra que o system
      // prompt da síntese repete (ver mais abaixo) — descrita duas vezes de
      // propósito, no schema e no system prompt, mesmo padrão já usado
      // para as âncoras de bio_start_anchor/bio_end_anchor na Camada 1.
      hook: {
        type: ['string', 'null'],
        description: 'Só preenche se for: (a) específico a ESTA pessoa (não um facto genérico sobre o fundo); (b) recente ou ainda actual, não uma história antiga sem relevância hoje; (c) relevante para uma aproximação de investimento — a tese dela, um deal ou afirmação pública sobre o sector, um interesse de investimento declarado. Anedotas biográficas (origem do nome do fundo, histórias de família, opiniões fora do âmbito de investimento) NÃO contam, mesmo que venham de uma fonte lida — nesse caso deixa null. Vazio honesto é melhor que preenchido mas inútil.',
      },
      intro_path: { type: ['string', 'null'] },
      watch_outs: { type: ['string', 'null'] },
      kill_words: { type: 'array', items: { type: 'string' }, description: 'Phrases that make this person disengage. The hook above must not contain any of them.' },
      // Prompt 634 §3.2 — same rule in the schema AND the system prompt,
      // the pattern the hook bar already uses.
      background: { type: ['string', 'null'], description: 'Professional background only. Never record health conditions, religion, ethnicity, political or union affiliation, or sexual orientation of the person, even when the source states them and even when the person made them public. Investment focus areas are not personal attributes: "invests in diabetes care" is allowed, "was diagnosed with diabetes" is not. Leave the field empty rather than record it.' },
      email_guess: { type: ['string', 'null'] },
      email_guess_confidence: { type: ['string', 'null'], enum: ['high', 'medium', 'low', null] },
    },
  },
};

// Prompt 583 §B.1a — the cheap first step: a hook straight from the bio
// team page enrichment already captured, no web call at all. Same D1
// discipline as everywhere else in this file — hook_evidence_quote must
// be copied verbatim from the bio text given, checked for literal
// presence before the hook is accepted (see processPersonJob), so a
// confident-sounding but fabricated "evidence" quote can't slip a hook
// through that the bio never actually supported.
const EXTRACT_HOOK_FROM_BIO_TOOL = {
  name: 'extract_hook_from_bio',
  description:
    'Extracts a hook and supporting facts from a biography, with no web research. hook_evidence_quote must be copied EXACTLY from the bio text given — never paraphrased, never summarized — since it is what proves the hook came from this specific bio.',
  input_schema: {
    type: 'object',
    properties: {
      hook: {
        type: ['string', 'null'],
        description: 'Same bar as always: (a) specific to THIS person, not a generic fact about the fund; (b) recent or still current; (c) relevant to an investment approach. Leave null rather than force a weak one.',
      },
      hook_evidence_quote: { type: ['string', 'null'], description: 'the exact phrase from the bio that supports the hook, copied verbatim — required whenever hook is non-null' },
      background: { type: ['string', 'null'], description: 'Professional background only. Never record health conditions, religion, ethnicity, political or union affiliation, or sexual orientation of the person, even when the source states them and even when the person made them public. Investment focus areas are not personal attributes: "invests in diabetes care" is allowed, "was diagnosed with diabetes" is not. Leave the field empty rather than record it.' },
      intro_path: { type: ['string', 'null'] },
      watch_outs: { type: ['string', 'null'] },
      kill_words: { type: 'array', items: { type: 'string' } },
      confidence: { type: 'number', description: '0 to 1: how confident this bio alone gives a genuinely good, specific, current hook. Below 0.6, a web search follow-up will run — score honestly rather than inflating this to avoid it.' },
    },
  },
};

// Falha de desenho identificada pelo Nuno apos o piloto de 3 angels: a
// Camada 2 pesquisava mas nunca lia — sintetizava a partir de titulos e
// snippets de resultados de pesquisa, que nao dao material para um gancho.
// No piloto manual do Nuno, a qualidade veio de abrir e ler um artigo
// (as citacoes da Sarah Kunst vieram do texto da peca do technical.ly, nao
// de um snippet). Este tool escolhe ate 3 fontes reais para ler na integra
// antes de sintetizar — mesma disciplina de "lista fechada, o codigo
// valida" que ja se aplica a linkedin_url/individual_profile_url na
// Camada 1: o modelo so pode escolher URLs que ja existem na lista de
// candidatos, o codigo confirma antes de ir buscar a pagina.
const SELECT_SOURCES_TOOL = {
  name: 'select_sources',
  description:
    'Escolhe ate 3 fontes desta lista para ler na integra antes de sintetizar. Prefere entrevistas, perfis pessoais, biografias e anuncios — evita agregadores de dados (crunchbase, pitchbook, tracxn, cbinsights, angel.co, endole, redes sociais). Copia os URLs EXACTAMENTE da lista fornecida.',
  input_schema: {
    type: 'object',
    properties: {
      urls: { type: 'array', items: { type: 'string' }, description: 'ate 3 URLs, copiados exactamente da lista de fontes fornecida' },
    },
    required: ['urls'],
  },
};

// Falha de desenho identificada pelo Nuno: max_uses e o NOSSO proprio
// tecto, nao um limite da Anthropic ou da rede — mas o modelo, ao esgota-lo,
// recebe um erro e conclui (com toda a logica) que a ferramenta de
// pesquisa esta indisponivel, escrevendo isso literalmente nos watch_outs
// em vez de trabalhar com os resultados que ja tinha. Corrigido em dois
// pontos: max_uses subiu de 3 para 10, e o prompt diz explicitamente que
// atingir o tecto e normal e esperado.
const SEARCH_SYSTEM_PROMPT =
  'Es um assistente de investigacao. Podes fazer varias pesquisas nesta chamada, ate ao limite disponivel — atingir esse limite e normal e esperado, NAO significa que a ferramenta de pesquisa esta indisponivel ou avariada. Quando isso acontecer, continua com os resultados que ja tens em vez de reportar falha. So relatas factos que encontraste nas fontes pesquisadas — nunca inventas.';

// ============================================================
// Camada 1 — processa uma catalog_entities.
// ============================================================

// Prompt 284 §2 — catalog_people_research.email_verified e uma migracao
// propose-only (0198), aplicada pelo Nuno no seu proprio ritmo, como
// qualquer outra deste repositorio — este worker (Deno, fora do Next app)
// nao tem acesso ao makeCapabilityProbe da app, por isso reimplementa o
// mesmo principio: uma sonda barata, cache positivo por instancia (uma
// coluna nao deixa de existir), sem cache negativo (o proximo cold start,
// ou mesmo a proxima invocacao se a migracao acabou de ser aplicada,
// volta a sondar). Sem isto, um upsert que inclua email_verified antes da
// migracao aterrar falharia SILENCIOSAMENTE (supabase-js nao lanca em erro
// de query) e arrastaria bio_raw consigo, porque os dois campos partilham
// o mesmo upsert — pior do que so nao gravar o email.
let emailVerifiedColumnAvailable: boolean | null = null;
async function isEmailVerifiedColumnAvailable(): Promise<boolean> {
  if (emailVerifiedColumnAvailable === true) return true;
  const { error } = await supabase.from('catalog_people_research').select('email_verified').limit(1);
  emailVerifiedColumnAvailable = !error;
  return emailVerifiedColumnAvailable;
}

async function processEntityJob(job: any, dryRun: boolean, telemetry: Telemetry, batchId: string) {
  const { data: entity, error: entityErr } = await supabase
    .from('catalog_entities')
    .select('id, name, website, is_test, hq_country, verified_fields, team_page_url')
    .eq('id', job.target_id)
    .single();
  if (entityErr || !entity) throw new Error(`entity_not_found: ${entityErr?.message ?? job.target_id}`);
  if (entity.is_test) return { status: 'skipped', reason: 'is_test entity, skipped by policy' };
  if (!entity.website) return { status: 'skipped', reason: 'no_website' };

  let homepageUrl: string;
  try {
    homepageUrl = new URL(entity.website).toString();
  } catch {
    return { status: 'skipped', reason: 'invalid_website_url' };
  }

  if (!(await isAllowedByRobots(homepageUrl))) return { status: 'skipped', reason: 'robots_disallowed' };

  const homepage = await fetchPageWithBlockRetry(homepageUrl);
  if (!homepage.ok) return { status: homepage.blocked ? 'blocked' : 'failed', reason: homepage.reason };
  telemetry.webCalls += 1;

  // Prompt 583 §D.1 — sitemap first: it lists every real URL on the site
  // regardless of how (or whether) the homepage's own nav menu links to
  // it, which sidesteps the exact failure mode TEAM_PATH_FALLBACKS below
  // was already working around (a JS-rendered menu the nav-link scan
  // can't see into). Falls through to the nav-link scan when the sitemap
  // is absent or has nothing matching — very common, not an error.
  // Prompt 627 §6.3 — ONE BAD CANDIDATE USED TO END THE ENTITY. The sitemap
  // and nav-link strategies each produce a guess; if that guess failed to
  // fetch, the function returned `failed` and the remaining strategies —
  // fixed paths, the /en/ variant — never ran, even though the whole reason
  // they exist is that the earlier guesses are unreliable.
  //
  // Dutch Founders Fund is the case that shows why this matters and why the
  // fix is here rather than in our URL building: dutchfoundersfund.com
  // answers /sitemap.xml with `301 → https://www.dff.venturessitemap.xml`
  // and /team with `301 → https://www.dff.venturesteam`. THEIR redirect rule
  // concatenates without a slash. We cannot fix a remote server's 301, and
  // no amount of `new URL()` on our side changes what it returns — but a
  // dead guess should cost one wasted fetch, not the whole fund. 7 jobs have
  // been failing on that one host since 8 August.
  type TeamHit = { url: string; page: { ok: true; html: string }; text: string };
  const attempted = new Set<string>();
  // Kept so a rejected candidate still explains itself. Before this change a
  // JS-only shell or an empty page ended the job with its own reason; now the
  // cascade continues past it, and without this the outcome would flatten to
  // a bare `team_page_not_found` and the 5 `team_page_empty` jobs on record
  // would stop being distinguishable from the 150 genuine misses.
  let lastReject: string | null = null;

  // Returns the hit rather than assigning to an outer variable: assignment
  // inside a closure defeats TypeScript's narrowing, and the later code
  // depends on knowing this is non-null.
  const tryCandidate = async (candidate: string | null, withBlockRetry: boolean): Promise<TeamHit | null> => {
    if (!candidate || attempted.has(candidate)) return null;
    attempted.add(candidate);
    if (!(await isAllowedByRobots(candidate))) return null;
    const fetched = withBlockRetry ? await fetchPageWithBlockRetry(candidate) : await fetchPage(candidate);
    telemetry.webCalls += 1;
    if (!fetched.ok) return null;
    // The quality gates that used to live after the cascade now decide
    // whether a candidate COUNTS, which is what lets the next strategy run:
    // a JS-only shell at /about is a reason to keep looking, not a verdict
    // on the fund.
    const text = htmlToText(fetched.html);
    if (looksLikeJsOnlyShell(fetched.html, text.length)) { lastReject = 'js_only_site'; return null; }
    if (text.length < 50) { lastReject = 'team_page_empty'; return null; }
    return { url: candidate, page: fetched, text };
  };

  // Prompt 642 §4 / 627 §6.1 — a team page already on the row (33 of them written by
  // hand on 2026-09-09) is the first candidate, not a value to rediscover.
  let hit: TeamHit | null = await tryCandidate(entity.team_page_url ?? null, true);
  if (!hit) {
    const sitemapCandidate = await discoverTeamPageUrlViaSitemap(homepageUrl);
    telemetry.webCalls += 1;
    hit = await tryCandidate(sitemapCandidate, true);
  }

  if (!hit) hit = await tryCandidate(discoverTeamPageUrl(homepage.html, homepageUrl), true);

  if (!hit) {
    // Recurso barato: a descoberta por link falhou. Caso real medido antes
    // da corrida paga — kimaventures.com/team existe e tem gente (Xavier
    // Niel, Jerémie Berrebi, Michel Sassano, Vincent Jacobs), mas o menu e
    // renderizado por JavaScript, por isso a heuristica de links na
    // homepage nunca encontrou o href. Tenta caminhos directos comuns antes
    // de desistir — sem custo de modelo, aceita o primeiro que devolva HTML
    // com texto suficiente.
    for (const path of TEAM_PATH_FALLBACKS) {
      let candidateUrl: string;
      try {
        candidateUrl = new URL(path, homepageUrl).toString();
      } catch {
        continue;
      }
      hit = await tryCandidate(candidateUrl, false);
      if (hit) break;
    }
  }

  // Prompt 583 §D.1 — "seguir uma variante de lingua (/en/)": nothing
  // found in the site's default language across sitemap + nav-link scan +
  // fixed paths — try once more against an /en/ prefix before giving up.
  // The sitemap search above already covers every locale (it matches any
  // <loc> containing the pattern, never scoped to a path prefix, and
  // sitemap.xml itself always resolves from the origin regardless of what
  // path is passed as base) — repeating it here would just re-fetch the
  // identical URL for an identical result, so only the nav-link scan is
  // worth running again, against the /en/ homepage specifically.
  if (!hit) {
    let enHomepageUrl: string | null = null;
    try {
      enHomepageUrl = new URL('/en/', homepageUrl).toString();
    } catch {
      enHomepageUrl = null;
    }
    if (enHomepageUrl && enHomepageUrl !== homepageUrl && (await isAllowedByRobots(enHomepageUrl))) {
      const enHomepage = await fetchPage(enHomepageUrl);
      telemetry.webCalls += 1;
      if (enHomepage.ok) hit = await tryCandidate(discoverTeamPageUrl(enHomepage.html, enHomepageUrl), false);
    }
  }

  // Prompt 627 §6.1 — RECORD THE ANSWER, INCLUDING WHEN THE ANSWER IS "NONE".
  // The word `team_page_url` did not appear once in this file: the cascade
  // above ran sitemap + nav-link + six fixed paths + an /en/ variant, used
  // what it found, and threw it away — 0 of 762 rows had it stored. The
  // dossier route (api/backoffice/catalog/people/[id]) then re-derived the
  // same URL on its own 30-day TTL, because as far as it could tell nobody
  // had ever looked. Writing null WITH a timestamp is the same cache's way
  // of saying "checked, nothing there", so the not-found path records too —
  // otherwise the 150 entities that legitimately have no reachable team page
  // pay for the full cascade again on every future run.
  if (!dryRun) {
    // Prompt 642 §4 — a human-stamped team_page_url is neither replaced nor nulled;
    // only the checked-at timestamp moves.
    const teamPatch: Record<string, unknown> = { team_page_checked_at: new Date().toISOString() };
    if (!isHumanVerified(entity.verified_fields, 'team_page_url')) teamPatch.team_page_url = hit?.url ?? null;
    await supabase.from('catalog_entities').update(teamPatch).eq('id', entity.id);
  }

  if (!hit) return { status: 'skipped', reason: lastReject ?? 'team_page_not_found' };

  const teamUrl = hit.url;
  const teamPage = hit.page;
  const teamText = hit.text;

  if (dryRun) {
    return {
      status: 'dry_run',
      reason: null,
      dryRunReport: { homepageUrl, teamUrl, teamTextLength: teamText.length },
    };
  }

  // D1 estendido ao linkedin_url/individual_profile_url (incidente Faber,
  // confirmado com o Nuno): os candidatos reais extraem-se por codigo,
  // ANTES da chamada, e entram no proprio texto do prompt — o modelo so
  // pode copiar um destes, nunca inventar a partir do nome.
  // Prompt 284 §2 — email entra na mesma disciplina, mesmo padrao de
  // extraccao-antes-da-chamada (caso real: Nalka Invest publica
  // "Email: sigrid.fjermeros@nalka.com" na propria pagina de equipa —
  // fonte primaria oficial, nao um guess).
  const linkedinCandidates = extractLinkedinCandidates(teamPage.html);
  const profileCandidates = extractInternalLinkCandidates(teamPage.html, teamUrl);
  const emailCandidates = extractEmailCandidates(teamPage.html);

  const extraction = await callClaude({
    model: LAYER1_MODEL,
    system:
      'Extrai pessoas e factos do fundo a partir do texto de uma pagina de equipa de venture capital. As ancoras de biografia (inicio/fim) tem de ser copiadas EXACTAMENTE do texto dado — nunca parafraseadas, nunca resumidas. Se uma pessoa nao tiver biografia visivel, deixa as ancoras a null. linkedin_url, individual_profile_url e email tem de vir EXACTAMENTE das listas de candidatos fornecidas no texto — nunca inventados a partir do nome da pessoa. email so se for pessoal desta pessoa, nunca um endereco generico do fundo (info@, contact@, hello@, press@).',
    messages: [
      {
        role: 'user',
        content: `URL: ${teamUrl}\n\nTexto da pagina:\n${teamText}\n\nLinks LinkedIn encontrados nesta pagina (usa um destes por pessoa, ou null se nenhum corresponder):\n${formatCandidateList(linkedinCandidates)}\n\nLinks de perfil individual encontrados nesta pagina (usa um destes, ou null):\n${formatCandidateList(profileCandidates)}\n\nEmails encontrados nesta pagina (usa um destes se for pessoal desta pessoa, ou null):\n${formatCandidateList(emailCandidates)}`,
      },
    ],
    tools: [EXTRACT_TEAM_TOOL],
    toolChoice: { type: 'tool', name: 'extract_team' },
  });
  addUsage(telemetry, LAYER1_MODEL, extraction.usage);

  const parsed = extractToolInput(extraction, 'extract_team');
  if (!parsed) throw new Error('extraction_validation_failed: no tool_use block returned');

  // catalog_entities: thesis/sectors sao sintese (nao literais por
  // natureza — risco residual diferente do das URLs, nao coberto por esta
  // correccao, ver nota no relatorio). submission_channel TEM de ser
  // literal: se nao aparecer na pagina, descarta-se em vez de gravar sem prova.
  const fundPatch: Record<string, unknown> = {};
  if (parsed.fund?.thesis) fundPatch.thesis = parsed.fund.thesis;
  if (parsed.fund?.sectors?.length) fundPatch.sectors = parsed.fund.sectors;
  const submissionChannel = isLiterallyOnPage(parsed.fund?.submission_channel, teamText) ? parsed.fund.submission_channel : null;
  if (submissionChannel) {
    fundPatch.submission_channel = submissionChannel;
    if (parsed.fund?.submission_channel_type) fundPatch.submission_channel_type = parsed.fund.submission_channel_type;
  }

  // Prompt 627 §2.5 — country, under the same literal rule as the submission
  // channel, and only when the column is still empty: a value already stored
  // was either curated by hand or came from a better source than a footer.
  //
  // NORMALISED BY THE DATABASE, NOT HERE. Migration 20260909053000 put the
  // country map in ONE place (normalize_country_code) precisely so it cannot
  // drift, and §2.1 is explicit that a second copy is the failure mode. A
  // literal map in this file would be that second copy. It is also no longer
  // optional: catalog_entities now carries a CHECK that hq_country matches
  // ^[A-Z]{2}$, so writing the string "Germany" straight from the page would
  // throw and fail the whole job. One RPC per entity that found a country —
  // rare, and free next to the model call above.
  const rawCountry = isLiterallyOnPage(parsed.fund?.hq_country, teamText) ? parsed.fund.hq_country : null;
  if (rawCountry && !entity.hq_country) {
    const { data: normalisedCountry } = await supabase.rpc('normalize_country_code', { p: rawCountry });
    // An unrecognised country normalises to null, and null is the honest
    // answer — better than a code we guessed from a word we did not know.
    if (normalisedCountry) fundPatch.hq_country = normalisedCountry;
  }
  // Prompt 642 §4 — nothing a human stamped in verified_fields is refreshed by the model;
  // what carries no level (AI-written or empty) is refreshed as before.
  const fundGuard = stripHumanVerified(fundPatch, entity.verified_fields as Record<string, unknown> | null);
  if (fundGuard.protectedKeys.length) console.log(`[human-guard] entity ${entity.id}: kept human-verified ${fundGuard.protectedKeys.join(', ')}`);
  if (Object.keys(fundGuard.kept).length) {
    await supabase.from('catalog_entities').update(fundGuard.kept).eq('id', entity.id);
  }
  if (submissionChannel) {
    await supabase.from('catalog_entity_enrichment_sources').insert({
      entity_id: entity.id,
      source_url: teamUrl,
      source_type: 'team_page',
      supports: 'submission_channel',
      quality: 'direct',
      batch_id: batchId,
    });
  }

  const emailVerifiedAvailable = await isEmailVerifiedColumnAvailable();
  let peopleProcessed = 0;
  let peopleWithBio = 0;
  const affiliationsCreated: string[] = [];

  for (const p of parsed.people ?? []) {
    // Nome e a ancora de identidade da pessoa — se nao aparecer literalmente
    // na pagina, nao ha base para gravar nada sobre ela.
    if (!isLiterallyOnPage(p.full_name, teamText)) continue;
    // Cargo fica por confirmar sem invalidar a pessoa inteira — so se
    // esconde o campo, nao se descarta o registo.
    const title = isLiterallyOnPage(p.title, teamText) ? p.title : null;
    // Grava sempre o candidato do codigo, nunca a string do modelo, mesmo
    // quando coincidem (mesmo principio D1(c) do bio_raw).
    let linkedinUrl = pickMatchingLinkedinCandidate(p.linkedin_url, linkedinCandidates);
    const individualProfileUrl = pickMatchingUrlCandidate(p.individual_profile_url, profileCandidates);
    // Prompt 284 §2 — same code-verified-candidate discipline as linkedinUrl
    // above: a real, published address, never the model's raw string.
    let email = pickMatchingEmailCandidate(p.email, emailCandidates);
    let emailSourceUrl = teamUrl;

    let bioRaw = sliceByAnchors(teamText, p.bio_start_anchor, p.bio_end_anchor);
    let bioSourceUrl = teamUrl;

    // D1-b: escala so para ESSA pessoa, so uma chamada, e so contra o texto
    // DAQUELA pagina.
    //
    // Prompt 562 — a condicao era so a bio, e a pagina individual e tambem o
    // unico sitio onde um linkedin_url em falta pode aparecer. Caso real (DN
    // Capital, 04/09): 37 pessoas, 0 com linkedin na base de dados, e
    // dncapital.com/<pessoa> tem 1 link de LinkedIn cada. Quem tinha bio
    // longa na pagina de equipa nunca via a sua pagina individual lida, por
    // isso o link ficava por apanhar — nao por a fonte nao o ter, mas por
    // ninguem ir la. Falta de linkedin passa a ser motivo de escalada tal
    // como bio curta; o tecto MAX_PROFILE_PAGES_PER_ENTITY continua a ser o
    // travao de custo, inalterado.
    const needsBio = !bioRaw || bioRaw.length < BIO_LENGTH_THRESHOLD;
    if ((needsBio || !linkedinUrl) && individualProfileUrl && peopleProcessed < MAX_PROFILE_PAGES_PER_ENTITY) {
      if (await isAllowedByRobots(individualProfileUrl)) {
        const profilePage = await fetchPage(individualProfileUrl);
        if (profilePage.ok) {
          telemetry.webCalls += 1;
          const profileText = htmlToText(profilePage.html);
          if (profileText.length > 50 && !looksLikeJsOnlyShell(profilePage.html, profileText.length)) {
            const profileLinkedinCandidates = extractLinkedinCandidates(profilePage.html);
            const profileEmailCandidates = extractEmailCandidates(profilePage.html);
            const profileExtraction = await callClaude({
              model: LAYER1_MODEL,
              system:
                'Extrai a biografia desta pessoa a partir do texto da sua pagina individual. As ancoras (inicio/fim) tem de ser copiadas EXACTAMENTE do texto dado. linkedin_url e email tem de vir EXACTAMENTE das listas de candidatos fornecidas — nunca inventados. email so se for pessoal desta pessoa, nunca um endereco generico do fundo.',
              messages: [
                {
                  role: 'user',
                  content: `Pessoa: ${p.full_name}\nURL: ${individualProfileUrl}\n\nTexto da pagina:\n${profileText}\n\nLinks LinkedIn encontrados nesta pagina:\n${formatCandidateList(profileLinkedinCandidates)}\n\nEmails encontrados nesta pagina:\n${formatCandidateList(profileEmailCandidates)}`,
                },
              ],
              tools: [EXTRACT_PERSON_BIO_TOOL],
              toolChoice: { type: 'tool', name: 'extract_person_bio' },
            });
            addUsage(telemetry, LAYER1_MODEL, profileExtraction.usage);
            const profileParsed = extractToolInput(profileExtraction, 'extract_person_bio');
            const profileBio = profileParsed ? sliceByAnchors(profileText, profileParsed.bio_start_anchor, profileParsed.bio_end_anchor) : null;
            if (profileBio && (!bioRaw || profileBio.length > bioRaw.length)) {
              bioRaw = profileBio;
              bioSourceUrl = individualProfileUrl;
            }
            if (!linkedinUrl) {
              // Prompt 562 — a escolha do modelo primeiro (continua a ser a
              // via normal); o candidato unico da propria pagina como rede
              // de seguranca quando o modelo devolve null, que era o caso em
              // praticamente todas as paginas individuais.
              linkedinUrl = pickMatchingLinkedinCandidate(profileParsed?.linkedin_url ?? null, profileLinkedinCandidates)
                ?? soleLinkedinCandidateOnPersonPage(profileLinkedinCandidates);
            }
            // Prompt 284 §2 — the team page wins if it already had one; the
            // individual page only fills a gap, same "keep the better one"
            // shape as bioRaw above (email has no length to compare, so
            // it's simply first-found-wins across the two pages).
            if (!email) {
              const profileEmail = pickMatchingEmailCandidate(profileParsed?.email ?? null, profileEmailCandidates);
              if (profileEmail) { email = profileEmail; emailSourceUrl = individualProfileUrl; }
            }
          }
        }
      }
    }

    // upsert catalog_people — chave: linkedin_url normalizado; sem
    // linkedin, chave secundaria nome+entidade (via afiliacao existente).
    let personId: string | null = null;
    if (linkedinUrl) {
      const normalized = normalizeLinkedinForLookup(linkedinUrl);
      const { data: existing } = await supabase.from('catalog_people').select('id').eq('linkedin_url_normalized', normalized).maybeSingle();
      personId = existing?.id ?? null;
    }
    if (!personId) {
      const { data: existingByName } = await supabase
        .from('catalog_person_affiliations')
        .select('person_id, catalog_people!inner(full_name)')
        .eq('entity_id', entity.id)
        .eq('catalog_people.full_name', p.full_name)
        .maybeSingle();
      personId = (existingByName as any)?.person_id ?? null;
    }

    let humanRecorded = false;
    const personPatch: Record<string, unknown> = { full_name: p.full_name, entity_id: entity.id, updated_at: new Date().toISOString() };
    // linkedinUrl only ever reaches here via pickMatchingLinkedinCandidate —
    // a code-verified candidate, never the model's raw string (D1 estendido)
    // — so accepting it here IS the verification; linkedin_verified must be
    // set in the same write. Bug found 2026-08-08 (Prompt 138 addendum): this
    // was missing, so linkedin_verified stayed false forever and the People
    // panel (which only shows LinkedIn when linkedin_verified=true) never
    // rendered a single link despite linkedin_url being correctly populated.
    // Existing rows were backfilled directly by Nuno; this is the forward fix.
    if (linkedinUrl) { personPatch.linkedin_url = linkedinUrl; personPatch.linkedin_verified = true; }
    if (bioRaw) personPatch.enrichment_status = 'enriched';

    if (personId) {
      // Prompt 642 §4 — a person a human recorded (source_kind = 'manual': the 640 import,
      // an admin) keeps their name, firm and LinkedIn; the model may only fill a blank
      // LinkedIn and mark the enrichment.
      const { data: existingPerson } = await supabase.from('catalog_people').select('source_kind, linkedin_url').eq('id', personId).maybeSingle();
      humanRecorded = existingPerson?.source_kind === 'manual';
      if (humanRecorded) {
        delete personPatch.full_name; delete personPatch.entity_id;
        if (existingPerson?.linkedin_url) { delete personPatch.linkedin_url; delete personPatch.linkedin_verified; }
      }
      // Prompt 646 §1.1 — a LinkedIn (or based_in) an admin stamped through
      // catalog_person_admin_set_field lives in research.verified_fields, not in
      // source_kind; read it the way the web path does, so a team page with a
      // different link never rewrites the admin's.
      const { data: existingStamp } = await supabase.from('catalog_people_research').select('verified_fields').eq('person_id', personId).maybeSingle();
      const personGuard = stripHumanVerified(personPatch, (existingStamp?.verified_fields ?? {}) as Record<string, unknown>);
      if (personGuard.protectedKeys.includes('linkedin_url')) delete personGuard.kept.linkedin_verified;
      await supabase.from('catalog_people').update(personGuard.kept).eq('id', personId);
    } else {
      const { data: created, error: createErr } = await supabase.from('catalog_people').insert(personPatch).select('id').single();
      if (createErr || !created) continue; // provavel colisao de linkedin_url unico — nao bloqueia o resto do lote
      personId = created.id;
    }

    // Prompt 643 §2 — one affiliation row per (person, firm) whatever its kind, and one
    // primary per person: the old upsert keyed on kind='other' inserted a second row (and a
    // second primary) beside an imported 'partner' row. Prompt 642 §4 — a human-recorded
    // title is kept; the page's title only fills or refreshes a machine one.
    const { data: existingAff } = await supabase.from('catalog_person_affiliations').select('id, title')
      .eq('person_id', personId).eq('entity_id', entity.id).order('is_primary', { ascending: false }).limit(1).maybeSingle();
    if (existingAff) {
      if (title && !humanRecorded && existingAff.title !== title) {
        await supabase.from('catalog_person_affiliations').update({ title, current: true }).eq('id', existingAff.id);
      }
    } else {
      const { count: primaries } = await supabase.from('catalog_person_affiliations').select('id', { count: 'exact', head: true }).eq('person_id', personId).eq('is_primary', true);
      await supabase.from('catalog_person_affiliations').insert({ person_id: personId, entity_id: entity.id, title: title ?? null, kind: 'other', is_primary: (primaries ?? 0) === 0, current: true });
    }
    affiliationsCreated.push(personId!); // sempre nao-nulo aqui: ramo if era truthy, ramo else fez `continue` antes se falhou

    // Prompt 284 §2 — email is independent of bio: a person can have one
    // without the other, so the upsert (and its provenance row) fires
    // whenever EITHER is present, not gated on bioRaw alone the way it was
    // before this prompt. emailVerifiedAvailable guards against the
    // pre-migration case (see isEmailVerifiedColumnAvailable above) —
    // still writes bio_raw normally even when the column doesn't exist yet.
    const canWriteEmail = !!email && emailVerifiedAvailable;
    if (bioRaw || canWriteEmail) {
      const researchPatch: Record<string, unknown> = { person_id: personId, updated_at: new Date().toISOString() };
      if (bioRaw) researchPatch.bio_raw = bioRaw;
      if (canWriteEmail) researchPatch.email_verified = email;
      await supabase.from('catalog_people_research').upsert(researchPatch, { onConflict: 'person_id' });
      if (bioRaw) {
        await supabase.from('catalog_entity_enrichment_sources').insert({
          entity_id: entity.id,
          person_id: personId,
          source_url: bioSourceUrl,
          source_type: 'team_page',
          supports: 'bio_raw',
          quality: 'verbatim_anchor_match',
          batch_id: batchId,
        });
        peopleWithBio++;
      }
      if (canWriteEmail) {
        await supabase.from('catalog_entity_enrichment_sources').insert({
          entity_id: entity.id,
          person_id: personId,
          source_url: emailSourceUrl,
          source_type: 'team_page',
          supports: 'email',
          quality: 'verbatim_literal_match',
          batch_id: batchId,
        });
      }
    }
    peopleProcessed++;
  }

  // Prompt 583 §D.3 — a team page that was successfully read but named
  // zero people is not the same outcome as a team actually captured: 99
  // entities were 'enriched' with nobody attached before this, invisible
  // to outreach_readiness's own "the data is good" bonus check (migration
  // 0300) in a way that read as "healthy", not "needs another look".
  const foundAnyone = affiliationsCreated.length > 0;
  await supabase
    .from('catalog_entities')
    .update({
      enrichment_status: foundAnyone ? 'enriched' : 'done_no_people',
      enriched_at: new Date().toISOString(),
      enrichment_stale_after: addMonths(new Date(), 6).toISOString(),
    })
    .eq('id', entity.id);

  return { status: 'done', reason: null, peopleProcessed, peopleWithBio, affiliationsCreated: affiliationsCreated.length };
}

function normalizeLinkedinForLookup(url: string): string {
  try {
    return url
      .toLowerCase()
      .trim()
      .replace(/\?.*$/, '')
      .replace(/\/(details|overlay)\/.*$/, '')
      .replace(/\/+$/, '');
  } catch {
    return url;
  }
}

function addMonths(d: Date, n: number): Date {
  const r = new Date(d);
  r.setMonth(r.getMonth() + n);
  return r;
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

// ============================================================
// Camada 2 — processa uma catalog_people (hook, D9: nunca le linkedin.com).
// ============================================================
// Prompt 583 §B.1a — literal-presence check on the bio-path's own
// evidence quote, same D1 discipline (isLiterallyOnPage) every other
// model-sourced value in this file already goes through. Compares against
// the SAME normalized text the bio was itself sliced from, so typographic
// quote/dash differences never cause a false rejection.
function bioHookIsSupported(hookEvidenceQuote: string | null | undefined, bioRawNormalized: string): boolean {
  if (!hookEvidenceQuote) return false;
  return bioRawNormalized.includes(normalizeForMatch(hookEvidenceQuote));
}

// Prompt 634 — every rejection is a row, never a silent null. The snippet
// goes to the admin-only audit log so the net can be tuned against what it
// actually caught; it never goes anywhere a founder reads.
async function recordFieldRejections(personId: string, path: 'bio' | 'web', rejected: { field: string; term: string; marker: string; snippet: string }[]) {
  for (const r of rejected) {
    try {
      await supabase.from('admin_audit_log').insert({
        admin_user_id: null, action: 'special_category_field_rejected', subject_type: 'catalog_person', subject_id: personId,
        detail: { path, field: r.field, term: r.term, marker: r.marker, snippet: r.snippet.slice(0, 200) },
      });
    } catch (e) {
      console.error('[special-category] audit insert failed', e);
    }
  }
}
async function recordKillWordRejection(personId: string, path: 'bio' | 'web', hook: string, killWord: string) {
  try {
    await supabase.from('admin_audit_log').insert({
      admin_user_id: null, action: 'hook_contains_kill_word', subject_type: 'catalog_person', subject_id: personId,
      detail: { path, kill_word: killWord, hook: hook.slice(0, 300) },
    });
  } catch (e) {
    console.error('[kill-word] audit insert failed', e);
  }
}

// Prompt 638 §3.2 — the third net. A hook that names the fund and never the
// person is the fund's thesis, and the thesis has its own column.
async function recordFundNotPersonRejection(personId: string, path: 'bio' | 'web', hook: string, entityMention: string) {
  try {
    await supabase.from('admin_audit_log').insert({
      admin_user_id: null, action: 'hook_about_fund_not_person', subject_type: 'catalog_person', subject_id: personId,
      detail: { path, entity_mention: entityMention, hook: hook.slice(0, 300) },
    });
  } catch (e) {
    console.error('[fund-not-person] audit insert failed', e);
  }
}

async function processPersonJob(job: any, dryRun: boolean, telemetry: Telemetry, batchId: string) {
  const { data: person, error: personErr } = await supabase.from('catalog_people').select('id, full_name, entity_id, linkedin_url').eq('id', job.target_id).single();
  if (personErr || !person) throw new Error(`person_not_found: ${personErr?.message ?? job.target_id}`);

  const { data: entity } = await supabase.from('catalog_entities').select('name, website, thesis, is_test').eq('id', person.entity_id).maybeSingle();
  if (entity?.is_test) return { status: 'skipped', reason: 'is_test entity, skipped by policy' };

  const { data: affiliation } = await supabase.from('catalog_person_affiliations').select('title').eq('person_id', person.id).eq('is_primary', true).maybeSingle();
  const { data: existingResearch } = await supabase.from('catalog_people_research').select('bio_raw, verified_fields, hook').eq('person_id', person.id).maybeSingle();
  const bioRaw = existingResearch?.bio_raw ?? null;
  // Prompt 646 §1.2 — withoutNulls stopped a run that finds nothing from erasing
  // an earlier hook, so the status must follow the text: none_found only when
  // no hook is left on the row.
  const hadHook = typeof existingResearch?.hook === 'string' && existingResearch.hook.trim() !== '';
  // Prompt 642 §4 — what a human stamped on this person; the model writes around it.
  const humanFields = (existingResearch?.verified_fields ?? {}) as Record<string, unknown>;
  const humanHook = isHumanVerified(humanFields, 'hook');
  // Prompt 638 §3.1 — a job the bio_only sweep enqueued stops after the bio
  // path, and stops SOFT: the person stays eligible for the mixed sweep.
  const bioOnly = job.mode === 'bio_only';
  // Prompt 638 §2 / §3.3 — what the run did goes on the job row, so the next
  // decision is measured on the population and not on the survivors.
  const guardRejections: string[] = [];
  let bioConfidenceRaw: number | null = null;
  let bioHookSupported: boolean | null = null;

  // Prompt 583 §B.3 — pre-verification with no model call at all: nothing
  // for a search to search FOR (no LinkedIn, no firm website — layer 1
  // already established the entity's website is reachable, since it can
  // only reach 'enriched' by successfully fetching it, so "no website on
  // file" is the honest proxy for "unreachable" here) and no bio to
  // extract from. 2 of the 3 real none_found jobs in the prompt's own
  // report (Isabel Eberhardt, Sven Eppert) cost €0.25-0.33 for exactly
  // this reason — this makes them cost €0 instead. Written straight to
  // 'none_found' (not a new status) with the same 90-day stale-after a
  // researched-but-empty result already gets — this IS that outcome, just
  // reached without spending anything to confirm it.
  if (!person.linkedin_url && !entity?.website && !bioRaw) {
    if (!dryRun) {
      await supabase.from('catalog_people').update({
        hook_status: 'none_found', enrichment_status: 'enriched',
        enriched_at: new Date().toISOString(), enrichment_stale_after: addDays(new Date(), 90).toISOString(),
      }).eq('id', person.id);
    }
    return { status: 'skipped', reason: 'insufficient_inputs' };
  }

  if (dryRun) return { status: 'dry_run', reason: null, dryRunReport: { person: person.full_name, hasBio: !!bioRaw, willTryWebFallback: !bioRaw } };

  // Prompt 583 §B.1a — the cheap path: a hook straight from the bio team-
  // page enrichment already captured, haiku, zero web calls. Skipped
  // entirely when there's no bio to read (falls straight to §B.1b).
  let bioResult: { hook: string | null; background: string | null; introPath: string | null; watchOuts: string | null; killWords: string[]; confidence: number } | null = null;
  if (bioRaw) {
    const personContext = `${person.full_name}${affiliation?.title ? ` (${affiliation.title})` : ''} at ${entity?.name ?? 'a venture fund'}${entity?.thesis ? `. Fund thesis: ${entity.thesis}` : ''}`;
    const bioExtraction = await callClaude({
      model: LAYER2_MODEL,
      system: 'Extract a hook and supporting facts from this person\'s biography — no web research, only what the bio itself says. '
        + 'Write every text field in English regardless of the bio\'s own language. '
        + 'hook_evidence_quote must be copied EXACTLY from the bio given whenever hook is non-null. '
        // Prompt 634 §3.2
        + 'Never record health conditions, religion, ethnicity, political or union affiliation, or sexual orientation of the person, even when the source states them and even when the person made them public. Investment focus areas are not personal attributes: "invests in diabetes care" is allowed, "was diagnosed with diabetes" is not. Leave the field empty rather than record it. '
        + 'The hook must not contain any phrase you list in kill_words.',
      messages: [{ role: 'user', content: `Person: ${personContext}\n\nBio:\n${bioRaw}\n\nExtract a hook and supporting facts, based only on this bio.` }],
      tools: [EXTRACT_HOOK_FROM_BIO_TOOL],
      toolChoice: { type: 'tool', name: 'extract_hook_from_bio' },
      maxTokens: 1024,
    });
    addUsage(telemetry, LAYER2_MODEL, bioExtraction.usage);
    const parsed = extractToolInput(bioExtraction, 'extract_hook_from_bio');
    if (parsed) {
      const bioRawNormalized = normalizeForMatch(bioRaw);
      const hookSupported = bioHookIsSupported(parsed.hook_evidence_quote, bioRawNormalized);
      // Prompt 634 §3.1 — the net, field by field; §3.3 — a hook that
      // contains one of its own kill words is not a hook. Either strips the
      // hook to null, which zeroes confidence and sends the person down the
      // web path exactly as an unconfident bio hook always has.
      const guarded = stripSpecialCategoryFields({
        hook: hookSupported ? parsed.hook : null, background: parsed.background ?? null,
        intro_path: parsed.intro_path ?? null, watch_outs: parsed.watch_outs ?? null,
      });
      await recordFieldRejections(person.id, 'bio', guarded.rejected);
      for (const r of guarded.rejected) guardRejections.push(`special_category:${r.field}`);
      const killWords: string[] = parsed.kill_words ?? [];
      const killHit = hookContainsKillWord(guarded.kept.hook, killWords);
      if (killHit) { await recordKillWordRejection(person.id, 'bio', guarded.kept.hook!, killHit); guardRejections.push('kill_word'); }
      // Prompt 638 §3.2 — names the fund, never the person: not a hook.
      const fundOnly = killHit ? null : hookIsAboutTheFund(guarded.kept.hook, entity?.name ?? null, person.full_name);
      if (fundOnly) { await recordFundNotPersonRejection(person.id, 'bio', guarded.kept.hook!, fundOnly.entityMention); guardRejections.push('fund_not_person'); }
      const hook = (killHit || fundOnly) ? null : guarded.kept.hook;
      bioConfidenceRaw = typeof parsed.confidence === 'number' ? parsed.confidence : null;
      bioHookSupported = hookSupported;
      bioResult = {
        hook,
        background: guarded.kept.background,
        introPath: guarded.kept.intro_path,
        watchOuts: guarded.kept.watch_outs,
        killWords,
        confidence: (typeof parsed.confidence === 'number' && hook && hookSupported) ? parsed.confidence : 0,
      };
    }
  }

  // Prompt 583 §B.1b — only when the bio path found nothing or wasn't
  // confident enough. This is the ONLY branch that ever touches the web,
  // so most people with a decent existing bio never reach it at all.
  if (bioResult && bioResult.confidence >= BIO_HOOK_CONFIDENCE_THRESHOLD) {
    // Prompt 642 §4 — never over a human-stamped field, never null over a value.
    const bioGuard = stripHumanVerified(withoutNulls({
      hook: bioResult.hook, hook_source: 'bio',
      background: bioResult.background, intro_path: bioResult.introPath,
      watch_outs: bioResult.watchOuts, kill_words: bioResult.killWords.length ? bioResult.killWords : null,
    }), humanFields);
    if (bioGuard.protectedKeys.length) guardRejections.push(`human_verified:${bioGuard.protectedKeys.join('+')}`);
    if (Object.keys(bioGuard.kept).length) {
      await supabase.from('catalog_people_research').upsert({ person_id: person.id, ...bioGuard.kept, updated_at: new Date().toISOString() }, { onConflict: 'person_id' });
    }
    const wroteBioHook = 'hook' in bioGuard.kept;
    await supabase.from('catalog_people').update({
      ...(wroteBioHook || humanHook || hadHook ? { hook_status: 'researched' } : {}), enrichment_status: 'enriched',
      enriched_at: new Date().toISOString(), enrichment_stale_after: addDays(new Date(), 90).toISOString(),
    }).eq('id', person.id);
    return {
      status: 'done', reason: null, hookWritten: wroteBioHook, hookSource: wroteBioHook ? 'bio' : null, usedWebFallback: false,
      outcome: { path: 'bio', mode: job.mode ?? 'mixed', bio_confidence: bioConfidenceRaw, bio_hook_supported: bioHookSupported, guard_rejections: guardRejections, hook_written: wroteBioHook, hook_source: wroteBioHook ? 'bio' : null },
    };
  }

  // Prompt 638 §3.1 — bio_only stops here. NOT none_found: none_found plus the
  // sweep's 90-day clause would shut the door on a person the web path might
  // still serve (the Indico problem, self-inflicted). hook_status is left
  // exactly as it was, the job closes done with a reason the mixed sweep
  // knows how to read, and the bio-grounded fields that did come out are
  // kept — they cost €0.003 and are true whether or not a hook was found.
  if (bioOnly) {
    if (bioResult) {
      const keepGuard = stripHumanVerified(withoutNulls({
        background: bioResult.background, intro_path: bioResult.introPath, watch_outs: bioResult.watchOuts,
        kill_words: bioResult.killWords.length ? bioResult.killWords : null,
      }), humanFields);
      if (keepGuard.protectedKeys.length) guardRejections.push(`human_verified:${keepGuard.protectedKeys.join('+')}`);
      if (Object.keys(keepGuard.kept).length) {
        await supabase.from('catalog_people_research').upsert({ person_id: person.id, ...keepGuard.kept, updated_at: new Date().toISOString() }, { onConflict: 'person_id' });
      }
    }
    return {
      status: 'done', reason: bioRaw ? 'bio_inconclusive' : 'bio_only_no_bio', hookWritten: false, hookSource: null, usedWebFallback: false,
      outcome: { path: 'bio_only_stop', mode: 'bio_only', bio_confidence: bioConfidenceRaw, bio_hook_supported: bioHookSupported, guard_rejections: guardRejections, hook_written: false, hook_source: null },
    };
  }

  const sourceUrls = new Set<string>();
  const searchMessages: any[] = [];

  // Reaproveita fontes ja pagas antes de pesquisar de novo — nao repete uma
  // pesquisa ja feita e registada. A pesquisa em si nunca foi o problema
  // (o piloto de 3 angels encontrou material genuinamente bom); o problema
  // era nunca ler o que a pesquisa encontrou. Reutilizar e por isso a
  // correccao certa, nao so uma poupanca pontual.
  const { data: existingSources } = await supabase
    .from('catalog_entity_enrichment_sources')
    .select('source_url')
    .eq('person_id', person.id)
    .eq('source_type', 'web_search');

  if (existingSources && existingSources.length > 0) {
    for (const s of existingSources) sourceUrls.add(s.source_url);
  } else {
    // Passo 1: pesquisa (server-side web_search tool, D9: linkedin.com
    // bloqueado ao nivel do proprio tool, nao so por instrucao).
    searchMessages.push({
      role: 'user',
      content: `Pesquisa informacao publica sobre ${person.full_name}, que trabalha em ${entity?.name ?? 'um fundo de investimento'}. Interessa: percurso profissional, exits/empresas anteriores, entrevistas, artigos, podcasts. Nunca leias linkedin.com. Resume o que encontraste e cita as fontes (URLs).`,
    });
    function collectFromContent(content: any[]) {
      for (const block of content ?? []) {
        if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
          for (const r of block.content) if (r?.url) sourceUrls.add(r.url);
        }
        if (block.type === 'server_tool_use' && block.name === 'web_search') telemetry.webCalls += 1;
      }
    }

    let searchResponse = await callClaude({
      model: LAYER2_MODEL,
      system: SEARCH_SYSTEM_PROMPT,
      messages: searchMessages,
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: WEB_FALLBACK_SEARCH_MAX_USES, blocked_domains: ['linkedin.com'], allowed_callers: ['direct'] }],
      timeoutMs: 120000,
    });
    addUsage(telemetry, LAYER2_MODEL, searchResponse.usage);
    collectFromContent(searchResponse.content);

    // server tool com loop interno; pause_turn = atingiu o limite de
    // iteracoes do lado do servidor — reenvia para continuar (nao e um
    // "Continue." manual).
    while (searchResponse.stop_reason === 'pause_turn') {
      searchMessages.push({ role: 'assistant', content: searchResponse.content });
      searchResponse = await callClaude({
        model: LAYER2_MODEL,
        system: SEARCH_SYSTEM_PROMPT,
        messages: searchMessages,
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: WEB_FALLBACK_SEARCH_MAX_USES, blocked_domains: ['linkedin.com'], allowed_callers: ['direct'] }],
        timeoutMs: 120000,
      });
      addUsage(telemetry, LAYER2_MODEL, searchResponse.usage);
      collectFromContent(searchResponse.content);
    }
    searchMessages.push({ role: 'assistant', content: searchResponse.content });
  }

  const candidateList = [...sourceUrls];
  const isFreshSearch = searchMessages.length > 0;

  // Passo 2: escolhe ate 3 fontes para LER na integra — a falha de desenho
  // que o piloto revelou. Snippets de resultados de pesquisa dao titulos,
  // nao dao material para um gancho; isso vem de ler o artigo. Mesma
  // disciplina "lista fechada, o codigo valida" ja usada para
  // linkedin_url/individual_profile_url na Camada 1.
  const readSources: { url: string; text: string }[] = [];
  if (candidateList.length > 0) {
    const selectionMessages = isFreshSearch
      ? searchMessages
      : [{ role: 'user', content: `Fontes disponiveis sobre ${person.full_name} (${entity?.name ?? 'fundo de investimento'}):\n${formatCandidateList(candidateList)}` }];
    const selection = await callClaude({
      model: LAYER2_MODEL,
      system: 'Escolhe fontes para ler, copiando os URLs EXACTAMENTE da lista fornecida — nunca inventes nem alteres um URL.',
      messages: [...selectionMessages, { role: 'user', content: `Escolhe ate ${WEB_FALLBACK_MAX_SOURCES_READ} destas fontes para ler na integra:\n${formatCandidateList(candidateList)}` }],
      tools: [SELECT_SOURCES_TOOL],
      toolChoice: { type: 'tool', name: 'select_sources' },
      maxTokens: 512,
    });
    addUsage(telemetry, LAYER2_MODEL, selection.usage);
    const selectionParsed = extractToolInput(selection, 'select_sources');
    const chosenUrls: string[] = (selectionParsed?.urls ?? [])
      .map((u: string) => candidateList.find((c) => c === u))
      .filter((u: string | undefined): u is string => !!u)
      .slice(0, WEB_FALLBACK_MAX_SOURCES_READ);

    for (const url of chosenUrls) {
      if (!(await isAllowedByRobots(url))) continue;
      const page = await fetchPage(url);
      telemetry.webCalls += 1;
      if (!page.ok) continue;
      const text = htmlToText(page.html);
      if (text.length < 100) continue;
      readSources.push({ url, text: text.slice(0, WEB_FALLBACK_PAGE_CHAR_LIMIT) });
    }
  }

  const readContext = readSources.length
    ? readSources.map((s) => `URL: ${s.url}\n\nTexto:\n${s.text}`).join('\n\n---\n\n')
    : '(nenhuma fonte foi lida com sucesso)';

  // Passo 3: sintese estruturada, a partir do texto REAL lido — nao dos
  // snippets de pesquisa. hasReadSource (nao so ter um URL) e o que decide
  // se o hook pode ser escrito.
  const synthesis = await callClaude({
    model: LAYER2_MODEL,
    // Prompt 280 — bug confirmado 2x em producao: sem instrucao de lingua,
    // o modelo escreve na lingua das FONTES lidas (imprensa alema saiu em
    // portugues; imprensa romena saiu 3 em romeno e 1 em portugues, nem
    // sequer consistente dentro do mesmo fundo) em vez de ingles, a lingua
    // fixa do produto. A directiva fica em ingles, nao em portugues como o
    // resto deste system prompt — e a lingua-alvo, e o comando mais directo
    // possivel para a obter de forma fiavel. Aplica-se a toda a resposta
    // desta chamada (hook, intro_path, watch_outs, background, kill_words),
    // nao so a hook/background: e a MESMA chamada a produzir todos os
    // campos, por isso nao ha como restringir a instrucao so a dois deles.
    //
    // Prompt 281 §2 — a lingua nao era o unico problema: os 4 hooks da 2a
    // corrida real (GapMinder) cumpriam a regra "so com fonte lida" mas
    // eram anedotas biograficas (nome do fundo vindo do metro de Londres,
    // opiniao sobre Schengen/portos) — curiosas, inuteis como abertura de
    // uma aproximacao de investimento. Mesmo criterio repetido aqui e na
    // description do proprio campo hook (RECORD_RESEARCH_TOOL, acima) de
    // proposito, mesmo padrao ja usado para as ancoras de bio na Camada 1.
    // O background NAO leva esta obrigacao — so o hook, tal como so o hook
    // (nao os outros campos) exige fonte lida: um facto biografico correcto
    // continua a ser um facto correcto, so nao serve de linha de abertura.
    system: 'Sintetiza apenas com base no texto das fontes lidas abaixo. Se nao conseguiste ler nenhuma fonte com substancia suficiente, deixa os campos a null em vez de inventar ou de usar so titulos/resumos de pesquisa. '
      + 'Write every text field (hook, intro_path, watch_outs, background, kill_words) in English, regardless of the language of the sources you read — the sources may be in Portuguese, Romanian, German, or any other language, but your output must always be English. '
      + 'The hook field has a stricter bar than the other fields: only write it if it is (a) specific to THIS person, not a generic fact about the fund, (b) recent or still current, not an old story with no relevance today, and (c) relevant to an investment approach — her thesis, a deal or public statement about the sector, a declared investment interest. Biographical trivia — where the fund\'s name came from, family stories, opinions outside the investment domain — does NOT qualify, even if it came from a source you read: leave hook null in that case, but you may still write background (background is purely factual, it has no relevance bar). '
      // Prompt 634 §3.2 — the first web run wrote "Born with diabetes" as the
      // opening line of a person's profile. Article 9. Said here and in the
      // schema, like the hook bar.
      + 'Never record health conditions, religion, ethnicity, political or union affiliation, or sexual orientation of the person, even when the source states them and even when the person made them public. Investment focus areas are not personal attributes: "invests in diabetes care" is allowed, "was diagnosed with diabetes" is not. Leave the field empty rather than record it. '
      + 'The hook must not contain any phrase you list in kill_words.',
    messages: [
      {
        role: 'user',
        content: `Pessoa: ${person.full_name} (${entity?.name ?? 'fundo de investimento'})\n\nFontes lidas:\n${readContext}\n\nCom base APENAS neste texto, regista a sintese.`,
      },
    ],
    tools: [RECORD_RESEARCH_TOOL],
    toolChoice: { type: 'tool', name: 'record_research' },
    // Prompt 583 §B.2 — "≤800 tokens de saída": 1024, not 800 exactly, is
    // a hard ceiling (max_tokens truncates mid-generation) rather than a
    // soft target — cutting a tool call's JSON off mid-structure would
    // break parsing entirely, so this leaves headroom above the target
    // instead of enforcing it to the token.
    maxTokens: 1024,
  });
  addUsage(telemetry, LAYER2_MODEL, synthesis.usage);

  const result = extractToolInput(synthesis, 'record_research');
  if (!result) throw new Error('synthesis_validation_failed: no tool_use block returned');

  // Prompt 634 §3.1 — reject the FIELD, not the job: a background naming a
  // condition is dropped, a clean hook survives. §3.3 — a hook containing
  // one of the same response's kill_words is discarded, so the row lands as
  // none_found rather than opening with the phrase the model itself said
  // would close the door. Both are audited per field, never per row.
  const guardedWeb = stripSpecialCategoryFields({
    hook: result.hook ?? null, background: result.background ?? null,
    intro_path: result.intro_path ?? null, watch_outs: result.watch_outs ?? null,
  });
  await recordFieldRejections(person.id, 'web', guardedWeb.rejected);
  for (const r of guardedWeb.rejected) guardRejections.push(`special_category:${r.field}`);
  const webKillHit = hookContainsKillWord(guardedWeb.kept.hook, result.kill_words ?? []);
  if (webKillHit) { await recordKillWordRejection(person.id, 'web', guardedWeb.kept.hook!, webKillHit); guardRejections.push('kill_word'); }
  // Prompt 638 §3.2 — the Alpana shape: "<Fund> focuses on…" with the person
  // nowhere in the sentence. Rejected before the write, audited per field.
  const webFundOnly = webKillHit ? null : hookIsAboutTheFund(guardedWeb.kept.hook, entity?.name ?? null, person.full_name);
  if (webFundOnly) { await recordFundNotPersonRejection(person.id, 'web', guardedWeb.kept.hook!, webFundOnly.entityMention); guardRejections.push('fund_not_person'); }
  result.hook = (webKillHit || webFundOnly) ? null : guardedWeb.kept.hook;
  result.background = guardedWeb.kept.background;
  result.intro_path = guardedWeb.kept.intro_path;
  result.watch_outs = guardedWeb.kept.watch_outs;

  const hasReadSource = readSources.length > 0;

  // D8: pesquisa nova insere uma linha por fonte encontrada, como antes.
  // Reaproveitamento nao insere de novo (as linhas ja existem) — so marca
  // como lidas as que efectivamente foram lidas, abaixo.
  if (isFreshSearch) {
    for (const url of sourceUrls) {
      await supabase.from('catalog_entity_enrichment_sources').insert({
        entity_id: person.entity_id,
        person_id: person.id,
        source_url: url,
        source_type: 'web_search',
        supports: 'hook/background',
        quality: 'search_result',
        batch_id: batchId,
      });
    }
  }
  for (const s of readSources) {
    await supabase
      .from('catalog_entity_enrichment_sources')
      .update({ quality: 'read_full_text', supports: 'hook', batch_id: batchId })
      .eq('person_id', person.id)
      .eq('source_url', s.url);
  }

  // Regra do Nuno: hook so se escreve com fonte LIDA. Sem isso, hook_status
  // = none_found e o campo fica vazio — um hook inventado queima o contacto.
  //
  // Prompt 583 §B — a low-confidence bio hook (bioResult) is what SENT
  // this job down the web-fallback path in the first place, so it never
  // resurfaces here even if the web search itself found nothing: the
  // whole point of the confidence gate is that an unconfirmed bio hook
  // doesn't ship on its own. background/intro_path/watch_outs/kill_words
  // carry no such restriction — those fall back to the bio path's own
  // (bio-grounded, just not hook-confident) values when the web synthesis
  // came back null for them, rather than discarding a real fact the bio
  // already supported.
  // Prompt 642 §4 — a key the model did not return is omitted, never written as null over a
  // value (the old `?? null` writes of the web path were exactly that); a key a human stamped leaves the
  // patch; hook_source travels with hook.
  const webGuard = stripHumanVerified(withoutNulls({
    intro_path: result.intro_path ?? bioResult?.introPath ?? null,
    watch_outs: result.watch_outs ?? bioResult?.watchOuts ?? null,
    kill_words: result.kill_words?.length ? result.kill_words : (bioResult?.killWords?.length ? bioResult.killWords : null),
    background: result.background ?? bioResult?.background ?? null,
    email_guess: result.email_guess ?? null,
    email_guess_confidence: result.email_guess_confidence ?? null,
    hook: hasReadSource && result.hook ? result.hook : null,
    hook_source: hasReadSource && result.hook ? 'web' : null,
  }), humanFields);
  if (webGuard.protectedKeys.length) guardRejections.push(`human_verified:${webGuard.protectedKeys.join('+')}`);
  const wroteWebHook = 'hook' in webGuard.kept;
  if (Object.keys(webGuard.kept).length) {
    await supabase.from('catalog_people_research').upsert({ person_id: person.id, ...webGuard.kept, updated_at: new Date().toISOString() }, { onConflict: 'person_id' });
  }

  await supabase
    .from('catalog_people')
    .update({
      hook_status: wroteWebHook || humanHook || hadHook ? 'researched' : 'none_found',
      enrichment_status: 'enriched',
      enriched_at: new Date().toISOString(),
      enrichment_stale_after: addDays(new Date(), 90).toISOString(), // Camada 2 = 90 dias
    })
    .eq('id', person.id);

  return {
    status: 'done',
    reason: null,
    hasReadSource,
    hookWritten: wroteWebHook,
    hookSource: wroteWebHook ? 'web' : null,
    usedWebFallback: true,
    triedBioFirst: !!bioRaw,
    sourcesFound: sourceUrls.size,
    sourcesRead: readSources.length,
    reusedExistingSources: !isFreshSearch,
    outcome: {
      path: 'web', mode: job.mode ?? 'mixed', bio_confidence: bioConfidenceRaw, bio_hook_supported: bioHookSupported,
      guard_rejections: guardRejections, hook_written: wroteWebHook, hook_source: wroteWebHook ? 'web' : null,
      sources_found: sourceUrls.size, sources_read: readSources.length, reused_existing_sources: !isFreshSearch,
    },
  };
}

// ============================================================
// Handler
// ============================================================
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  // Autenticacao do chamador — bloqueante, mesmo padrao de
  // matchdeal-pair/index.ts. So dois chamadores legitimos: (a) o proprio
  // pg_cron, que invoca com a service role key como Bearer token; (b) um
  // membro de platform_admins com sessao valida. Nenhum utilizador normal
  // da plataforma pode disparar isto — e um worker que gasta dinheiro de
  // API e faz fetches contra sites de terceiros, nao uma rota de produto.
  // Fica ANTES de qualquer outra logica, incluindo dryRun: um ensaio a seco
  // continua a fazer fetches reais contra infra de terceiros, so nao chama
  // o modelo nem escreve — exige o mesmo nivel de autorizacao que a corrida
  // a serio, nao menos.
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ ok: false, error: 'Missing Authorization.' }, 401);
  const bearerToken = authHeader.replace(/^Bearer\s+/i, '');
  const isServiceRoleCall = bearerToken === SERVICE_ROLE_KEY;
  if (!isServiceRoleCall) {
    const asCaller = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userErr } = await asCaller.auth.getUser();
    if (userErr || !user) return json({ ok: false, error: 'Not a valid Sherlock Deal session.' }, 401);
    const { data: isAdmin } = await asCaller.rpc('is_platform_admin');
    if (!isAdmin) return json({ ok: false, error: 'Platform admin only.' }, 403);
  }

  const body = await req.json().catch(() => ({}));

  // Prompt 583 §E.2 — "tecto diário e cap por corrida passam a
  // configuração visível": both are env vars read into this same process,
  // so the only honest way to show their CURRENT value elsewhere (the
  // Next app runs as a separate process/runtime and can't read this
  // function's own env) is to ask this function directly. No queue
  // access, no cost — same auth gate as everything else here, since even
  // config values are backoffice-only information, not public.
  if (body?.statusOnly === true) {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const { data: todaySpend } = await supabase.from('enrichment_jobs').select('cost_eur').gte('started_at', startOfDay.toISOString());
    const spentToday = (todaySpend ?? []).reduce((sum, r) => sum + (r.cost_eur ?? 0), 0);
    return json({
      ok: true,
      enrichmentEnabled: ENRICHMENT_ENABLED,
      dailyCostCapEur: DAILY_COST_CAP_EUR,
      spentTodayEur: Number(spentToday.toFixed(5)),
      defaultBatchSize: BATCH_SIZE,
      layer1Model: LAYER1_MODEL,
      layer2Model: LAYER2_MODEL,
    });
  }

  const dryRun = body?.dryRun === true;
  // Filtro opcional de camada para corridas escalonadas (ex.: so a Camada 1
  // dos 6 VC primeiro, so a Camada 2 dos 3 angels depois). Omitido = qualquer
  // camada, o comportamento normal do cron.
  const layerFilter = body?.layer === 1 || body?.layer === 2 ? body.layer : null;
  // Override manual do tecto de jobs por invocacao. BATCH_SIZE continua a
  // ser o tecto normal do cron; maxJobs deixa uma chamada manual pedir um
  // numero DIFERENTE — mais pequeno (Camada 2 e pesada, 3 jobs numa so
  // invocacao ja esgotou os recursos da function em 2026-08-08) ou maior
  // (lote de arranque da Camada 1, mais leve por job). Bug corrigido no
  // mesmo dia: Math.min(maxJobs, BATCH_SIZE) so deixava ir para BAIXO do
  // default — um pedido de 50 ficava preso em 5. O tecto agora e um limite
  // de seguranca fixo (100), nao o BATCH_SIZE do cron.
  const maxJobs = typeof body?.maxJobs === 'number' && body.maxJobs > 0 ? Math.min(body.maxJobs, 100) : BATCH_SIZE;

  if (!dryRun && !ENRICHMENT_ENABLED) {
    return json({ ok: true, skipped: true, reason: 'ENRICHMENT_ENABLED is false' });
  }

  const batchId = `batch_${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}`;
  const results: any[] = [];

  if (!dryRun) {
    // Recuperacao de jobs presos em 'running' por um kill duro da
    // plataforma (WORKER_RESOURCE_LIMIT) a meio do processamento — medido
    // no piloto, nao hipotetico: um job assim nunca passa pelo try/catch
    // normal, fica sem telemetria e sem last_error, e o indice unico de um
    // job activo por alvo bloqueia esse alvo PARA SEMPRE sem isto (nunca
    // mais volta a 'queued' sozinho). 5 min e generoso face ao timeout de
    // 60s por chamada ao Claude em callClaude.
    const staleThreshold = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    await supabase
      .from('enrichment_jobs')
      .update({ status: 'queued', started_at: null, last_error: 'stale_running_recovered' })
      .eq('status', 'running')
      .lt('started_at', staleThreshold);

    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const { data: todaySpend } = await supabase.from('enrichment_jobs').select('cost_eur').gte('started_at', startOfDay.toISOString());
    const spentToday = (todaySpend ?? []).reduce((sum, r) => sum + (r.cost_eur ?? 0), 0);
    if (spentToday >= DAILY_COST_CAP_EUR) {
      return json({ ok: true, stopped: true, reason: 'daily_cost_cap_reached', spentToday, cap: DAILY_COST_CAP_EUR });
    }
  }

  // Ensaio a seco e inerte (nao gasta dinheiro, nao muda estado) — busca o
  // suficiente para reportar sobre todos os alvos do piloto numa so chamada
  // em vez de ficar preso aos primeiros BATCH_SIZE para sempre (dry run
  // nunca reivindica um job, por isso repetir a chamada devolveria os
  // mesmos candidatos). Corridas a serio mantem o tecto de maxJobs.
  let candidatesQuery = supabase
    .from('enrichment_jobs')
    .select('id, target_type, target_id, layer, attempts, mode')
    .eq('status', 'queued')
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(dryRun ? 50 : maxJobs);
  if (layerFilter) candidatesQuery = candidatesQuery.eq('layer', layerFilter);
  const { data: candidates } = await candidatesQuery;

  for (const candidate of candidates ?? []) {
    // Reivindicacao atomica: UPDATE condicional (WHERE status='queued') —
    // uma segunda invocacao concorrente que tente a mesma linha afecta 0
    // linhas, sem precisar de FOR UPDATE SKIP LOCKED via RPC dedicada.
    const claim = dryRun
      ? { data: candidate, error: null }
      : await supabase
          .from('enrichment_jobs')
          .update({ status: 'running', started_at: new Date().toISOString() })
          .eq('id', candidate.id)
          .eq('status', 'queued')
          .select('id, target_type, target_id, layer, attempts, mode')
          .single();
    if (claim.error || !claim.data) continue; // outra invocacao ja a reivindicou

    const job = claim.data;
    const telemetry = newTelemetry();
    let outcome: any;
    try {
      outcome = job.target_type === 'entity' ? await processEntityJob(job, dryRun, telemetry, batchId) : await processPersonJob(job, dryRun, telemetry, batchId);
    } catch (err) {
      outcome = { status: 'error', reason: (err as Error).message };
    }

    if (dryRun) {
      results.push({ jobId: job.id, targetType: job.target_type, targetId: job.target_id, ...outcome });
      continue;
    }

    const jobTarget = { targetType: job.target_type as string, targetId: job.target_id as string };
    if (outcome.status === 'done') {
      // Prompt 638 §3.1/§3.3 — a done job may carry a reason (bio_inconclusive)
      // and always carries what it did, so cost is measured per useful hook.
      await flushTelemetry(job.id, telemetry, { status: 'done', finished_at: new Date().toISOString(), last_error: outcome.reason ?? null, outcome: outcome.outcome ?? null }, jobTarget);
    } else if (outcome.status === 'skipped') {
      // Nunca entra no ciclo de repeticoes — nao incrementa attempts.
      await flushTelemetry(job.id, telemetry, { status: 'skipped', last_error: outcome.reason, finished_at: new Date().toISOString() }, jobTarget);
    } else {
      // Prompt 583 §D.2 — a persistent 403/429 (outcome.status === 'blocked',
      // set by fetchPageWithBlockRetry via processEntityJob) reuses the same
      // attempts/requeue cadence as a generic error — a bot-blocking site
      // deserves a later retry too, since the block may not be permanent —
      // but its terminal state is written as 'blocked', not 'failed', so it
      // reads as "this site rejects bots" rather than "something broke".
      const attempts = (job.attempts ?? 0) + 1;
      const terminal = attempts >= 3;
      await flushTelemetry(job.id, telemetry, {
        status: terminal ? (outcome.status === 'blocked' ? 'blocked' : 'failed') : 'queued',
        attempts,
        last_error: outcome.reason,
        finished_at: terminal ? new Date().toISOString() : null,
        started_at: null,
      }, jobTarget);
    }

    results.push({ jobId: job.id, targetType: job.target_type, targetId: job.target_id, status: outcome.status, reason: outcome.reason ?? null });
  }

  return json({ ok: true, dryRun, batchId, processed: results.length, results });
});

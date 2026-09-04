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

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;

const ENRICHMENT_ENABLED = (Deno.env.get('ENRICHMENT_ENABLED') ?? 'false').toLowerCase() === 'true';
const DAILY_COST_CAP_EUR = Number(Deno.env.get('ENRICHMENT_DAILY_COST_CAP_EUR') ?? '5');
const LAYER1_MODEL = Deno.env.get('ENRICHMENT_LAYER1_MODEL') ?? 'claude-haiku-4-5';
const LAYER2_MODEL = Deno.env.get('ENRICHMENT_LAYER2_MODEL') ?? 'claude-sonnet-5';
const BATCH_SIZE = Number(Deno.env.get('ENRICHMENT_BATCH_SIZE') ?? '5');
const MAX_PROFILE_PAGES_PER_ENTITY = 10; // doc §3.2 step 3
const BIO_LENGTH_THRESHOLD = 300; // doc's own heuristic, reused for D1-b scaling decision
const USER_AGENT = 'SherlockDealBot/1.0 (+https://sherlockdeal.com/enrichment-bot)';

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
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('html')) return { ok: false, reason: 'not_html' };
    return { ok: true, html: await res.text() };
  } catch (err) {
    return { ok: false, reason: `fetch_error: ${(err as Error).message}` };
  }
}

function discoverTeamPageUrl(homepageHtml: string, baseUrl: string): string | null {
  const doc = new DOMParser().parseFromString(homepageHtml, 'text/html');
  if (!doc) return null;
  const anchors = [...doc.querySelectorAll('a')] as any[];
  const pattern = /team|about|people|equipa|nosotros|qui-sommes|quem-somos|who-we-are|our-team|sobre-nos/i;
  let best: string | null = null;
  let bestScore = -1;
  for (const a of anchors) {
    const href = a.getAttribute('href');
    if (!href) continue;
    const text = (a.textContent ?? '').trim();
    const hrefMatch = pattern.test(href);
    const textMatch = pattern.test(text);
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
      max_tokens: 4096,
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
      kill_words: { type: 'array', items: { type: 'string' } },
      background: { type: ['string', 'null'] },
      email_guess: { type: ['string', 'null'] },
      email_guess_confidence: { type: ['string', 'null'], enum: ['high', 'medium', 'low', null] },
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
    .select('id, name, website, is_test')
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

  const homepage = await fetchPage(homepageUrl);
  if (!homepage.ok) return { status: 'failed', reason: homepage.reason };
  telemetry.webCalls += 1;

  let teamUrl = discoverTeamPageUrl(homepage.html, homepageUrl);
  let teamPage: { ok: true; html: string } | null = null;

  if (teamUrl) {
    if (!(await isAllowedByRobots(teamUrl))) return { status: 'skipped', reason: 'robots_disallowed' };
    const fetched = await fetchPage(teamUrl);
    telemetry.webCalls += 1;
    if (!fetched.ok) return { status: 'failed', reason: fetched.reason };
    teamPage = fetched;
  } else {
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
      if (!(await isAllowedByRobots(candidateUrl))) continue;
      const candidatePage = await fetchPage(candidateUrl);
      telemetry.webCalls += 1;
      if (!candidatePage.ok) continue;
      const candidateText = htmlToText(candidatePage.html);
      if (looksLikeJsOnlyShell(candidatePage.html, candidateText.length)) continue;
      if (candidateText.length < 50) continue;
      teamUrl = candidateUrl;
      teamPage = candidatePage;
      break;
    }
    if (!teamUrl || !teamPage) return { status: 'skipped', reason: 'team_page_not_found' };
  }

  const teamText = htmlToText(teamPage.html);
  if (looksLikeJsOnlyShell(teamPage.html, teamText.length)) return { status: 'skipped', reason: 'js_only_site' };
  if (teamText.length < 50) return { status: 'skipped', reason: 'team_page_empty' };

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
  if (Object.keys(fundPatch).length) {
    await supabase.from('catalog_entities').update(fundPatch).eq('id', entity.id);
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
      await supabase.from('catalog_people').update(personPatch).eq('id', personId);
    } else {
      const { data: created, error: createErr } = await supabase.from('catalog_people').insert(personPatch).select('id').single();
      if (createErr || !created) continue; // provavel colisao de linkedin_url unico — nao bloqueia o resto do lote
      personId = created.id;
    }

    await supabase
      .from('catalog_person_affiliations')
      .upsert(
        { person_id: personId, entity_id: entity.id, title: title ?? null, kind: 'other', is_primary: true, current: true },
        { onConflict: 'person_id,entity_id,kind' },
      );
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

  await supabase
    .from('catalog_entities')
    .update({ enrichment_status: 'enriched', enriched_at: new Date().toISOString(), enrichment_stale_after: addMonths(new Date(), 6).toISOString() })
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
async function processPersonJob(job: any, dryRun: boolean, telemetry: Telemetry, batchId: string) {
  const { data: person, error: personErr } = await supabase.from('catalog_people').select('id, full_name, entity_id').eq('id', job.target_id).single();
  if (personErr || !person) throw new Error(`person_not_found: ${personErr?.message ?? job.target_id}`);

  const { data: entity } = await supabase.from('catalog_entities').select('name, is_test').eq('id', person.entity_id).maybeSingle();
  if (entity?.is_test) return { status: 'skipped', reason: 'is_test entity, skipped by policy' };

  if (dryRun) return { status: 'dry_run', reason: null, dryRunReport: { person: person.full_name } };

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
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 10, blocked_domains: ['linkedin.com'] }],
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
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 10, blocked_domains: ['linkedin.com'] }],
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
      messages: [...selectionMessages, { role: 'user', content: `Escolhe ate 3 destas fontes para ler na integra:\n${formatCandidateList(candidateList)}` }],
      tools: [SELECT_SOURCES_TOOL],
      toolChoice: { type: 'tool', name: 'select_sources' },
    });
    addUsage(telemetry, LAYER2_MODEL, selection.usage);
    const selectionParsed = extractToolInput(selection, 'select_sources');
    const chosenUrls: string[] = (selectionParsed?.urls ?? [])
      .map((u: string) => candidateList.find((c) => c === u))
      .filter((u: string | undefined): u is string => !!u)
      .slice(0, 3);

    for (const url of chosenUrls) {
      if (!(await isAllowedByRobots(url))) continue;
      const page = await fetchPage(url);
      telemetry.webCalls += 1;
      if (!page.ok) continue;
      const text = htmlToText(page.html);
      if (text.length < 100) continue;
      readSources.push({ url, text: text.slice(0, 20000) });
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
      + 'The hook field has a stricter bar than the other fields: only write it if it is (a) specific to THIS person, not a generic fact about the fund, (b) recent or still current, not an old story with no relevance today, and (c) relevant to an investment approach — her thesis, a deal or public statement about the sector, a declared investment interest. Biographical trivia — where the fund\'s name came from, family stories, opinions outside the investment domain — does NOT qualify, even if it came from a source you read: leave hook null in that case, but you may still write background (background is purely factual, it has no relevance bar).',
    messages: [
      {
        role: 'user',
        content: `Pessoa: ${person.full_name} (${entity?.name ?? 'fundo de investimento'})\n\nFontes lidas:\n${readContext}\n\nCom base APENAS neste texto, regista a sintese.`,
      },
    ],
    tools: [RECORD_RESEARCH_TOOL],
    toolChoice: { type: 'tool', name: 'record_research' },
  });
  addUsage(telemetry, LAYER2_MODEL, synthesis.usage);

  const result = extractToolInput(synthesis, 'record_research');
  if (!result) throw new Error('synthesis_validation_failed: no tool_use block returned');

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
  const researchPatch: Record<string, unknown> = {
    intro_path: result.intro_path ?? null,
    watch_outs: result.watch_outs ?? null,
    kill_words: result.kill_words ?? [],
    background: result.background ?? null,
    email_guess: result.email_guess ?? null,
    email_guess_confidence: result.email_guess_confidence ?? null,
    updated_at: new Date().toISOString(),
  };
  if (hasReadSource && result.hook) {
    researchPatch.hook = result.hook;
  }
  await supabase.from('catalog_people_research').upsert({ person_id: person.id, ...researchPatch }, { onConflict: 'person_id' });

  await supabase
    .from('catalog_people')
    .update({
      hook_status: hasReadSource && result.hook ? 'researched' : 'none_found',
      enrichment_status: 'enriched',
      enriched_at: new Date().toISOString(),
      enrichment_stale_after: addDays(new Date(), 90).toISOString(), // Camada 2 = 90 dias
    })
    .eq('id', person.id);

  return {
    status: 'done',
    reason: null,
    hasReadSource,
    hookWritten: hasReadSource && !!result.hook,
    sourcesFound: sourceUrls.size,
    sourcesRead: readSources.length,
    reusedExistingSources: !isFreshSearch,
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
    .select('id, target_type, target_id, layer, attempts')
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
          .select('id, target_type, target_id, layer, attempts')
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
      await flushTelemetry(job.id, telemetry, { status: 'done', finished_at: new Date().toISOString() }, jobTarget);
    } else if (outcome.status === 'skipped') {
      // Nunca entra no ciclo de repeticoes — nao incrementa attempts.
      await flushTelemetry(job.id, telemetry, { status: 'skipped', last_error: outcome.reason, finished_at: new Date().toISOString() }, jobTarget);
    } else {
      const attempts = (job.attempts ?? 0) + 1;
      const terminal = attempts >= 3;
      await flushTelemetry(job.id, telemetry, {
        status: terminal ? 'failed' : 'queued',
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

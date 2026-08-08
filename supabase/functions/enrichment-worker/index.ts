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
// Camada 2: hook so se escreve se houver pelo menos uma fonte (URL de
// pesquisa real) a suporta-lo em catalog_entity_enrichment_sources — um hook
// inventado queima o contacto de forma permanente, pior que hook nenhum.
// Sem fonte: hook_status='none_found', campo vazio. Os restantes campos da
// Camada 2 (intro_path, watch_outs, kill_words, background) nao levam esta
// obrigacao — so hook, por instrucao explicita.
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

async function flushTelemetry(jobId: string, t: Telemetry, extra: Record<string, unknown> = {}) {
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

function looksLikeJsOnlyShell(html: string, extractedTextLength: number): boolean {
  const scriptCount = (html.match(/<script/gi) ?? []).length;
  return extractedTextLength < 200 && scriptCount > 5;
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
    signal: AbortSignal.timeout(60000),
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
    'Regista as pessoas e factos do fundo encontrados NESTA pagina especifica. Para cada pessoa, bio_start_anchor e bio_end_anchor tem de ser copiados literalmente do texto da pagina (6-10 palavras cada) — nunca parafraseados.',
  input_schema: {
    type: 'object',
    properties: {
      fund: {
        type: 'object',
        properties: {
          thesis: { type: ['string', 'null'] },
          sectors: { type: 'array', items: { type: 'string' } },
          submission_channel: { type: ['string', 'null'], description: 'email ou URL de submissao de pitches, se visivel nesta pagina' },
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
            linkedin_url: { type: ['string', 'null'] },
            individual_profile_url: { type: ['string', 'null'], description: 'link para a pagina individual desta pessoa nesta mesma pagina, se existir' },
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
    'Regista a biografia desta pessoa a partir da sua pagina individual. bio_start_anchor e bio_end_anchor tem de ser copiados literalmente do texto da pagina.',
  input_schema: {
    type: 'object',
    properties: {
      linkedin_url: { type: ['string', 'null'] },
      bio_start_anchor: { type: ['string', 'null'] },
      bio_end_anchor: { type: ['string', 'null'] },
    },
  },
};

const RECORD_RESEARCH_TOOL = {
  name: 'record_research',
  description: 'Regista a sintese da investigacao sobre esta pessoa, com base apenas no que foi encontrado na pesquisa.',
  input_schema: {
    type: 'object',
    properties: {
      hook: { type: ['string', 'null'] },
      intro_path: { type: ['string', 'null'] },
      watch_outs: { type: ['string', 'null'] },
      kill_words: { type: 'array', items: { type: 'string' } },
      background: { type: ['string', 'null'] },
      email_guess: { type: ['string', 'null'] },
      email_guess_confidence: { type: ['string', 'null'], enum: ['high', 'medium', 'low', null] },
    },
  },
};

// ============================================================
// Camada 1 — processa uma catalog_entities.
// ============================================================
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

  const teamUrl = discoverTeamPageUrl(homepage.html, homepageUrl);
  if (!teamUrl) return { status: 'skipped', reason: 'team_page_not_found' };

  if (!(await isAllowedByRobots(teamUrl))) return { status: 'skipped', reason: 'robots_disallowed' };

  const teamPage = await fetchPage(teamUrl);
  if (!teamPage.ok) return { status: 'failed', reason: teamPage.reason };
  telemetry.webCalls += 1;

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

  const extraction = await callClaude({
    model: LAYER1_MODEL,
    system:
      'Extrai pessoas e factos do fundo a partir do texto de uma pagina de equipa de venture capital. As ancoras de biografia (inicio/fim) tem de ser copiadas EXACTAMENTE do texto dado — nunca parafraseadas, nunca resumidas. Se uma pessoa nao tiver biografia visivel, deixa as ancoras a null.',
    messages: [{ role: 'user', content: `URL: ${teamUrl}\n\nTexto da pagina:\n${teamText}` }],
    tools: [EXTRACT_TEAM_TOOL],
    toolChoice: { type: 'tool', name: 'extract_team' },
  });
  addUsage(telemetry, LAYER1_MODEL, extraction.usage);

  const parsed = extractToolInput(extraction, 'extract_team');
  if (!parsed) throw new Error('extraction_validation_failed: no tool_use block returned');

  // catalog_entities: thesis/sectors/submission_channel (factos neutros de entidade)
  const fundPatch: Record<string, unknown> = {};
  if (parsed.fund?.thesis) fundPatch.thesis = parsed.fund.thesis;
  if (parsed.fund?.sectors?.length) fundPatch.sectors = parsed.fund.sectors;
  if (parsed.fund?.submission_channel) fundPatch.submission_channel = parsed.fund.submission_channel;
  if (parsed.fund?.submission_channel_type) fundPatch.submission_channel_type = parsed.fund.submission_channel_type;
  if (Object.keys(fundPatch).length) {
    await supabase.from('catalog_entities').update(fundPatch).eq('id', entity.id);
  }
  if (parsed.fund?.submission_channel) {
    await supabase.from('catalog_entity_enrichment_sources').insert({
      entity_id: entity.id,
      source_url: teamUrl,
      source_type: 'team_page',
      supports: 'submission_channel',
      quality: 'direct',
      batch_id: batchId,
    });
  }

  let peopleProcessed = 0;
  let peopleWithBio = 0;
  const affiliationsCreated: string[] = [];

  for (const p of parsed.people ?? []) {
    if (!p.full_name) continue;

    let bioRaw = sliceByAnchors(teamText, p.bio_start_anchor, p.bio_end_anchor);
    let bioSourceUrl = teamUrl;

    // D1-b: escala so quando a bio da pagina de equipa fica curta, e so para
    // ESSA pessoa, e so uma chamada, e so contra o texto DAQUELA pagina.
    if ((!bioRaw || bioRaw.length < BIO_LENGTH_THRESHOLD) && p.individual_profile_url && peopleProcessed < MAX_PROFILE_PAGES_PER_ENTITY) {
      let profileUrl: string | null = null;
      try {
        profileUrl = new URL(p.individual_profile_url, teamUrl).toString();
      } catch {
        profileUrl = null;
      }
      if (profileUrl && (await isAllowedByRobots(profileUrl))) {
        const profilePage = await fetchPage(profileUrl);
        if (profilePage.ok) {
          telemetry.webCalls += 1;
          const profileText = htmlToText(profilePage.html);
          if (profileText.length > 50 && !looksLikeJsOnlyShell(profilePage.html, profileText.length)) {
            const profileExtraction = await callClaude({
              model: LAYER1_MODEL,
              system:
                'Extrai a biografia desta pessoa a partir do texto da sua pagina individual. As ancoras (inicio/fim) tem de ser copiadas EXACTAMENTE do texto dado.',
              messages: [{ role: 'user', content: `Pessoa: ${p.full_name}\nURL: ${profileUrl}\n\nTexto da pagina:\n${profileText}` }],
              tools: [EXTRACT_PERSON_BIO_TOOL],
              toolChoice: { type: 'tool', name: 'extract_person_bio' },
            });
            addUsage(telemetry, LAYER1_MODEL, profileExtraction.usage);
            const profileParsed = extractToolInput(profileExtraction, 'extract_person_bio');
            const profileBio = profileParsed ? sliceByAnchors(profileText, profileParsed.bio_start_anchor, profileParsed.bio_end_anchor) : null;
            if (profileBio && (!bioRaw || profileBio.length > bioRaw.length)) {
              bioRaw = profileBio;
              bioSourceUrl = profileUrl;
              if (!p.linkedin_url && profileParsed?.linkedin_url) p.linkedin_url = profileParsed.linkedin_url;
            }
          }
        }
      }
    }

    // upsert catalog_people — chave: linkedin_url normalizado; sem
    // linkedin, chave secundaria nome+entidade (via afiliacao existente).
    let personId: string | null = null;
    if (p.linkedin_url) {
      const normalized = normalizeLinkedinForLookup(p.linkedin_url);
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
    if (p.linkedin_url) personPatch.linkedin_url = p.linkedin_url;
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
        { person_id: personId, entity_id: entity.id, title: p.title ?? null, kind: 'other', is_primary: true, current: true },
        { onConflict: 'person_id,entity_id,kind' },
      );
    affiliationsCreated.push(personId!); // sempre nao-nulo aqui: ramo if era truthy, ramo else fez `continue` antes se falhou

    if (bioRaw) {
      await supabase
        .from('catalog_people_research')
        .upsert({ person_id: personId, bio_raw: bioRaw, updated_at: new Date().toISOString() }, { onConflict: 'person_id' });
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

  // Passo 1: pesquisa (server-side web_search tool, D9: linkedin.com bloqueado
  // ao nivel do proprio tool, nao so por instrucao).
  const searchMessages: any[] = [
    {
      role: 'user',
      content: `Pesquisa informacao publica sobre ${person.full_name}, que trabalha em ${entity?.name ?? 'um fundo de investimento'}. Interessa: percurso profissional, exits/empresas anteriores, entrevistas, artigos, podcasts. Nunca leias linkedin.com. Resume o que encontraste e cita as fontes (URLs).`,
    },
  ];
  const sourceUrls = new Set<string>();
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
    system: 'Es um assistente de investigacao. So relatas factos que encontraste nas fontes pesquisadas — nunca inventas.',
    messages: searchMessages,
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3, blocked_domains: ['linkedin.com'] }],
  });
  addUsage(telemetry, LAYER2_MODEL, searchResponse.usage);
  collectFromContent(searchResponse.content);

  // server tool com loop interno; pause_turn = atingiu o limite de iteracoes
  // do lado do servidor — reenvia para continuar (nao e um "Continue." manual).
  while (searchResponse.stop_reason === 'pause_turn') {
    searchMessages.push({ role: 'assistant', content: searchResponse.content });
    searchResponse = await callClaude({
      model: LAYER2_MODEL,
      system: 'Es um assistente de investigacao. So relatas factos que encontraste nas fontes pesquisadas — nunca inventas.',
      messages: searchMessages,
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3, blocked_domains: ['linkedin.com'] }],
    });
    addUsage(telemetry, LAYER2_MODEL, searchResponse.usage);
    collectFromContent(searchResponse.content);
  }

  // Passo 2: sintese estruturada, a partir do que foi encontrado no passo 1.
  searchMessages.push({ role: 'assistant', content: searchResponse.content });
  searchMessages.push({ role: 'user', content: 'Com base apenas no que encontraste acima, regista a sintese.' });
  const synthesis = await callClaude({
    model: LAYER2_MODEL,
    system: 'Sintetiza apenas com base na pesquisa feita nesta conversa. Se nao encontraste nada de util, deixa os campos a null em vez de inventar.',
    messages: searchMessages,
    tools: [RECORD_RESEARCH_TOOL],
    toolChoice: { type: 'tool', name: 'record_research' },
  });
  addUsage(telemetry, LAYER2_MODEL, synthesis.usage);

  const result = extractToolInput(synthesis, 'record_research');
  if (!result) throw new Error('synthesis_validation_failed: no tool_use block returned');

  const hasSource = sourceUrls.size > 0;

  // D8: toda a informacao escrita regista proveniencia — uma linha por fonte.
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

  // Regra do Nuno: hook so se escreve com fonte. Sem fonte, hook_status =
  // none_found e o campo fica vazio — um hook inventado queima o contacto.
  const researchPatch: Record<string, unknown> = {
    intro_path: result.intro_path ?? null,
    watch_outs: result.watch_outs ?? null,
    kill_words: result.kill_words ?? [],
    background: result.background ?? null,
    email_guess: result.email_guess ?? null,
    email_guess_confidence: result.email_guess_confidence ?? null,
    updated_at: new Date().toISOString(),
  };
  if (hasSource && result.hook) {
    researchPatch.hook = result.hook;
  }
  await supabase.from('catalog_people_research').upsert({ person_id: person.id, ...researchPatch }, { onConflict: 'person_id' });

  await supabase
    .from('catalog_people')
    .update({
      hook_status: hasSource && result.hook ? 'researched' : 'none_found',
      enrichment_status: 'enriched',
      enriched_at: new Date().toISOString(),
      enrichment_stale_after: addDays(new Date(), 90).toISOString(), // Camada 2 = 90 dias
    })
    .eq('id', person.id);

  return { status: 'done', reason: null, hasSource, hookWritten: hasSource && !!result.hook, sourcesFound: sourceUrls.size };
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

  if (!dryRun && !ENRICHMENT_ENABLED) {
    return json({ ok: true, skipped: true, reason: 'ENRICHMENT_ENABLED is false' });
  }

  const batchId = `batch_${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}`;
  const results: any[] = [];

  if (!dryRun) {
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
  // mesmos candidatos). Corridas a serio mantem o tecto de BATCH_SIZE.
  let candidatesQuery = supabase
    .from('enrichment_jobs')
    .select('id, target_type, target_id, layer, attempts')
    .eq('status', 'queued')
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(dryRun ? 50 : BATCH_SIZE);
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

    if (outcome.status === 'done') {
      await flushTelemetry(job.id, telemetry, { status: 'done', finished_at: new Date().toISOString() });
    } else if (outcome.status === 'skipped') {
      // Nunca entra no ciclo de repeticoes — nao incrementa attempts.
      await flushTelemetry(job.id, telemetry, { status: 'skipped', last_error: outcome.reason, finished_at: new Date().toISOString() });
    } else {
      const attempts = (job.attempts ?? 0) + 1;
      const terminal = attempts >= 3;
      await flushTelemetry(job.id, telemetry, {
        status: terminal ? 'failed' : 'queued',
        attempts,
        last_error: outcome.reason,
        finished_at: terminal ? new Date().toISOString() : null,
        started_at: null,
      });
    }

    results.push({ jobId: job.id, targetType: job.target_type, targetId: job.target_id, status: outcome.status, reason: outcome.reason ?? null });
  }

  return json({ ok: true, dryRun, batchId, processed: results.length, results });
});

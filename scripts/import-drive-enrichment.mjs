// Prompt 87 Bloco 1+2 — importer real dos pacotes "enriquecimento_*" do
// Motor B para a pipeline (entities), substituindo import-investor-intel.mjs
// (escrevia para investor_intel_entities/people/signals/sources — tabelas
// que não existem na base; script morto desde que foi escrito).
//
// Descoberta ao testar contra o primeiro lote real (Alemanha lote 01):
// pacotes "enriquecimento" nem sempre trazem catalog_id_principal/
// pipeline_ids resolvíveis — este lote trouxe "not_found" nos 5. Por isso a
// resolução tenta, por ordem: (1) pipeline_ids direto, (2)
// catalog_id_principal -> catalog_entities.source_entity_id, (3) domínio
// normalizado do website_oficial contra entities.website (mesma lógica de
// normalizeDomain de src/lib/catalog-dedupe.ts, replicada aqui porque este
// script corre fora do build do Next). Nenhuma resolução -> needs_review,
// nunca cria uma linha nova em entities (isso é sempre Bloco 3 / decisão
// humana, mesmo para pacotes rotulados "enriquecimento").
//
// Política de merge (Bloco 0 pergunta 4): fill-if-empty apenas. Um campo já
// preenchido NUNCA é sobrescrito — fica registado como "conflito" no
// relatório para decisão humana. last_verified é a única exceção (avança
// sempre para a data de verificação do pacote, se mais recente — é
// metadado de frescura, não conteúdo).
//
// Usage: node scripts/import-drive-enrichment.mjs <path-to-batch-folder> --drive-file-id <id> --drive-file-name <name> [--commit]
// Dry-run por default, como o resto dos scripts deste diretório.
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';

const envText = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const env = {};
for (const line of envText.split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); }
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const FOLDER = process.argv[2];
const COMMIT = process.argv.includes('--commit');
const fileIdIdx = process.argv.indexOf('--drive-file-id');
const fileNameIdx = process.argv.indexOf('--drive-file-name');
const DRIVE_FILE_ID = fileIdIdx !== -1 ? process.argv[fileIdIdx + 1] : null;
const DRIVE_FILE_NAME = fileNameIdx !== -1 ? process.argv[fileNameIdx + 1] : (FOLDER ? FOLDER.split(/[\\/]/).pop() : null);

if (!FOLDER || FOLDER.startsWith('--') || !DRIVE_FILE_ID) {
  console.error('Usage: node scripts/import-drive-enrichment.mjs <path-to-batch-folder> --drive-file-id <id> [--drive-file-name <name>] [--commit]');
  process.exit(1);
}

function normalizeDomain(url) {
  if (!url) return null;
  try {
    const withProto = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const host = new URL(withProto).hostname.replace(/^www\./, '').toLowerCase();
    return host || null;
  } catch { return null; }
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else field += c;
    } else if (c === '"') { inQuotes = true; }
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

function readCsv(prefix) {
  const file = readdirSync(FOLDER).find((f) => f.startsWith(prefix) && f.endsWith('.csv'));
  if (!file) throw new Error(`No CSV starting with "${prefix}" found in ${FOLDER}`);
  let text = readFileSync(join(FOLDER, file), 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = parseCsv(text);
  const header = rows[0];
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? '']))).filter((r) => Object.values(r).some((v) => v !== ''));
}

const nn = (v) => (v == null || v === '' || v.toLowerCase?.().startsWith('not_found')) ? null : v;

const entidades = readCsv('enriquecimento_entidades');
const pessoas = readCsv('enriquecimento_pessoas');

console.log(`Batch: ${entidades.length} entidades, ${pessoas.length} pessoas. Commit: ${COMMIT}`);

const ABLUTE_ORG_ID = 'bca54499-03c8-469b-a48d-b9f442e44f69';
const report = { updated: [], conflicts: [], needsReview: [], errors: [] };

for (const e of entidades) {
  const pipelineId = nn(e.pipeline_ids);
  const catalogId = nn(e.catalog_id_principal);
  const websiteDomain = normalizeDomain(nn(e.website_oficial));
  const label = e.nome_canonico || e.nome_original;

  let entityRow = null;

  if (pipelineId) {
    const { data } = await admin.from('entities').select('*').eq('id', pipelineId).eq('org_id', ABLUTE_ORG_ID).maybeSingle();
    entityRow = data ?? null;
  }
  if (!entityRow && catalogId) {
    const { data: cat } = await admin.from('catalog_entities').select('source_entity_id').eq('id', catalogId).maybeSingle();
    if (cat?.source_entity_id) {
      const { data } = await admin.from('entities').select('*').eq('id', cat.source_entity_id).eq('org_id', ABLUTE_ORG_ID).maybeSingle();
      entityRow = data ?? null;
    }
  }
  if (!entityRow && websiteDomain) {
    const { data: candidates } = await admin.from('entities').select('*').eq('org_id', ABLUTE_ORG_ID);
    entityRow = (candidates ?? []).find((c) => normalizeDomain(c.website) === websiteDomain) ?? null;
  }

  if (!entityRow) {
    report.needsReview.push({ entidade: label, reason: 'sem correspondência em entities (nem ID nem domínio) — candidato novo, não criado automaticamente (Bloco 3)', websiteDomain });
    continue;
  }

  const people = pessoas.filter((p) => p.entidade === e.nome_original || p.entidade === e.nome_canonico);
  const bestTarget = nn(e.melhor_pessoa_alvo);
  const keyPeopleCandidate = bestTarget || (people[0] ? `${people[0].pessoa} (${people[0].cargo_confirmado || 's/cargo'})` : null);

  const fields = {
    website: nn(e.website_oficial),
    general_partner_emails: nn(e.email_publico_confirmado),
    key_people: keyPeopleCandidate,
    source_url: nn(e.fontes_principais)?.split('|')[0]?.trim() ?? null,
  };

  const updates = {};
  const conflicts = [];
  for (const [col, newVal] of Object.entries(fields)) {
    if (newVal == null) continue;
    const currentVal = entityRow[col];
    if (currentVal == null || currentVal === '') { updates[col] = newVal; }
    else if (currentVal !== newVal) { conflicts.push({ field: col, current: currentVal, incoming: newVal }); }
  }
  const verifiedAt = nn(e.verificado_em);
  if (verifiedAt && (!entityRow.last_verified || new Date(verifiedAt) > new Date(entityRow.last_verified))) {
    updates.last_verified = verifiedAt;
  }
  if (!entityRow.source) updates.source = 'drive_motor_b';

  if (conflicts.length) {
    report.conflicts.push({ entidade: label, entityId: entityRow.id, conflicts });
  }
  if (Object.keys(updates).length === 0) {
    continue;
  }

  if (COMMIT) {
    const { error } = await admin.from('entities').update(updates).eq('id', entityRow.id);
    if (error) { report.errors.push({ entidade: label, error: error.message }); continue; }
  }
  report.updated.push({ entidade: label, entityId: entityRow.id, fields: Object.keys(updates), dryRun: !COMMIT });
}

if (COMMIT) {
  const { error: logErr } = await admin.from('investor_drive_import_log').upsert({
    drive_file_id: DRIVE_FILE_ID,
    drive_file_name: DRIVE_FILE_NAME,
    pack_type: 'enrichment',
    status: report.errors.length ? 'error' : (report.needsReview.length ? 'needs_review' : 'processed'),
    processed_at: new Date().toISOString(),
    entities_updated: report.updated.length,
    entities_flagged_review: report.needsReview.length,
    error_detail: report.errors.length ? JSON.stringify(report.errors) : null,
  }, { onConflict: 'drive_file_id' });
  if (logErr) console.error('WARNING: could not write import log:', logErr.message);
}

console.log(JSON.stringify(report, null, 2));
if (!COMMIT) console.log('\nDry run only — pass --commit to write, plus --drive-file-id / --drive-file-name for the log.');

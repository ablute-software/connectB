// Prompt 137 — enche a fila enrichment_jobs para o teste final obrigatorio:
// exactamente 6 VC + 3 business angels, nada mais (secao 6 do prompt).
//
// Os 3 angels nao existem como catalog_entities individuais — sao criados
// aqui, uma linha propria por pessoa, seguindo o precedente de
// src/app/api/portal/investor-profile/self-declare/route.ts (type='vc',
// verification_status='pending', is_test=false), com
// source='enrichment_pilot_20260808'. Escolhidos a partir da lista publica
// de membros do board da Cambridge Angels (86e4d35a-1672-4f77-9d03-1e4223db875d,
// https://www.cambridgeangels.com/angels) — sao os tres unicos da lista com
// LinkedIn ja publicado na propria pagina, o que reduz ambiguidade de
// pesquisa no piloto. Angels de rede costumam ter afiliacoes a outros
// fundos, o que exercita person_affiliations a serio (D6).
//
// Idempotente: nao recria angels ja inseridos por este script (procura por
// source), e o indice unico parcial em enrichment_jobs impede duplicar um
// job activo para o mesmo target.
//
// CORRECCAO (mesma sessao, antes de qualquer corrida do worker): os angels
// nao tem website — sao pessoas, nao empresas — por isso um job de Camada 1
// (target_type='entity') sobre eles falharia sempre com 'no_website' e nunca
// chegaria a exercitar nada. O que o prompt quer testar nos angels e
// exactamente Camada 2 (hook) e o caminho de multi-afiliacao (D6), nao um
// crawl de pagina de equipa que nao existe. Correccao: o pseudo-catalog_entities
// de cada angel fica (e' o alvo de outreach na pipeline), mas semeia-se
// directamente — custo zero de IA, mesmo principio de _pilot_seed_import.mjs —
// um catalog_people com o nome/LinkedIn ja publicos na pagina da Cambridge
// Angels, afiliado a esse pseudo-entity (kind='angel', is_primary=true), e
// enfileira-se um job de Camada 2 (target_type='person') sobre essa pessoa,
// nao um job de Camada 1 sobre a entidade.
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const envText = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const PILOT_SOURCE = 'enrichment_pilot_20260808';
const CAMBRIDGE_ANGELS_ID = '86e4d35a-1672-4f77-9d03-1e4223db875d';

const VC_ENTITY_IDS = [
  '11111111-0000-4000-a000-000000000004', // Faber — PT, sem key_people
  'fbde8b3e-1b4c-498e-bcee-6da27fd6424b', // Indico Capital Partners — PT, sem key_people
  'a9ad0726-07c8-4a3a-808e-aab7256ff62e', // Seedcamp — GB, sem key_people
  'e797379b-3b06-4711-8d20-12f4558b7a0f', // Armilar Venture Partners — PT, com key_people
  'bf17944b-d344-4333-b108-5f5c26fb13a1', // Cherry Ventures — DE, com key_people
  '9b8da962-bfb3-451b-bac6-31711b0a0f96', // Kima Ventures — FR, com key_people
];

// Nome + LinkedIn publicados verbatim em https://www.cambridgeangels.com/angels
const ANGELS = [
  { name: 'Amy Weatherup', linkedin: 'https://www.linkedin.com/in/amy-weatherup/' },
  { name: 'Robert Swann', linkedin: 'https://www.linkedin.com/in/robertswann/' },
  { name: 'Andy Phillipps', linkedin: 'https://www.linkedin.com/in/andyphillipps/' },
];

async function ensureAngelEntities() {
  const { data: existing } = await admin.from('catalog_entities').select('id, name').eq('source', PILOT_SOURCE);
  const byName = new Map((existing ?? []).map((e) => [e.name, e.id]));
  const ids = [];
  for (const angel of ANGELS) {
    const name = `${angel.name} — Cambridge Angels member`;
    if (byName.has(name)) {
      ids.push(byName.get(name));
      continue;
    }
    const { data: created, error } = await admin
      .from('catalog_entities')
      .insert({
        name,
        type: 'vc',
        verification_status: 'pending',
        source: PILOT_SOURCE,
        catalog_status: 'imported',
        is_test: false,
        notes: `Business angel individual, membro publico da Cambridge Angels (${CAMBRIDGE_ANGELS_ID}). LinkedIn: ${angel.linkedin}. Criado para o teste final do Prompt 137 (${PILOT_SOURCE}).`,
      })
      .select('id')
      .single();
    if (error) throw new Error(`Falha a criar angel ${angel.name}: ${error.message}`);
    ids.push(created.id);
  }
  return ids;
}

function normalizeLinkedinForLookup(url) {
  return url.toLowerCase().trim().replace(/\?.*$/, '').replace(/\/(details|overlay)\/.*$/, '').replace(/\/+$/, '');
}

async function ensureAngelPerson(angel, entityId) {
  const normalized = normalizeLinkedinForLookup(angel.linkedin);
  const { data: existing } = await admin.from('catalog_people').select('id').eq('linkedin_url_normalized', normalized).maybeSingle();
  let personId = existing?.id;
  if (!personId) {
    const { data: created, error } = await admin
      .from('catalog_people')
      .insert({ full_name: angel.name, linkedin_url: angel.linkedin, entity_id: entityId, enrichment_status: 'pending' })
      .select('id')
      .single();
    if (error) throw new Error(`Falha a criar catalog_people para ${angel.name}: ${error.message}`);
    personId = created.id;
  }
  await admin
    .from('catalog_person_affiliations')
    .upsert({ person_id: personId, entity_id: entityId, kind: 'angel', is_primary: true, current: true }, { onConflict: 'person_id,entity_id,kind' });
  return personId;
}

async function enqueue(targetType, targetId, layer, priority) {
  // Nao usa upsert: o indice unico parcial (target_type,target_id,layer) so
  // existe enquanto status in ('queued','running'), por isso um insert
  // simples com onConflict apanharia o caso normal (job ja na fila) e
  // deixaria passar silenciosamente um reenfileiramento intencional depois
  // de done/failed — que aqui nunca queremos no piloto (uma corrida so).
  const { data: activeJob } = await admin
    .from('enrichment_jobs')
    .select('id, status')
    .eq('target_type', targetType)
    .eq('target_id', targetId)
    .eq('layer', layer)
    .in('status', ['queued', 'running'])
    .maybeSingle();
  if (activeJob) return { targetType, targetId, layer, action: 'already_queued', jobId: activeJob.id };

  const { data: created, error } = await admin
    .from('enrichment_jobs')
    .insert({ target_type: targetType, target_id: targetId, layer, priority, requested_by_org_id: null })
    .select('id')
    .single();
  if (error) throw new Error(`Falha a enfileirar ${targetType}/${targetId}: ${error.message}`);
  return { targetType, targetId, layer, action: 'enqueued', jobId: created.id };
}

async function main() {
  const angelIds = await ensureAngelEntities();
  console.log('Angels (catalog_entities):', angelIds);

  // Limpa jobs de Camada 1 deixados por uma corrida anterior deste script
  // (antes desta correccao) sobre os pseudo-entities dos angels — nunca
  // correram (status='queued'), remove-los e seguro.
  const { data: staleAngelJobs } = await admin
    .from('enrichment_jobs')
    .select('id')
    .eq('target_type', 'entity')
    .eq('layer', 1)
    .eq('status', 'queued')
    .in('target_id', angelIds);
  if (staleAngelJobs?.length) {
    await admin.from('enrichment_jobs').delete().in('id', staleAngelJobs.map((j) => j.id));
    console.log(`Removidos ${staleAngelJobs.length} jobs de Camada 1 obsoletos sobre pseudo-entities de angels.`);
  }

  const results = [];
  for (const id of VC_ENTITY_IDS) results.push(await enqueue('entity', id, 1, 50));
  for (let i = 0; i < ANGELS.length; i++) {
    const personId = await ensureAngelPerson(ANGELS[i], angelIds[i]);
    results.push(await enqueue('person', personId, 2, 50));
  }

  console.log(JSON.stringify(results, null, 2));
  console.log(`\n${results.filter((r) => r.action === 'enqueued').length} novos jobs, ${results.filter((r) => r.action === 'already_queued').length} ja existentes. Total de alvos: ${results.length} (esperado: 9 — 6 Camada 1 + 3 Camada 2).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

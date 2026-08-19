-- =============================================================================
-- 0189_catalog_field_consensus.sql
--
-- ESTADO: APLICADA EM PRODUCAO 2026-08-19 (revista e aplicada pelo Nuno,
-- verbatim -- Prompt 267). A policy catalog_field_consensus_select criada
-- aqui e apertada (removida) pela 0190_catalog_field_consensus_select_rls.sql
-- logo a seguir -- ver esse ficheiro para o porque.
--
-- Ficheiro companheiro: prompt_266_memoria_comunitaria_consenso_2_entradas_20260819.md
-- =============================================================================
-- Prompt 266 — memoria comunitaria sobre investidores: quando founders de
-- orgs DIFERENTES preenchem/corrigem, cada um no seu CRM privado, o MESMO
-- campo vazio do MESMO catalog_entities, e os valores concordam (textualmente
-- ou por veredito AI), o valor fica disponivel a todos com um sinal ligeiro
-- de incerteza, sujeito a voto ate virar facto verificado ou desaparecer.
--
-- catalog_field_consensus — uma linha por (catalog_id, field). `score`
-- comeca em 0 (so 1 fonte); passa a 2 quando a 2a fonte concordante chega
-- (o "score parte de 2" do prompt), depois so muda por voto (+-1). >=8
-- promove a facto verificado; <=0 esconde da vista partilhada — NUNCA
-- apaga (a tabela de fontes/votos fica, append-only, como tudo no resto
-- do schema). `value` no mesmo shape de contributions.value (jsonb).
create table if not exists catalog_field_consensus (
  id uuid primary key default gen_random_uuid(),
  catalog_id uuid not null references catalog_entities(id) on delete cascade,
  field text not null,
  value jsonb not null,
  score int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (catalog_id, field)
);

-- Uma linha por org que contribuiu para este campo — nunca duas do mesmo
-- org para o mesmo consensus_id (um org so "conta" uma vez, mesmo que
-- corrija a sua propria contribution mais tarde). contribution_id liga de
-- volta a origem privada (subject_type='entity') so para auditoria/debug;
-- org_id e o unico dado exposto a outros founders, e so como CONTAGEM, nunca
-- nome (§6 do prompt — anonimizado entre orgs).
create table if not exists catalog_field_consensus_sources (
  id uuid primary key default gen_random_uuid(),
  consensus_id uuid not null references catalog_field_consensus(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,
  contribution_id uuid references contributions(id) on delete set null,
  value jsonb not null,
  created_at timestamptz not null default now(),
  unique (consensus_id, org_id)
);

-- Um voto por org por campo, idempotente por construcao (unique) — votar de
-- novo ATUALIZA o proprio voto (a app faz upsert), nunca duplica nem apaga.
create table if not exists catalog_field_consensus_votes (
  id uuid primary key default gen_random_uuid(),
  consensus_id uuid not null references catalog_field_consensus(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,
  vote smallint not null check (vote in (-1, 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (consensus_id, org_id)
);

-- §4 — cache do veredito do arbitro AI ("mesmo valor, escrito diferente?"),
-- para nunca repetir a mesma chamada duas vezes. value_a/value_b gravados
-- SEMPRE em ordem lexicografica (a app garante isto antes do insert) para
-- um par invertido continuar a acertar na cache.
create table if not exists catalog_field_arbitration_cache (
  id uuid primary key default gen_random_uuid(),
  catalog_id uuid not null references catalog_entities(id) on delete cascade,
  field text not null,
  value_a text not null,
  value_b text not null,
  same_value boolean not null,
  canonical_value text,
  created_at timestamptz not null default now(),
  unique (catalog_id, field, value_a, value_b)
);

alter table catalog_field_consensus enable row level security;
alter table catalog_field_consensus_sources enable row level security;
alter table catalog_field_consensus_votes enable row level security;
alter table catalog_field_arbitration_cache enable row level security;

-- consensus (score+value): e exactamente o que fica visivel a qualquer
-- founder assim que a promocao acontece — legivel a qualquer sessao
-- autenticada, sem custo de privacidade (o VALOR em si e o que o proprio
-- backoffice/catalogo mostraria de qualquer forma, uma vez confiado).
-- A visibilidade real (score>0 e >=2 fontes) e filtrada pela ROTA, nao pela
-- RLS -- um developer no backoffice tem de ver linhas com score<=0/so 1
-- fonte tambem (§6), por isso a policy nao pode ser mais restritiva do que
-- "autenticado".
create policy catalog_field_consensus_select on catalog_field_consensus
  for select using (auth.role() = 'authenticated');

-- sources/votes/arbitration cache: nunca lidos directamente pelo cliente
-- (org_id de outro org e informacao interna, mesmo anonimizada por fora) --
-- so as rotas server-side (service-role) leem/escrevem estas tres.
-- Sem policies de select/insert/update/delete aqui, deliberado.

-- Prompt 213 §D — APLICADO EM PRODUÇÃO 2026-08-17 pelo revisor.
-- Verificado: tabela + items_v2 + RLS (1 policy) + os dois checks.
--
-- Categorias de eventos no roadmap: o founder define (nome livre, cor e
-- forma de um conjunto fechado), o investidor filtra por checkbox.
--
-- ESCOLHA FUNDAMENTADA (o prompt pedia "items_v2 jsonb OU tabela própria —
-- escolhe e fundamenta"): items_v2 jsonb na tabela que já existe.
--   * Um item não tem identidade própria — nada no sistema referencia um
--     item individual, portanto não se perde integridade nenhuma por não
--     haver FK. Uma tabela própria pagava joins e sort_order em todos os
--     leitores para proteger uma referência que não existe.
--   * A ordem dos itens é por-marco e já vive no array `items` de hoje; o
--     jsonb preserva exactamente essa semântica.
--   * Apagar uma categoria: um item cujo category_id já não resolve lê-se
--     como "General" (lookup-miss no leitor). É o mesmo comportamento que
--     ON DELETE SET NULL daria, sem trigger nenhum.
--
-- Retrocompatibilidade: `items text[]` NÃO é migrado nem removido. Os
-- leitores preferem items_v2 quando existe e caem para items-como-General
-- quando não; a conversão é lazy — ao guardar um marco, o editor escreve
-- items_v2. Nenhum dado existente é tocado por esta migração.
create table if not exists roadmap_categories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  label text not null,
  -- Conjuntos FECHADOS por check constraint, para não degenerar (a razão do
  -- prompt): cor de uma paleta de 8, forma de um conjunto de 4. Os valores
  -- são tokens, não hex livre — o cliente é que os mapeia a estilos, e o
  -- espelho TypeScript vive em src/lib/roadmap-categories.ts.
  color text not null check (color in (
    'teal','blue','amber','red','green','purple','pink','gray')),
  shape text not null default 'rounded' check (shape in (
    'rounded','square','pill','diamond')),
  created_at timestamptz not null default now()
);

create index if not exists roadmap_categories_org_idx on roadmap_categories(org_id);

alter table roadmap_categories enable row level security;

drop policy if exists roadmap_categories_org_members on roadmap_categories;
create policy roadmap_categories_org_members on roadmap_categories
  for all using (is_org_member(org_id)) with check (is_org_member(org_id));

-- Itens estruturados: array de {text, category_id|null}. null = General.
alter table company_roadmap_milestones add column if not exists items_v2 jsonb;

comment on table roadmap_categories is
  'Categorias de eventos do roadmap, definidas pelo founder (Prompt 213 D). O investidor filtra por elas no dossier.';
comment on column company_roadmap_milestones.items_v2 is
  'Array de {text, category_id|null}. Preferido sobre `items` quando presente; conversao lazy ao guardar. null category = General.';

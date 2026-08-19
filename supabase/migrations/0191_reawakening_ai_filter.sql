-- =============================================================================
-- 0191_reawakening_ai_filter.sql
--
-- ESTADO: PROPOSTO. NAO APLICADO. Requer decisao do Nuno antes de correr.
-- A sessao Code nunca chama apply_migration -- fica para o revisor aplicar.
--
-- Ficheiro companheiro: prompt_268_retoma_bloco_d_251_filtro_ai_20260819.md
-- =============================================================================
-- Prompt 251/253 Bloco D — filtro AI de segunda passagem sobre o motor
-- deterministico do Bloco B (rejection-code-match.ts). NUNCA um segundo
-- detector -- rejectionStillClashes/clearedRejectionCodes continuam a ser
-- a UNICA fonte de verdade sobre se um codigo limpou; este filtro so pode
-- correr DEPOIS de um clash-clear ja detectado, para decidir se/como essa
-- sugestao chega ao founder (deixar passar, melhorar a redacao, ou segurar
-- com razao registada -- nunca apagar nada).
--
-- reawakening_ai_filter_enabled: opt-in por org, default OFF. Sem toggle
-- ainda no Settings (fora do scope deste prompt) -- fica setavel por SQL/
-- backoffice ate uma tela propria existir, mesmo padrao de arranque de
-- outras flags deste codebase. NOT o padrao default=true de
-- swot_visible_to_investors/round_progress_visible_to_investors (0159/
-- 0174) -- aquelas sao opt-OUT retroactivo sobre comportamento ja existente;
-- esta e uma capacidade nova, o padrao correcto e opt-IN (mesmo shape de
-- pioneer_badge, 0167).
alter table orgs add column if not exists reawakening_ai_filter_enabled boolean not null default false;

comment on column orgs.reawakening_ai_filter_enabled is
  'Prompt 268 (251/253 Bloco D) — quando true, uma chamada AI julga cada clash-clear do motor deterministico (rejection-code-match.ts) antes da proposta chegar ao founder. Default false — capacidade nova, opt-in.';

-- reawakening_ai_filter_cache — o veredito por rejection_code_id, para
-- nunca pagar duas vezes a mesma chamada se o mesmo caso re-disparar
-- (addOrgAxisClassification em particular pode re-avaliar o mesmo codigo
-- em varios triggers ate ele ter uma proposta real). Mesmo desenho do
-- catalog_field_arbitration_cache (migration 0189, Prompt 266): chave
-- pela identidade do CASO, sem TTL (um veredito nao muda), so
-- service-role le/escreve. unique(rejection_code_id) -- um codigo so tem
-- um veredito na vida, tal como so tem uma proposta na vida (0186's
-- reawakening_proposals_rejection_code_unique).
--
-- verdict='hold' e o unico caminho em que este filtro impede uma
-- proposta/task de seres criadas -- mas a linha aqui fica, para sempre,
-- como o registo da razao (append-only, nunca apagar nada, per o proprio
-- requisito 2c do prompt). Sem policy de select: so a rota
-- /api/reawakening/rejection-filter (service-role) le/escreve.
create table reawakening_ai_filter_cache (
  id uuid primary key default gen_random_uuid(),
  rejection_code_id uuid not null references rejection_codes(id) on delete cascade,
  verdict text not null check (verdict in ('pass', 'enrich', 'hold')),
  ai_note text not null,
  enriched_rationale text,
  enriched_task_title text,
  created_at timestamptz not null default now(),
  unique (rejection_code_id)
);

alter table reawakening_ai_filter_cache enable row level security;

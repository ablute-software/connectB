-- Prompt 87 Bloco 1 — tabela de controlo de processamento dos pacotes do
-- Motor B (Drive -> pipeline). drive_file_id é a chave de deduplicação:
-- nome e número de lote NÃO são fiáveis (há duas sequências paralelas de
-- numeração e pelo menos um upload duplicado confirmado, "...19(1).zip").
-- Escalado como URGENTE (mini_prompt_escalar_urgente_prompt87_drive_sync_20260801.md).
create table if not exists public.investor_drive_import_log (
  id uuid primary key default gen_random_uuid(),
  drive_file_id text not null unique,
  drive_file_name text not null,
  pack_type text not null check (pack_type in ('enrichment', 'discovery', 'unknown')),
  status text not null default 'pending' check (status in ('pending', 'processed', 'error', 'needs_review')),
  processed_at timestamptz,
  entities_created int not null default 0,
  entities_updated int not null default 0,
  entities_flagged_review int not null default 0,
  error_detail text,
  created_at timestamptz not null default now()
);

comment on table public.investor_drive_import_log is
  'Prompt 87 Bloco 1: fonte de verdade de deduplicação por drive_file_id para os pacotes do Motor B (pasta Drive "03 Listas Atualizadas"). Nunca usar nome/número de lote como chave.';

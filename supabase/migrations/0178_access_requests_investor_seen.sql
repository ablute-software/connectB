-- APLICADO EM PRODUÇÃO 2026-08-17 (verificado por SQL: coluna
-- investor_seen_response_at presente em public.access_requests, tipo
-- timestamp with time zone, nullable, sem default — NULL = ainda não visto,
-- exatamente como o /api/portal/actions-required assume.)
-- Texto abaixo é o do revisor, verbatim.
--
-- Prompt 216 §C (lado do investidor) — "visto em" para access requests
-- respondidos. Nullable, sem default: NULL = ainda não visto. Zero
-- mudanças de RLS.
alter table public.access_requests
  add column if not exists investor_seen_response_at timestamptz;

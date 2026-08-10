-- APLICADO em produção (versão 20260809120244). Texto idêntico ao
-- aplicado — invoke_enrichment_worker() e o cron job enrichment_worker_sweep
-- confirmados ao vivo contra producao (pg_get_functiondef + cron.job).
--
-- Prompt 140 — automatizacao do enrichment-worker via pg_cron. Revista e
-- verificada contra producao antes de aplicar (mesmo padrao das
-- anteriores, ex. 0145/0146/0149).
--
-- Verificado directamente em producao antes de escrever este ficheiro
-- (nao assumido a partir da leitura do prompt):
--   - cron.job: so 'matchdeal_sla_sweep' existe (jobid=1, */15 * * * *,
--     active=true). Nenhum job aponta para o enrichment-worker.
--   - enrichment_jobs: layer1 done=91 failed=7 skipped=8, layer2 done=3,
--     zero 'queued' — confirma que tudo ate agora foi manual.
--   - pg_available_extensions: pg_net default_version=0.20.4,
--     installed_version=null (disponivel, nao instalado, como o prompt
--     afirma). pg_cron ja instalado (1.6.4).
--   - vault.secrets: vazio — nenhum segredo criado ainda (D2 fica para o
--     Nuno correr directamente no painel, fora deste ficheiro; o nome
--     esperado pela funcao abaixo e 'enrichment_worker_service_role_key').
--   - D3/D4 tal como propostos casam exactamente com a receita canonica da
--     Supabase para "pg_cron + pg_net invoca uma Edge Function com segredo
--     do Vault" (supabase.com/docs/guides/functions/schedule-functions) —
--     sem alteracoes.
--
-- D5 (env vars da function deployada, fora do alcance de qualquer migracao
-- SQL — Supabase nunca expoe valores de secrets via API, por desenho, o
-- mesmo principio que justifica o Vault no D2):
--   - ENRICHMENT_ENABLED: CONFIRMADO true. Invocado directamente
--     (dryRun:false, fila vazia — sem custo possivel de qualquer forma) e a
--     resposta foi {"ok":true,"processed":0,...}, nunca o early-return
--     {"skipped":true,"reason":"ENRICHMENT_ENABLED is false"} que o codigo
--     devolve quando a flag esta a false. Prova comportamental directa, nao
--     leitura do valor.
--   - ENRICHMENT_DAILY_COST_CAP_EUR: NAO CONFIRMADO por mim — gasto de hoje
--     e €0, por isso nenhuma chamada real chega ao ramo que devolveria
--     `cap` na resposta, e nao ha nenhuma via de leitura do valor puro do
--     segredo através de tool nenhuma. O valor "20" fica por confirmacao
--     directa do Nuno no painel (Project Settings -> Edge Functions ->
--     Secrets), nao por mim.
--
-- Fora de ambito: logica interna do worker, enrichment_jobs/fila em si,
-- access_grants, matchdeal_eligible_deck, qualquer tabela do MatchDeal.

-- D1 — activa pg_net (self-instala o schema `net`, sem clausula de schema).
create extension if not exists pg_net;

-- D3 — funcao que dispara a chamada, le a service role key do Vault (nunca
-- em texto simples nesta migracao nem em nenhum ficheiro do repositorio).
create or replace function public.invoke_enrichment_worker()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
begin
  select decrypted_secret into v_key
    from vault.decrypted_secrets
    where name = 'enrichment_worker_service_role_key';
  if v_key is null then
    raise warning 'invoke_enrichment_worker: segredo em falta, a saltar';
    return;
  end if;
  perform net.http_post(
    url := 'https://wkjcaoqdvhykrfacsylr.supabase.co/functions/v1/enrichment-worker',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
end;
$$;

revoke all on function public.invoke_enrichment_worker() from public, anon, authenticated;

-- D4 — regista o cron, mesma cadencia do matchdeal_sla_sweep (*/15 * * * *).
select cron.schedule(
  'enrichment_worker_sweep',
  '*/15 * * * *',
  $$select public.invoke_enrichment_worker();$$
);

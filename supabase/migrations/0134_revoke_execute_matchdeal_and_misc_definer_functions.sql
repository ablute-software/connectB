-- 0134 — fecha a exposição anónima de 18 funções SECURITY DEFINER pré-existentes.
--
-- APLICADA EM PRODUÇÃO A 06/08/2026 pelo revisor, ao abrigo da autorização
-- geral do Nuno de 05/08. Este ficheiro é o texto exacto aplicado; falta
-- commitá-lo para o repositório voltar a ser fonte da verdade do esquema.
-- Aplicar num ambiente que já a tem é inofensivo (revoke é idempotente).
--
-- ======================================================================
-- 1. O DEFEITO É SISTÉMICO, NÃO ERA DA 0129
-- ======================================================================
--
-- A 0133 fechou quatro funções criadas pela 0129 que tinham nascido com
-- EXECUTE para PUBLIC. Na altura tratámos aquilo como um lapso daquela
-- migração. Não era: é o default do Postgres para QUALQUER função nova, e
-- nunca ninguém varreu as que já cá estavam.
--
-- Levantamento em produção, 06/08/2026:
--
--   58 funções SECURITY DEFINER em public
--   49 executáveis pelo `anon`      (= por quem tiver a publishable key)
--   52 executáveis pelo `authenticated`
--   47 com a entrada `=X/postgres` à cabeça do proacl — o grant a PUBLIC
--
-- Só `matchdeal_pairing_poll` e `matchdeal_pairing_seal` têm um grant ao
-- `anon` DELIBERADO (grant explícito, sem entrada PUBLIC): são o pairing
-- pré-autenticação e têm de ser chamáveis sem sessão. Ficam como estão.
--
-- ======================================================================
-- 2. A EXPOSIÇÃO É REAL — PROVADA EM PRODUÇÃO, NÃO INFERIDA
-- ======================================================================
--
-- O PostgREST expõe qualquer função do schema `public` a quem tenha
-- EXECUTE, em POST /rest/v1/rpc/<nome>. Provado com a publishable key,
-- usando de propósito apenas funções de leitura:
--
--   entities_source_expanded()          -> HTTP 200, `true`
--   plan_catalog_quota(uuid-zeros)      -> HTTP 200, `null`
--     (lê `orgs`, uma tabela que o anon não consegue ler directamente)
--   GET /rest/v1/orgs                   -> HTTP 200, `[]`   (controlo: a RLS
--     funciona; é a função SECURITY DEFINER que passa por cima dela)
--   close_investor_interest_tasks(...)  -> HTTP 401, 42501  (controlo: a
--     revogação da 0133 funciona mesmo, e falha alto e reversível)
--
-- ======================================================================
-- 3. O ACHADO GRAVE: matchdeal_decide_dataroom_consent
-- ======================================================================
--
-- `matchdeal_decide_dataroom_consent(p_match_id, p_granted, p_decline_reason)`
-- é SECURITY DEFINER, executável pelo `anon` e pelo `authenticated`, e — lida
-- a definição viva em pg_proc.prosrc — NÃO faz nenhuma verificação de que
-- quem chama é a startup do match. Faz `perform matchdeal_grant_dataroom()`,
-- que escreve linhas reais em `access_grants`.
--
-- O único call site na aplicação é `admin.rpc(...)` dentro de
-- src/app/api/matchdeal/matches/consent/route.ts, e a verificação de posse
-- está NA ROTA, não na função. Como o UUID do match é conhecido pelos dois
-- lados do match, um investidor autenticado podia chamar a RPC directamente
-- e auto-conceder-se o data room da startup, sem o consentimento do founder.
--
-- A própria sessão Code documentou este risco num comentário no topo dessa
-- rota. Documentado não é mitigado: a mitigação era convenção — "não chames
-- isto do cliente" — e a convenção não é aplicável pelo Postgres.
--
-- O mesmo se aplica a `matchdeal_grant_dataroom(uuid)` e
-- `matchdeal_revoke_dataroom(uuid)`, chamáveis directamente, ambas sem
-- verificação de identidade, ambas a escrever em `access_grants`.
--
-- NOTA sobre a proibição permanente de tocar em `access_grants`: esta
-- migração não lhe toca. Não altera a tabela, nem os seus dados, nem as
-- funções que lá escrevem — altera apenas QUEM as pode invocar de fora.
-- Âncoras medidas antes e depois: 105 linhas, último granted_at
-- 2026-08-03 13:34:53.915+00. Inalteradas.
--
-- ======================================================================
-- 4. PORQUE `from public, anon, authenticated` E NÃO SÓ OS DOIS PAPÉIS
-- ======================================================================
--
-- Revogar só a `anon, authenticated` não faz nada: continuariam a herdar o
-- EXECUTE pela entrada PUBLIC. O alvo é o ACL que a 0133 já deixou nas suas
-- quatro: {postgres=X/postgres,service_role=X/postgres}. É esse o estado
-- final verificado depois de aplicar.
--
-- ======================================================================
-- 5. PORQUE NENHUMA CADEIA INTERNA PARTE
-- ======================================================================
--
-- Uma chamada aninhada dentro de uma função SECURITY DEFINER corre com os
-- privilégios do OWNER, não do chamador. As 18 são todas owned by `postgres`
-- e mantêm EXECUTE a `postgres` e a `service_role`. Levantamento das 13
-- chamadas internas: todas partem de funções SECURITY DEFINER owned by
-- postgres.
--
-- Validado empiricamente antes de aplicar, em transações descartadas, com
-- os revokes já em vigor e `set local role authenticated`:
--
--   catalog_is_visible()            -> plan_catalog_quota()            OK
--   matchdeal_weekly_quota_status() -> get_or_create_weekly_activity() OK
--   matchdeal_eligible_deck()       -> get_or_create_weekly_activity() OK
--                                      (1 linha devolvida, como esperado)
--
-- ======================================================================
-- 6. O QUE ESTA MIGRAÇÃO NÃO TOCA, E PORQUÊ
-- ======================================================================
--
-- (a) SEIS funções são infra-estrutura de RLS. Uma função usada dentro da
--     expressão de uma política é avaliada COMO O PAPEL CHAMADOR, logo esse
--     papel TEM de manter EXECUTE. Revogá-las partia a aplicação inteira:
--
--       is_org_member                    50 políticas
--       is_ablute_developer              42
--       is_platform_admin                33
--       matchdeal_current_profile_ids    15
--       matchdeal_current_membership_ids  4
--       catalog_is_visible                3
--
-- (b) `matchdeal_eligible_deck` — motor de matching, proibição permanente.
--     Fica em relatório, não em migração. (É também Tier 2, ver (d).)
--
-- (c) `matchdeal_my_profile()` e a família `vault_pin_*` — ligadas a
--     auth.uid() por dentro, portanto inofensivas na mão de quem quer que
--     seja; e chamadas do browser, portanto revogá-las partia funcionalidade.
--     `watson_*` e `catalog_blocked_count` — guardadas por is_org_member.
--     As trigger functions não são expostas pelo PostgREST.
--
-- (d) TIER 2 — precisa de correcção de CÓDIGO, não de privilégios:
--     matchdeal_record_swipe, matchdeal_undo_swipe, matchdeal_record_exposure
--     e matchdeal_eligible_deck são chamadas do browser e aceitam um
--     p_actor_profile_id / p_viewer_profile_id fornecido pelo cliente, sem
--     nenhuma amarração interna a auth.uid(). Revogar partia o deck; a
--     correcção é amarrar o parâmetro ao chamador dentro da função.
--
-- ======================================================================
-- 7. CALL SITES NA APLICAÇÃO (grep em src/ no commit af82bb3)
-- ======================================================================
--
-- Três ocorrências, todas benignas e todas do lado do servidor:
--   consent/route.ts:47                  admin.rpc(decide_dataroom_consent)
--   entities-source-expanded-capability  admin.rpc(entities_source_expanded)
--   observatory_query                    só em comentários e constantes
-- O `admin` client usa a service_role key, que mantém EXECUTE.

-- ----------------------------------------------------------------------
-- MatchDeal — consentimento e data room (o achado grave)
-- ----------------------------------------------------------------------
revoke execute on function public.matchdeal_decide_dataroom_consent(uuid, boolean, text)
  from public, anon, authenticated;

revoke execute on function public.matchdeal_grant_dataroom(uuid)
  from public, anon, authenticated;

revoke execute on function public.matchdeal_revoke_dataroom(uuid)
  from public, anon, authenticated;

-- ----------------------------------------------------------------------
-- MatchDeal — ciclo de vida do match e do pipeline
-- ----------------------------------------------------------------------
revoke execute on function public.matchdeal_handle_mutual_match(uuid, uuid)
  from public, anon, authenticated;

revoke execute on function public.matchdeal_reconcile_pipeline_entry(uuid)
  from public, anon, authenticated;

revoke execute on function public.matchdeal_startup_end_contact(uuid, text, boolean)
  from public, anon, authenticated;

revoke execute on function public.matchdeal_startup_report_no_response(uuid)
  from public, anon, authenticated;

revoke execute on function public.matchdeal_investor_still_interested(uuid)
  from public, anon, authenticated;

revoke execute on function public.matchdeal_reassign_next(uuid)
  from public, anon, authenticated;

revoke execute on function public.matchdeal_record_investor_action(uuid)
  from public, anon, authenticated;

revoke execute on function public.matchdeal_sweep_sla_timeouts()
  from public, anon, authenticated;

-- ----------------------------------------------------------------------
-- MatchDeal — quotas e super like
-- ----------------------------------------------------------------------
revoke execute on function public.matchdeal_activate_super_like(uuid, uuid)
  from public, anon, authenticated;

revoke execute on function public.matchdeal_get_or_create_weekly_activity(uuid)
  from public, anon, authenticated;

-- ----------------------------------------------------------------------
-- Observatório — agregados do ecossistema (só backoffice, service-role)
-- ----------------------------------------------------------------------
revoke execute on function public.observatory_query(jsonb, text)
  from public, anon, authenticated;

revoke execute on function public.observatory_snapshot(date)
  from public, anon, authenticated;

-- ----------------------------------------------------------------------
-- Catálogo e planos — leituras que passam por cima da RLS
-- ----------------------------------------------------------------------
revoke execute on function public.sync_catalog_unlocks(uuid)
  from public, anon, authenticated;

revoke execute on function public.plan_catalog_quota(uuid)
  from public, anon, authenticated;

revoke execute on function public.entities_source_expanded()
  from public, anon, authenticated;

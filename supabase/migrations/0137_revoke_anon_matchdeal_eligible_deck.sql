-- =============================================================================
-- 0137_revoke_anon_matchdeal_eligible_deck.sql
--
-- ESTADO: APLICADO em producao (wkjcaoqdvhykrfacsylr) em 06/08/2026, 17:5x UTC,
-- por decisao explicita do Nuno (Opcao D3, escolhida junto com a A2 da
-- 0136_bind_matchdeal_rpcs_to_caller.sql, na mesma resposta).
--
-- D3 do relatorio_tier2_matchdeal_rpcs_forjaveis_por_anon_20260806.md.
-- So ACL -- NAO toca no prosrc nem na ancora md5(prosrc) do motor de matching
-- (matchdeal_eligible_deck), que continua sob a proibicao permanente
-- "nao tocar". Fecha o angulo de enumeracao de perfis: sem isto, qualquer
-- anonimo podia listar perfis matchdeal (p.*) via esta RPC e usar os ids
-- forjados contra as tres RPC ja fechadas pela 0136.
--
-- Chamador real (MatchDealDeck.tsx:561) corre via browserClient() com sessao
-- GoTrue hidratada -> role authenticated. authenticated e service_role ficam.
--
-- PRE-VERIFICADO: md5(prosrc) = b74197a2e721df7112165064504e63b4, anon_pode e
-- public_pode = true, auth_pode = true (estado vulneravel, igual ao medido no
-- relatorio).
-- POS-VERIFICADO: md5(prosrc) = b74197a2e721df7112165064504e63b4 -- IDENTICO,
-- ancora intacta. anon_pode=false, public_pode=false, auth_pode=true.
-- =============================================================================

begin;

revoke execute on function public.matchdeal_eligible_deck(uuid, integer) from public, anon;

commit;

-- =============================================================================
-- VERIFICACAO CORRIDA A SEGUIR (resultado real, nao esperado):
-- =============================================================================
-- select p.proname, md5(p.prosrc) as md5_prosrc,
--        has_function_privilege('anon', p.oid, 'EXECUTE') as anon_pode,
--        has_function_privilege('public', p.oid, 'EXECUTE') as public_pode,
--        has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_pode
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname = 'matchdeal_eligible_deck';
--
-- Resultado: md5_prosrc = b74197a2e721df7112165064504e63b4 (inalterado),
--            anon_pode=false, public_pode=false, auth_pode=true.
-- =============================================================================

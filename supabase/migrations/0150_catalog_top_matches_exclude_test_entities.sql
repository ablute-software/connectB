-- APLICADO em produção 2026-08-08 22:02:25 UTC (versão 20260808220225).
-- Texto idêntico ao aplicado, md5 verificado (8f802cff61004ce6028b39aa3b46a34b).
-- Correcção ao mesmo dia da 0149, encontrada por mim ao correr o teste de
-- aceitação diretamente em produção (não um erro de leitura de código).

-- Correcao a 0149 (mesmo dia): catalog_top_matches nao filtrava is_test.
--
-- Achado ao correr o teste de aceitacao da 0149 directamente em producao
-- (nao um erro de leitura de codigo — so apareceu ao testar de facto):
-- chamar catalog_top_matches(org real da ablute_, 5) devolvia os 5 melhores
-- por pontuacao SEM considerar is_test, e a pontuacao 85 (mesma da Nina
-- Capital) calhou de empatar com as 5 entidades de teste/demo verificadas
-- do catalogo: os 4 fundos "(demo)" do seed do MatchDeal
-- (source='matchdeal_demo') e a pseudo-entidade "ablute_ — Internal QA"
-- (source='ablute_internal_qa') — todas com verification_status='verified'
-- e is_test=true (migracao 0139). Sem este filtro, unlockPack() teria
-- entregue estas 5 linhas de teste ao founder real da ablute_ juntamente
-- com investidores reais, na mesma pipeline.
--
-- Confirmado directamente: 6 linhas verified+is_test em producao (as 5
-- acima), 358 verified+nao-test. A correccao filtra apenas
-- catalog_top_matches (a funcao que decide o que e realmente entregue);
-- catalog_match_score continua a aceitar qualquer p_catalog_id que lhe
-- seja passado explicitamente (comportamento correcto para uso directo/
-- depuracao), simplesmente deixa de ser chamada para linhas de teste
-- porque catalog_top_matches nunca as inclui no universo pontuado.

create or replace function public.catalog_top_matches(p_org_id uuid, p_limit int)
returns table(catalog_id uuid, score int)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (is_org_member(p_org_id) or is_platform_admin()) then
    raise exception 'not authorized';
  end if;
  if p_limit <= 0 then return; end if;

  return query
    select scored.id as catalog_id, scored.score
    from (
      select ce.id, public.catalog_match_score(p_org_id, ce.id) as score
      from public.catalog_entities ce
      where ce.verification_status = 'verified'
        and not ce.is_test
        and not exists (
          select 1 from public.catalog_deliveries cd
          where cd.org_id = p_org_id and cd.catalog_id = ce.id
        )
    ) scored
    order by scored.score desc nulls last
    limit p_limit;
end;
$$;

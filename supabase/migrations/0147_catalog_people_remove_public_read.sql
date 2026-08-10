-- Correcao de seguranca a migracao 0146: remove a leitura publica de
-- catalog_people / catalog_person_affiliations para entidades verificadas.
--
-- 0146 copiou para as pessoas o mesmo padrao que catalog_entities ja usa
-- desde a 0002 ("verification_status = 'verified' -> visivel sem sessao").
-- Para uma entidade (fundo, empresa) isso e razoavel — e informacao de
-- negocio generica (nome, tese, sectores) e o directorio publico foi uma
-- decisao deliberada desde o inicio do produto. Para uma PESSOA identificada
-- (nome, cargo, URL do LinkedIn) e um erro categorico: e dado pessoal real,
-- agregado a partir de dezenas de fundos numa unica API sem autenticacao
-- nenhuma — qualquer scraper, nao so um utilizador da aplicacao, conseguia
-- pedir isto. Testado directamente em producao em 2026-08-08 (papel `anon`,
-- sem sessao): devolveu nome, cargo e LinkedIn de 10 pessoas da Shilling VC.
-- Apanhado pelo Nuno ao rever o relatorio de verificacao, correctamente
-- classificado como grave. A escolha de desenho era minha, na 0146 — fica
-- corrigida aqui.
--
-- catalog_people_research (o hook, a biografia, tudo o que e sintese cara)
-- nunca teve este ramo publico — fica exactamente como estava.
--
-- Depois desta correccao, o unico caminho de leitura para
-- catalog_people/catalog_person_affiliations passa a ser: admin da
-- plataforma, ou membro de uma org que tenha essa entidade em
-- catalog_deliveries (a mesma pipeline). Nunca publico, mesmo que a
-- entidade em si (catalog_entities) continue publica uma vez verificada —
-- essa parte nao muda, so as pessoas.
--
-- Sem impacto no Prompt 138 (EntityPeoplePanel / D1): esse painel ja lia
-- exclusivamente pelo ramo de catalog_deliveries, nunca dependeu do ramo
-- publico agora removido.

drop policy if exists catalog_people_read on public.catalog_people;
create policy catalog_people_read on public.catalog_people for select
  using (
    is_platform_admin()
    or exists (
      select 1 from public.catalog_person_affiliations cpa2
      join public.catalog_deliveries cd on cd.catalog_id = cpa2.entity_id
      where cpa2.person_id = catalog_people.id
        and is_org_member(cd.org_id)
    )
  );

drop policy if exists catalog_person_affiliations_read on public.catalog_person_affiliations;
create policy catalog_person_affiliations_read on public.catalog_person_affiliations for select
  using (
    is_platform_admin()
    or exists (
      select 1 from public.catalog_deliveries cd
      where cd.catalog_id = catalog_person_affiliations.entity_id
        and is_org_member(cd.org_id)
    )
  );

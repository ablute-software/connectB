-- =============================================================================
-- 0163_matchdeal_profiles_investor_sectors_taxonomy_reset.sql
--
-- ESTADO: PROPOSTO. NAO APLICADO. Requer decisao do Nuno antes de correr.
-- A sessao Code nunca chama apply_migration -- fica para o revisor aplicar.
--
-- Ficheiro companheiro:
--   prompt_176_taxonomia_sectores_e_badge_support_20260812.md §A.3
--
-- =============================================================================
-- O PROBLEMA
-- =============================================================================
-- matchdeal_profiles.sectors (kind='investor') foi gravado ate agora com os
-- 22 valores de investor-sector-taxonomy.ts (ex. 'fintech', 'AI/ML') --
-- ficheiro removido neste mesmo commit. O codigo aplicativo passa a ler/
-- escrever a taxonomia canonica de sector-taxonomy.ts (51 valores, ex.
-- 'FinTech & InsurTech', 'AI, Data & Analytics') -- zero overlap de string
-- com a antiga. Estas linhas ficam orfas: nunca batem com round.sectors
-- (startup), logo o peso de sector no match score (35 de 100 pontos,
-- investor-match-score.ts overlaps()) fica sempre a zero para elas.
--
-- Medido directamente na base de dados de producao (so leitura, sem
-- alterar nada) antes de decidir esta migracao:
--
--   total de linhas matchdeal_profiles kind='investor': 4
--   linhas com sectors preenchido: 3
--   dessas 3, TODAS usam exclusivamente a taxonomia antiga (0 usam a nova,
--   0 tem valores nao reconhecidos em nenhuma das duas)
--
-- As 3 linhas, em detalhe:
--   nunomarujo@gmail.com -- Individual investor: as 22 opcoes antigas
--     seleccionadas (leitura: conta pessoal/teste que marcou tudo, nao um
--     mandato curado real)
--   Invest green: ['foodtech']
--   ablute_ -- Internal QA: ['foodtech', 'agritech', 'AI/ML'] (fixture de
--     QA, explicito no proprio nome)
--
-- =============================================================================
-- O QUE ESTA MIGRACAO FAZ
-- =============================================================================
-- Decisao (confirmada, dado o volume ser tao pequeno e 2 das 3 linhas serem
-- contas de teste/QA): limpar sectors para '{}' nas linhas kind='investor'
-- que ainda usam exclusivamente a taxonomia antiga, em vez de tentar um
-- mapeamento automatico best-effort (pouco sinal real a recuperar para 3
-- linhas). O investidor volta a preencher a partir do picker novo
-- (InvestorProfilePanel.tsx, agora usando SectorPicker.tsx/
-- sector-taxonomy.ts) na proxima vez que abrir a sua ficha -- sem
-- consequencia funcional imediata (nao bloqueia login nem Pipeline).
--
-- So afecta linhas cujo array 'sectors' esta contido inteiramente na lista
-- antiga (nenhuma linha com qualquer valor da taxonomia nova e tocada,
-- mesmo que tambem tenha valores antigos misturados -- nao aconteceu nos
-- dados medidos, mas a condicao fica explicita para o caso de driftar antes
-- de esta migracao ser aplicada).
-- =============================================================================

begin;

with old_taxonomy(v) as (
  values ('AI/ML'), ('agritech'), ('biotech'), ('climate'), ('consumer'), ('cybersecurity'), ('deep tech'),
  ('digital health'), ('edtech'), ('enterprise software'), ('fintech'), ('foodtech'), ('hardware'),
  ('health'), ('life sciences'), ('marketplace'), ('medtech'), ('mobility'), ('proptech'), ('robotics'),
  ('saas'), ('sector-agnostic')
)
update public.matchdeal_profiles p
set sectors = '{}', updated_at = now()
where p.kind = 'investor'
  and p.sectors is not null
  and array_length(p.sectors, 1) > 0
  -- todos os valores do array pertencem a lista antiga (nenhum sobra fora dela)
  and not exists (
    select 1 from unnest(p.sectors) s where s <> all(select v from old_taxonomy)
  );

commit;

-- =============================================================================
-- VERIFICACAO PARA CORRER LOGO A SEGUIR
-- =============================================================================
-- select id, entity_name, sectors from public.matchdeal_profiles where kind = 'investor';
-- Esperado: as 3 linhas identificadas acima com sectors = '{}'; a 4a linha
-- (sem sectors preenchido antes) continua igual.
-- =============================================================================

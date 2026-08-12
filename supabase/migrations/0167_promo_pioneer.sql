-- ESTADO: PROPOSTO. NAO APLICADO. Requer decisao do Nuno antes de correr.
-- A sessao Code nunca chama apply_migration -- fica para o revisor aplicar.
--
-- Ficheiro companheiro: prompt_161_promo_pioneer_entitlement_e_referral_20260812.md

-- =============================================================================
-- O QUE ESTA MIGRACAO FAZ
-- =============================================================================
-- 1) promo_codes.is_pioneer -- distingue os codes da campanha Pioneer
--    (publicos, aceleradoras, portefolios de investidor) de um desconto
--    pontual qualquer. Sem esta coluna nada no resto do sistema tem como
--    saber a quem dar o badge permanente.
--
-- 2) promo_codes.referral_of_org_id -- atribuicao ("quem convidou quem")
--    para os 3 codes de referral que cada org Pioneer recebe automaticamente
--    ao ganhar o badge (§D do prompt). NULL para os codes de campanha
--    normais, criados a mao no back-office; preenchido apenas pelos codes
--    gerados pelo sistema (pioneer-server.ts). Referencia orgs, nao
--    promo_codes -- a origem e a ORG que recebeu o badge, nao um code
--    especifico (uma org so tem um badge, mas pode ter chegado la por
--    qualquer um dos seus proprios codes de campanha).
--
-- 3) orgs.pioneer_badge -- permanente, nunca removido automaticamente uma
--    vez true (§C.2). Independente de orgs.plan a partir do momento em que
--    e concedido -- um downgrade nunca o reverte.
--
-- =============================================================================
-- NOTA IMPORTANTE — plan_expires_at NAO FOI CRIADO, DELIBERADAMENTE
-- =============================================================================
-- O prompt (§B.2) pede uma coluna nova `orgs.plan_expires_at` para guardar a
-- validade do entitlement, com a instrucao explicita de "verificar primeiro
-- se ja existe algo equivalente antes de duplicar". Verificado: EXISTE, e ja
-- funciona bem -- promo_redemptions.benefit_ends_at (migracao 0040, Prompt
-- 40) + plan-server.ts (resolveUserPlan/bestFreeTrialTier, Prompt
-- 151/163-era) ja resolvem o tier EFECTIVO de uma org ao vivo, em cada
-- leitura, a partir da melhor redemption 100% ainda activa -- sem NUNCA
-- escrever orgs.plan nem precisar de nenhuma coluna de validade propria. O
-- reves ("downgrade") tambem ja acontece sozinho, sem cron: assim que
-- benefit_ends_at passa, isRedemptionCurrentlyActive() deixa de contar essa
-- redemption, e a org volta ao seu orgs.plan real (nunca alterado) no
-- proximo pedido -- nao ha nada para "reverter" porque orgs.plan nunca foi
-- escrito em primeiro lugar.
--
-- Duplicar isto com uma segunda coluna + um segundo mecanismo (escrever
-- orgs.plan a subir, um cron a fazer o downgrade manual) reintroduzia
-- exactamente o tipo de duas-fontes-da-verdade que este sistema evitou da
-- primeira vez. O UNICO mecanismo genuinamente novo que falta para o badge
-- Pioneer e capturar o MOMENTO em que uma redemption is_pioneer=true expira
-- -- isso e o que o job diario (pioneer-server.ts, chamado de
-- /api/automations) faz, lendo promo_redemptions.benefit_ends_at
-- directamente. Nenhuma coluna nova precisa disso.
-- =============================================================================

alter table promo_codes add column is_pioneer boolean not null default false;
alter table promo_codes add column referral_of_org_id uuid references orgs(id);
create index on promo_codes (referral_of_org_id) where referral_of_org_id is not null;

alter table orgs add column pioneer_badge boolean not null default false;

-- =============================================================================
-- VERIFICACAO PARA CORRER LOGO A SEGUIR
-- =============================================================================
-- select column_name from information_schema.columns
--   where table_name = 'promo_codes' and column_name in ('is_pioneer', 'referral_of_org_id');
-- select column_name from information_schema.columns
--   where table_name = 'orgs' and column_name = 'pioneer_badge';
-- -- Esperado: 3 linhas no total, todas presentes.
-- =============================================================================

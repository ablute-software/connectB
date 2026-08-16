-- Prompt 212 §A — PROPOSTO, NÃO APLICADO (aplica o revisor).
--
-- Checkbox do founder para a barra de progresso da ronda no portal do
-- investidor, no mesmo espírito do swot_visible_to_investors (0159).
--
-- A distinção que justifica existir um toggle aqui e não uma proibição
-- (decisão do Nuno, 2026-08-16, e agora na regra raiz do CLAUDE.md):
--   * performance DERIVADA da plataforma — passes, outreach, velocidade,
--     stats de pipeline — é proibida sempre, sem toggle. Não é do founder
--     para dar: é observação sobre ele.
--   * progresso DECLARADO pelo founder — round_secured_eur que ele escreveu,
--     soft commits que ele confirmou — é dele, e é prova social padrão num
--     pitch. Fica atrás desta escolha.
--
-- default true = comportamento actual, sem mudança silenciosa para quem já
-- mostra a barra hoje. Quem quiser esconder, desliga.
alter table orgs add column if not exists round_progress_visible_to_investors boolean not null default true;

comment on column orgs.round_progress_visible_to_investors is
  'Founder toggle: mostrar securedShown/softCommittedEur e a barra de % no portal do investidor. Prompt 212 A.';

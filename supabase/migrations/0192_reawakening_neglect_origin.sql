-- =============================================================================
-- 0192_reawakening_neglect_origin.sql
--
-- ESTADO: PROPOSTO. NAO APLICADO. Requer decisao do Nuno antes de correr.
-- A sessao Code nunca chama apply_migration -- fica para o revisor aplicar.
--
-- Ficheiro companheiro: prompt_271_frozen_por_causa_vs_desleixe_sherlock_avalia_20260819.md
-- =============================================================================
-- Prompt 271 §3 — reawakening_proposals ganha uma TERCEIRA origem:
-- 'neglect' (dropped_by_us — um fio abandonado, nunca uma porta fechada,
-- Sherlock avaliado sob pedido do founder). A migracao 0186 (Prompt
-- 251/253 Bloco B) so previa DUAS: um XOR estrito entre fact_id
-- (confirmacao de facto) e rejection_code_id (codigo de recusa limpo).
-- Nenhuma das duas se aplica a 'neglect' -- nao ha facto novo nem codigo
-- de recusa nenhum, so um fio que morreu.
--
-- Em vez de relaxar o XOR para "no maximo um" e inferir 'neglect' pela
-- AUSENCIA das outras duas (fragil, nao escala se aparecer uma 4a
-- origem no futuro), a origem fica explicita: trigger_kind, o mesmo
-- padrao que rejection_code_id ja seguiu ao ser adicionado em 0186 (uma
-- coluna real, nunca inferencia implicita). Backfill primeiro (as duas
-- origens existentes ja sao determinaveis pelas colunas que tem), so
-- depois NOT NULL.
alter table reawakening_proposals add column trigger_kind text;

update reawakening_proposals set trigger_kind = case
  when fact_id is not null then 'fact'
  when rejection_code_id is not null then 'rejection_code'
end
where trigger_kind is null;

alter table reawakening_proposals alter column trigger_kind set not null;

alter table reawakening_proposals drop constraint reawakening_proposals_trigger_xor;

alter table reawakening_proposals add constraint reawakening_proposals_trigger_kind_check
  check (trigger_kind in ('fact', 'rejection_code', 'neglect'));

-- Substitui o XOR de 2 colunas por uma consistencia de 3 vias: cada
-- trigger_kind implica exactamente que ancora esta preenchida.
-- 'neglect' nao tem ancora nenhuma (nem facto nem codigo) -- so
-- entity_id, ja not null em toda a tabela.
alter table reawakening_proposals add constraint reawakening_proposals_trigger_consistency
  check (
    (trigger_kind = 'fact' and fact_id is not null and rejection_code_id is null)
    or (trigger_kind = 'rejection_code' and rejection_code_id is not null and fact_id is null)
    or (trigger_kind = 'neglect' and fact_id is null and rejection_code_id is null)
  );

-- Sem indice unico para 'neglect' (ao contrario de rejection_code_id em
-- 0186, "uma proposta por vida"): ao contrario de um codigo de recusa
-- (um evento que so limpa uma vez), o "vale a pena reactivar" de um fio
-- abandonado pode mudar com o tempo (chega actividade nova) -- um
-- constraint de BD que bloqueasse para sempre depois da 1a avaliacao
-- impedia um pedido legitimo mais tarde. A deduplicacao (nunca pedir
-- duas vezes enquanto ja ha uma proposta 'pending' por resolver) fica
-- na app (a rota nova, nao aqui) -- app-level de proposito, nao um
-- constraint rigido.
create index on reawakening_proposals (trigger_kind);

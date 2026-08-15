-- Prompt 198 — root cause do bug "New interest" popup sem botão View (entityId
-- null). Confirmado em produção 2026-08-15.
--
-- matchdeal_record_interest_notification (0124/0127) cria a linha em
-- catalog_deliveries (via_pack=null) quando um investidor manifesta interesse
-- numa startup que ainda não "recebeu" esse investidor via catalog pack. Esse
-- insert caía sempre no trigger trg_catalog_deliveries_enforce_quota — a
-- mesma guarda pensada para o consumo deliberado de quota do founder
-- (via_pack IS NOT NULL). Qualquer org já acima da própria catalog_quota
-- (ex: ablute_, 525 entregas vs quota=40 — 521 delas de um bulk-seed de
-- 2026-07-27, nada a ver com consumo de quota) bloqueava a inserção
-- silenciosamente: a decisão (investor_relationship_decisions) ficava
-- gravada, mas a entidade/interação nunca era criada, e o popup do founder
-- ficava sem link nenhum para mostrar.
--
-- APLICADO EM PRODUÇÃO 2026-08-15 pelo revisor via mcp Supabase apply_migration
-- (nome: catalog_quota_exempt_interest_notification). Este ficheiro é a cópia
-- verbatim para o repositório, escrita idempotente.
--
-- Correcção: isentar da guarda de quota qualquer insert com via_pack IS NULL
-- (nunca é consumo de quota do founder, por definição — via_pack só é
-- definido por unlockPack). A contagem de "entregues" passa também a contar
-- só via_pack IS NOT NULL, para o histórico de bulk-seed/interesse orgânico
-- deixar de ocupar quota que nunca gastou.
CREATE OR REPLACE FUNCTION public.catalog_deliveries_enforce_quota()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_quota int;
  v_delivered int;
begin
  if is_ablute_developer() then
    return new;
  end if;

  if new.via_pack is null then
    return new;
  end if;

  select catalog_quota into v_quota from public.orgs where id = new.org_id;
  if v_quota is null then
    raise exception 'catalog_deliveries: org % sem catalog_quota definido', new.org_id;
  end if;
  select count(*) into v_delivered from public.catalog_deliveries where org_id = new.org_id and via_pack is not null;
  if v_delivered >= v_quota then
    raise exception 'CATALOG_QUOTA_EXCEEDED: org % ja tem % entregas, quota=%',
      new.org_id, v_delivered, v_quota;
  end if;
  return new;
end;
$function$;

-- Backfill: a única decisão 'interested' órfã encontrada em produção
-- (ablute_ / catalog 713278a8, decidida 2026-08-13, já vista) foi reconciliada
-- manualmente correndo a função de novo (idempotente — verifica
-- catalog_deliveries antes de criar) imediatamente a seguir a este fix.
-- select public.matchdeal_record_interest_notification(
--   'bca54499-03c8-469b-a48d-b9f442e44f69'::uuid,
--   '713278a8-295a-4d38-9642-fda7bbccbcad'::uuid,
--   null
-- );

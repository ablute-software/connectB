-- Prompt B — desbloqueio de escala: colunas novas em catalog_entities para
-- receber o backfill de entities (531 linhas, org ablute_) → catalog_entities
-- (camada 1, global). WRITTEN FOR REVIEW — NÃO aplicado. Quem corre isto é o
-- Nuno no SQL Editor.
--
-- Duas notas de desenho, para reveres com atenção:
--
-- 1. catalog_status (novo) é DIFERENTE de verification_status (já existe).
--    catalog_status é o eixo do backfill — 'verified'|'imported'|'demo',
--    definido no prompt como "tem pelo menos um contacto confirmado".
--    verification_status é o eixo do fluxo de admin-review já existente
--    ('pending'|'verified'|'rejected') e é O CAMPO QUE JÁ CONTROLA:
--      - RLS de leitura (catalog_read: só founders veem linhas
--        verification_status='verified'),
--      - a lógica de unlock de packs (unlockPack, store-supabase.tsx, só
--        copia linhas com verification_status==='verified' para o pipeline
--        do org que desbloqueia).
--    Se eu só preenchesse catalog_status e deixasse verification_status no
--    default 'pending', as linhas 'verified' do backfill ficavam invisíveis
--    para founders e inutilizáveis em packs — o oposto do objetivo. Por
--    isso o script de backfill escreve os dois em sincronia:
--      catalog_status='verified'  ⇒ verification_status='verified'
--      catalog_status='imported'  ⇒ verification_status='pending' (default)
--    As 7 linhas demo mantêm o verification_status que já têm (6 'verified',
--    1 'rejected') — não lhes toco.
--
-- 2. Critério de "contacto confirmado" (catalog_status='verified'):
--    entities.email IS NOT NULL OR entities.phone IS NOT NULL OR
--    (entities.submission_channel IS NOT NULL AND
--     entities.submission_channel_type <> 'unknown').
--    Critério do pack "Starter Europe" (25 melhores, "pessoa nomeada +
--    email/LinkedIn" — entities não tem coluna própria de LinkedIn ao nível
--    da entidade, só ao nível de pessoa, que não faz parte deste backfill):
--    key_people IS NOT NULL AND (email IS NOT NULL OR
--    general_partner_emails IS NOT NULL). Diz-me se querias outra coisa.

alter table catalog_entities
  add column if not exists source_entity_id uuid unique references entities(id),
  add column if not exists catalog_status text not null default 'imported'
    check (catalog_status in ('verified', 'imported', 'demo')),
  add column if not exists email text,
  add column if not exists phone text,
  add column if not exists address text,
  add column if not exists postal_code text,
  add column if not exists submission_channel text,
  add column if not exists submission_channel_type text,
  add column if not exists key_people text,
  add column if not exists general_partner_emails text,
  add column if not exists aum text,
  add column if not exists current_funds text,
  add column if not exists latest_fund text,
  add column if not exists last_investment_found text;

-- As 7 linhas atuais (todas com source_entity_id null, porque foram
-- escritas à mão, não copiadas) ficam marcadas 'demo' explicitamente —
-- nunca entram em packs, independentemente do resto do catálogo.
update catalog_entities set catalog_status = 'demo' where source_entity_id is null;

create index if not exists catalog_entities_status_idx on catalog_entities (catalog_status);
create index if not exists catalog_entities_country_idx on catalog_entities (hq_country);

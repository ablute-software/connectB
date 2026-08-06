-- 0140 — Rasto de notificação em investor_access_requests.
--
-- Contexto (item 10 da checklist de 06/08/2026): as rotas
-- src/app/api/backoffice/investor-access-requests/[id]/approve/route.ts e
-- .../reject/route.ts alteram o estado do pedido, criam o access_grants (no
-- caso do approve) e escrevem no audit log — mas NUNCA chamam
-- sendTransactionalEmail(). Verificado por leitura integral das duas rotas:
-- não existe um único import de '@/lib/resend' em nenhuma delas. O requerente
-- nunca sabe que foi aprovado ou recusado.
--
-- Esta migração só acrescenta o rasto; o envio em si é alteração de código.
-- Convenção copiada tal e qual de 0077_investor_relationship_decisions.sql
-- (notified_at timestamptz + notify_failed boolean not null default false),
-- para que o backoffice possa mostrar "notificado" / "falhou a notificação"
-- com a mesma leitura que já usa em pipeline-decisions.
--
-- Aditiva e inerte: nenhuma leitura existente muda de comportamento.

alter table public.investor_access_requests
  add column if not exists notified_at timestamptz,
  add column if not exists notify_failed boolean not null default false;

-- Mesma nota da 0139: os dois literais abaixo ficam sem acentuacao e com
-- hifen simples, byte a byte iguais ao texto aplicado em producao (version
-- 20260806202724, md5 dos statements e84c2d9bf3c74173084add11e29b9e32).
comment on column public.investor_access_requests.notified_at is
  'Quando o requerente foi notificado por email da decisao (approve/reject). Null = nunca notificado.';
comment on column public.investor_access_requests.notify_failed is
  'True quando a tentativa de envio falhou - permite ao backoffice mostrar e reenviar, em vez de a falha ficar invisivel.';

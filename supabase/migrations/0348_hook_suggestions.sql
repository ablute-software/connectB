-- Prompt 585 Phase 4 — §F: the AI hook-suggestion service's own persisted
-- table. One row per (org, target, channel, version). Never sent by the
-- platform (rule 4 — "o hook é rascunho"); the only way out is a founder
-- copying it or clicking "Use in draft" on the existing message composer.
create type public.hook_target_kind as enum ('person', 'entity');
create type public.hook_verdict as enum ('strong', 'weak', 'none');
create type public.hook_channel as enum ('platform_message', 'linkedin', 'email', 'form');

create table public.hook_suggestions (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  target_kind public.hook_target_kind not null,
  target_id uuid not null, -- catalog_people.id or catalog_entities.id, per target_kind
  entity_id uuid not null references public.catalog_entities(id) on delete cascade,
  channel public.hook_channel not null,
  version int not null default 1,
  verdict public.hook_verdict not null,
  hook_text text,
  claims jsonb not null default '[]',
  evidence_ids uuid[] not null default '{}',
  input_hash text not null,
  model text not null,
  cost_eur numeric(10, 5),
  ai_call_log_id uuid references public.ai_call_log(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  invalidated_at timestamptz,
  invalidated_reason text
);

-- §F.1 — "input_hash já existente → devolver a sugestão guardada sem
-- chamada". Scoped to NOT invalidated, so a regenerate after invalidation
-- still produces a fresh row rather than colliding.
create unique index hook_suggestions_dedup_uidx
  on public.hook_suggestions (org_id, target_kind, target_id, entity_id, channel, input_hash)
  where invalidated_at is null;

create index hook_suggestions_org_target_idx on public.hook_suggestions (org_id, target_kind, target_id);
create index hook_suggestions_evidence_ids_idx on public.hook_suggestions using gin (evidence_ids);

alter table public.hook_suggestions enable row level security;
create policy hook_suggestions_read on public.hook_suggestions for select
  using (is_platform_admin() or is_org_member(org_id));
-- No client write policy — same pattern as catalog_evidence (0344) and
-- every other privileged write in this codebase: the org-member-facing
-- write goes through /api/hooks/suggest (service role), never a direct
-- RLS-permitted client insert.
revoke all on public.hook_suggestions from anon, authenticated;
grant select on public.hook_suggestions to authenticated;

-- §F.5 — "evidência que passe a rejected/erased → invalida os hooks que a
-- citam". Fires on catalog_evidence transitioning INTO rejected/erased;
-- hook_text is kept (only GDPR erase, §I, nulls it) — the UI reads
-- invalidated_at to show "cited a source since removed — regenerate".
create or replace function public.hook_suggestions_invalidate_on_evidence_removed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('rejected', 'erased') and old.status not in ('rejected', 'erased') then
    update public.hook_suggestions
    set invalidated_at = now(), invalidated_reason = 'evidence_removed'
    where invalidated_at is null and evidence_ids && array[new.id];
  end if;
  return new;
end;
$$;

drop trigger if exists trg_hook_suggestions_invalidate on public.catalog_evidence;
create trigger trg_hook_suggestions_invalidate
  after update of status on public.catalog_evidence
  for each row execute function public.hook_suggestions_invalidate_on_evidence_removed();

revoke all on function public.hook_suggestions_invalidate_on_evidence_removed() from public, anon, authenticated;

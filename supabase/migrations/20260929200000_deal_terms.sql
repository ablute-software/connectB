-- Prompt 894 — "Terms on the table": negotiated deal conditions with memory,
-- a lock/confirm flow, and an archived closing memo. Nuno's own framing
-- (29/09/2026): "tudo isto são condições negociais em curso, entram para a
-- memória com data; botão para bloquear condições; quando acertadas,
-- confirma e encerra num doc arquivado, útil para todo o conhecimento da
-- startup e do negócio."
--
-- NOT applied to any live database by this session — a migration file only,
-- for Nuno's own reconciliation, per this repo's standing rule (CLAUDE.md
-- "Verifying a change in the browser"). No Supabase MCP apply_migration call
-- was made to produce this file.
--
-- ===========================================================================
-- §A — deal_terms: one row per condition, NEVER overwritten. A change (edit,
-- or a bare status change like Mentioned -> Negotiating -> Agreed) creates a
-- NEW row with supersedes_id pointing at the row it replaces — append-only,
-- same discipline as company_facts' own supersession model (§11a). The
-- "current" value of any one topic is whichever row nothing else supersedes.
--
-- kind/side/formality are text+check, not a Postgres enum — this migration
-- ledger has an entry (0345, duplicated filename) that already shows the
-- cost of colliding sequential numbers; text+check is also simply the
-- majority convention for a NEW table's own small closed vocabularies in
-- every migration from Prompt 852 onward (startup_investor_decisions,
-- company_role_coverage, contact_outcomes) — ALTER TYPE ... ADD VALUE would
-- work too but can't run inside the same transaction as anything that uses
-- the new value, which text+check avoids entirely.
create table if not exists public.deal_terms (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  entity_id uuid not null references public.entities(id) on delete cascade,
  -- The interaction this condition surfaced in, when it was recorded from
  -- the +Log "Amount asked" field or its sibling "Terms mentioned in this
  -- message" control. Null for a term added directly via "+ Add term".
  interaction_id uuid references public.interactions(id) on delete set null,
  -- Who presented/exposed this condition — optional, defaults to the last
  -- contacted person in the UI, never enforced here.
  person_id uuid references public.people(id) on delete set null,
  kind text not null check (kind in (
    'ask', 'offer', 'commitment', 'valuation', 'instrument',
    'lead_role', 'ticket_range', 'timing', 'other'
  )),
  side text not null check (side in ('ours', 'theirs')),
  formality text not null default 'mentioned' check (formality in ('mentioned', 'negotiating', 'agreed')),
  amount_eur numeric,
  text text,
  constraint deal_terms_has_a_value check (amount_eur is not null or (text is not null and btrim(text) <> '')),
  -- recorded_at is deliberately NOT defaulted to occurred_at/effective_at:
  -- Nuno's own words were "entram para a memória com data" meaning the date
  -- the founder pressed Save, which is what `now()` gives here — the exact
  -- distinction §A of the prompt draws between recorded_at and effective_at.
  recorded_at timestamptz not null default now(),
  -- When the condition was actually communicated, if different from when it
  -- was logged (e.g. logging a meeting summary a day later).
  effective_at date,
  -- Stamped only when a row transitions TO formality='agreed' (app-level;
  -- not a generated column, since a superseding row can also arrive already
  -- agreed with its own agreed_at rather than transitioning from a prior
  -- mentioned/negotiating row).
  agreed_at timestamptz,
  -- The row this one replaces (an edit, or a bare formality change). Never
  -- cleared, never repointed — the chain is permanent history.
  supersedes_id uuid references public.deal_terms(id) on delete set null,
  -- Filled in at Lock time (see the deal_memo section below): which memo
  -- archived this row as part of a closed negotiation snapshot.
  locked_by_memo_id uuid references public.documents(id) on delete set null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists deal_terms_entity_idx on public.deal_terms (entity_id, recorded_at desc);
create index if not exists deal_terms_org_idx on public.deal_terms (org_id);
create index if not exists deal_terms_supersedes_idx on public.deal_terms (supersedes_id) where supersedes_id is not null;
create index if not exists deal_terms_interaction_idx on public.deal_terms (interaction_id) where interaction_id is not null;

alter table public.deal_terms enable row level security;

-- Founder-privacy root rule (CLAUDE.md): ticket, valuation and negotiation
-- state must NEVER be visible to the investor side, directly or via join.
-- There is no investor branch in this policy at all, on purpose — an
-- investor's own auth.uid() (via their access_grants magic-link session)
-- matches neither is_org_member nor is_platform_admin, so RLS denies them
-- outright rather than relying on a query that merely doesn't select them.
create policy deal_terms_read on public.deal_terms for select
  using (is_org_member(org_id) or is_platform_admin());
create policy deal_terms_insert on public.deal_terms for insert
  with check (is_org_member(org_id));
create policy deal_terms_update on public.deal_terms for update
  using (is_org_member(org_id)) with check (is_org_member(org_id));
-- No delete policy anywhere, for anyone (not even is_org_member) — a term
-- row, once written, is history. "Undo" is superseding, never deleting.

-- ===========================================================================
-- §A — entities.interest_eur becomes DERIVED: the amount_eur of this
-- entity's latest non-superseded kind='commitment' row. A trigger (not an
-- application-level function) is the source of truth here, deliberately:
-- interactions/entities/deal_terms are all written directly from the
-- browser client under RLS in this codebase (store-supabase.tsx's own
-- `persist()` calls, not a server API route), so an application-level
-- "remember to call syncInterestFromTerms after every write" would silently
-- drift the moment a second write path appears (an import script, a future
-- admin tool). A trigger cannot be bypassed by forgetting.
create or replace function public.deal_terms_sync_interest(p_entity_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_amount numeric;
begin
  select dt.amount_eur into v_amount
  from public.deal_terms dt
  where dt.entity_id = p_entity_id
    and dt.kind = 'commitment'
    and not exists (select 1 from public.deal_terms dt2 where dt2.supersedes_id = dt.id)
  order by dt.recorded_at desc
  limit 1;

  update public.entities set interest_eur = v_amount::int where id = p_entity_id;
end;
$$;

create or replace function public.deal_terms_sync_interest_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'DELETE') then
    perform public.deal_terms_sync_interest(old.entity_id);
    return old;
  end if;
  perform public.deal_terms_sync_interest(new.entity_id);
  if (tg_op = 'UPDATE' and old.entity_id is distinct from new.entity_id) then
    perform public.deal_terms_sync_interest(old.entity_id);
  end if;
  return new;
end;
$$;

drop trigger if exists deal_terms_sync_interest_trg on public.deal_terms;
create trigger deal_terms_sync_interest_trg
  after insert or update or delete on public.deal_terms
  for each row execute function public.deal_terms_sync_interest_trigger();

-- §A — "ask_amount_eur mantém-se na interacção; ao guardar uma interacção
-- com esse valor, cria-se também uma linha deal_terms(kind='ask') — uma só
-- fonte para o gráfico." A DB trigger on `interactions` (not an application
-- call inside logInteraction) for the same reason as above: interactions
-- are inserted directly from the browser client, and this must fire for
-- every insert path (the app today, any future import script) without each
-- one remembering to also write deal_terms by hand. Only fires on INSERT —
-- no code path in this app updates ask_amount_eur after creation (checked
-- before writing this migration: EditInteractionDetails.tsx and
-- updateInteraction never touch that column).
create or replace function public.interactions_create_ask_term()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.ask_amount_eur is not null then
    insert into public.deal_terms (org_id, entity_id, interaction_id, person_id, kind, side, formality, amount_eur, recorded_at, effective_at)
    values (new.org_id, new.entity_id, new.id, new.person_id, 'ask', 'ours', 'mentioned', new.ask_amount_eur, new.created_at, new.occurred_at::date);
  end if;
  return new;
end;
$$;

drop trigger if exists interactions_create_ask_term_trg on public.interactions;
create trigger interactions_create_ask_term_trg
  after insert on public.interactions
  for each row execute function public.interactions_create_ask_term();

-- ===========================================================================
-- §C — Lock terms / negotiation state. Not named explicitly in the prompt's
-- own column list, but required to implement "a negociação fica fechada;
-- termos novos só depois de Reopen negotiation" — without a stored flag
-- there is no way to gate new deal_terms rows or the founder-facing "Lock
-- terms"/"Reopen negotiation" buttons on whether this entity is currently
-- locked. Deliberately on `entities`, not inferred from documents/deal_terms
-- history, so both the UI gate and any future RLS check are a single
-- column read, not a join + "no reopen since" scan.
alter table public.entities add column if not exists negotiation_locked_at timestamptz;

comment on column public.entities.negotiation_locked_at is
  'Prompt 894 §C — set when the founder locks this entity''s deal terms (a deal_memo document is created the same moment); cleared by "Reopen negotiation". While set, no new deal_terms row may be created for this entity (enforced in the app, not by a DB constraint — see TermsOnTheTable.tsx).';

-- ===========================================================================
-- §C — the archived closing memo lives in `documents` (private area of the
-- org), not a new table: it needs everything documents.* already gives it
-- (org scoping, RLS, a home in Files/Documents) and nothing it doesn't.
--
-- `documents` had NO `kind` column at all before this migration (checked:
-- 0001_init.sql's own `create table documents` and every later `alter table
-- documents add column` — 0022, 0027, 0205, 0244 — confirmed no such
-- column exists anywhere in this ledger). This migration adds it as a
-- nullable text+check, not a new enum type, matching the deal_terms
-- columns above and this migration's own reasoning: the only value it
-- needs today is 'deal_memo', and a future second kind should never need a
-- new migration just to add a string to an ALTER TYPE.
--
-- `entity_id` is also new on `documents` — the table was org-scoped only
-- (folders/grants are the existing way a document reaches a specific
-- investor), and a deal memo is instead a fact ABOUT one specific pipeline
-- entity, independent of any grant. Nullable: every existing document stays
-- unscoped exactly as before.
--
-- `deal_memo_payload` is the structured JSON snapshot ("para uso por
-- máquina" — the prompt's own words) — the founder-readable summary lives
-- in the existing `documents.notes` column, no new text column needed.
alter table public.documents add column if not exists kind text check (kind is null or kind in ('deal_memo'));
alter table public.documents add column if not exists entity_id uuid references public.entities(id) on delete set null;
alter table public.documents add column if not exists deal_memo_payload jsonb;

comment on column public.documents.kind is
  'Prompt 894 §C — null for every pre-existing document (untyped, as before). ''deal_memo'' is the one value this prompt introduces: an archived, code-generated snapshot of a closed negotiation, created by "Lock terms". No AI involved (out of scope — §F) and never shared with the investor by default (visibility defaults to due_diligence, same as any other document — see documents.visibility).';
comment on column public.documents.entity_id is
  'Prompt 894 §C — which pipeline entity (investor relationship) this document is specifically about. Null for every document that predates this column and for any document not tied to one specific entity (the normal case — most data-room documents are shared across investors via folders/grants, not scoped like this).';
comment on column public.documents.deal_memo_payload is
  'Prompt 894 §C — the deal_memo''s structured snapshot for machine use (entity, people, final terms table, the supersession chain, referenced interactions). Only ever set when documents.kind = ''deal_memo''.';

create index if not exists documents_entity_idx on public.documents (entity_id) where entity_id is not null;

-- ===========================================================================
-- §E verification notes (this session did NOT apply this migration or run
-- any of this against a live database — see CLAUDE.md and the delivery
-- report's own "RLS test approach" section):
--
-- RLS isolation (another org cannot read this org's deal_terms) follows
-- exactly the same is_org_member() function every other org-scoped table in
-- this schema already relies on (0001_init.sql's own generic member-policy
-- loop) — there is no new code path here for Postgres to get right, only a
-- new table using an already-proven one. A rollback-transaction proof
-- against real data (this repo's established pattern — see
-- migration_verification_via_rollback_transaction in the user's memory, and
-- Prompt 737's own 0A.5/0A.6 claim-simulation) is the right verification
-- for whoever next has a writable branch; the exact statements to run are
-- in scripts/verify-deal-terms-rls.sql (repo root, checked in — this is a
-- durable, reusable verification script, not a throwaway local one, hence
-- no leading underscore per this repo's own scripts/ naming convention),
-- never executed by this session.

-- Prompt 372 Block A — the piece access_requests never had: a request is a
-- list of NEEDS, not a list of files. access_request_items makes "the
-- investor asked for something that doesn't exist in the Vault yet" a
-- first-class state — the item is born with no document_id and can later
-- point at a fulfilled_document_id created well after the request itself.
--
-- access_requests gains `kind` (existing 'access'-kind requests, e.g.
-- "Request again" on an expired grant, are unaffected — they default to
-- 'access' and never gain items) and `message` (the investor's own free
-- text, shown to the founder verbatim in the pre-filled Log interaction).
alter table access_requests add column if not exists kind text not null default 'access' check (kind in ('access', 'document'));
alter table access_requests add column if not exists message text;
-- Mirrors investor_seen_response_at's own naming/shape (migration 0178) —
-- the founder-side equivalent, so the new popup can tell "never shown yet"
-- apart from "shown, founder dismissed it" without a second table.
alter table access_requests add column if not exists founder_seen_at timestamptz;

create table if not exists access_request_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references access_requests(id) on delete cascade,
  -- Filled ONLY when the investor picked a document that already exists.
  document_id uuid references documents(id) on delete set null,
  -- Free text when it does NOT exist yet ("2026 financial model").
  requested_label text,
  status text not null default 'pending' check (status in ('pending', 'granted', 'promised', 'declined')),
  -- The document that satisfied this item — may be created long after the
  -- request (Block E: founder uploads from their computer in response).
  fulfilled_document_id uuid references documents(id) on delete set null,
  promised_for date,
  decline_reason text,
  -- Block E §4 — the one case that's neither a Vault grant nor a decline:
  -- the founder answered by sending the file as a message attachment and
  -- explicitly chose NOT to add it to the Vault. Item still counts as
  -- 'granted' (the investor got their document) with fulfilled_document_id
  -- left null (there IS no Vault document) — this note is the only record
  -- of why, shown back to the founder on the item.
  resolution_note text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint access_request_item_has_target check (document_id is not null or requested_label is not null)
);

create index if not exists access_request_items_request_idx on access_request_items(request_id);

alter table access_request_items enable row level security;

drop policy if exists access_request_items_org_members on access_request_items;
create policy access_request_items_org_members on access_request_items
  for all
  using (exists (select 1 from access_requests ar where ar.id = access_request_items.request_id and is_org_member(ar.org_id)))
  with check (exists (select 1 from access_requests ar where ar.id = access_request_items.request_id and is_org_member(ar.org_id)));

comment on table access_request_items is
  'Prompt 372 Block A — one row per thing an investor asked for. document_id set only when it already exists in the Vault; requested_label carries the investor''s own words otherwise. fulfilled_document_id links the eventual answer back to the ask, even when that document is created long after the request.';

-- Prompt 372 Block C — new task source, same extension precedent as
-- 0128/0132 (investor_interest / interest_level_request).
alter table tasks drop constraint if exists tasks_source_check;
alter table tasks add constraint tasks_source_check
  check (source is null or source in ('suggested', 'manual', 'investor_interest', 'interest_level_request', 'document_request'));

-- Prompt 372 Block F — "the NDA is per document" needs a real link to
-- verify it against, or "per document" is just a claim in a comment.
alter table ndas add column if not exists document_id uuid references documents(id) on delete set null;
create index if not exists ndas_document_idx on ndas(document_id) where document_id is not null;

-- Prompt 524 — RECONSTRUCTED, not newly authored. Applied to production on
-- 2026-09-01 as supabase_migrations version 20260901122940
-- (`access_request_items_folders`); the file never reached any branch.
--
-- Body below is byte-for-byte what production ran: 1370 bytes, md5
-- 6f053f1db273625d0da5726926aacdc9, matching the stored statement exactly.
-- Renumbered from the original timestamp for the same lexicographic-ordering
-- reason documented at the top of 0289_founder_person_contributions.sql.
--
-- WHAT THIS IS, AND WHAT IS STILL MISSING. This is not a stray migration: it
-- adds folder_id to access_request_items, requires every item to name a real
-- target (document, folder or label), and backfills pending "system A"
-- requests (flat folder_ids/document_ids on access_requests) into
-- access_request_items. That is the unification of the two access-request
-- systems described in Prompt 518. The DATABASE half is live in production;
-- the APPLICATION half — POST /api/portal/access-requests writing derived
-- access_request_items at creation time, so /documents/requests/[id] always
-- resolves — exists in no branch. Recommitting this file does NOT complete
-- Prompt 518; that work is still outstanding.
--
-- The two inserts are guarded by `not exists` on access_request_items and by
-- existence checks against folders/documents, so a replay adds nothing twice
-- and skips targets that have since been deleted.

alter table public.access_request_items
  add column if not exists folder_id uuid references public.folders(id) on delete cascade;

create index if not exists access_request_items_folder_idx
  on public.access_request_items (folder_id) where folder_id is not null;

alter table public.access_request_items
  drop constraint if exists access_request_item_has_target;
alter table public.access_request_items
  add constraint access_request_item_has_target
  check (document_id is not null or folder_id is not null or requested_label is not null);

insert into public.access_request_items (request_id, folder_id, status)
select r.id, f.folder_id, 'pending'
from public.access_requests r
cross join lateral unnest(r.folder_ids) as f(folder_id)
where r.status = 'pending'
  and not exists (select 1 from public.access_request_items i where i.request_id = r.id)
  and exists (select 1 from public.folders fo where fo.id = f.folder_id);

insert into public.access_request_items (request_id, document_id, status)
select r.id, d.document_id, 'pending'
from public.access_requests r
cross join lateral unnest(r.document_ids) as d(document_id)
where r.status = 'pending'
  and not exists (
    select 1 from public.access_request_items i
    where i.request_id = r.id and i.document_id is not null
  )
  and exists (select 1 from public.documents doc where doc.id = d.document_id);

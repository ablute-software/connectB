-- NEXT_STEPS Phase 4 — Data Room with real files.
-- Private bucket, path-scoped by org: data-room/<org_id>/<uuid>-<filename>.
-- Org members read/write their own org's objects directly (RLS below).
-- Investors never get direct bucket access — the /api/portal/* routes use
-- the service-role key to validate access_grants server-side and mint
-- short-lived signed URLs, same pattern the code comment in 0001_init.sql
-- already documents for table access ("never through direct table access").

insert into storage.buckets (id, name, public)
values ('data-room', 'data-room', false)
on conflict (id) do nothing;

create policy "org members manage their own data-room objects"
on storage.objects for all
using (bucket_id = 'data-room' and public.is_org_member((storage.foldername(name))[1]::uuid))
with check (bucket_id = 'data-room' and public.is_org_member((storage.foldername(name))[1]::uuid));

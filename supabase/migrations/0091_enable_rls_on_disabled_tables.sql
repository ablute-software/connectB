-- Prompt 100 Bloco 3 — Supabase's own security advisor flagged rls_disabled_in_public
-- on these 4 tables (ERROR level): anon/authenticated could read+write every
-- row with no restriction. Confirmed by exhaustive codebase search: every
-- real access path (all in src/app/api/* routes, plus one standalone script
-- for investor_drive_import_log) goes through a service_role client, which
-- always bypasses RLS regardless of policy. No browser/anon-key client
-- touches any of these 4 tables anywhere in the codebase — so enabling RLS
-- with zero additional policies closes the hole without affecting any real
-- access path.
alter table public.startup_now_summaries enable row level security;
alter table public.investor_archive_entries enable row level security;
alter table public.startup_profile_snapshots enable row level security;
alter table public.investor_drive_import_log enable row level security;

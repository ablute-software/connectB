-- Fix a gap: admin_org_actions (0069) and analytics_events (0070) were
-- created without RLS enabled — every other admin-only table in this
-- schema (admin_audit_log, migration 0014) enables RLS with an
-- is_platform_admin() policy as defense-in-depth, even though the actual
-- routes always use the service-role client. Matching that convention.
alter table admin_org_actions enable row level security;
create policy admin_org_actions_admin on admin_org_actions for all
  using (is_platform_admin()) with check (is_platform_admin());

alter table analytics_events enable row level security;
create policy analytics_events_admin on analytics_events for all
  using (is_platform_admin()) with check (is_platform_admin());

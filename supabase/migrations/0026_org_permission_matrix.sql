-- Batch 3 C — owner-configurable role→capability matrix, org-scoped. Stored
-- as a jsonb overrides map ({ capability: role[] }); null/absent keys fall
-- back to the built-in defaults (src/lib/org-permissions.ts, which mirror
-- today's static matrix). The owner always keeps every capability regardless
-- of what's stored (resolveMatrix enforces that — no lockout possible).
-- Additive/nullable, capability-gated (src/lib/permission-matrix-capability.ts).
alter table orgs add column if not exists permission_matrix jsonb;

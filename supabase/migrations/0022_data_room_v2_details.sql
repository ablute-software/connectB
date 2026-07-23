-- Data Room V2 (founder feedback, 23 Jul) F1 — a free-text "details" field
-- per document (what it contains, version, who it was prepared for).
-- Additive/nullable, same convention as every prior narrow-column addition
-- (0018/0020/0021) — capability-gated via src/lib/data-room-capability.ts
-- so the UI stays inert until this is confirmed applied.
alter table documents add column if not exists details text;

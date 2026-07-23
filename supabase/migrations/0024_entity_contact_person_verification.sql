-- Founder feedback batch 2 (23 Jul). Additive/nullable, same convention as
-- every prior narrow-column addition (0018/0020/0021/0022/0023) —
-- capability-gated app-side so nothing changes until this is confirmed
-- applied. Numbering note: the founder's message assumed "migration 0022"
-- for item 1 (entity contact fields), written before knowing the Data Room
-- V2 session had already claimed 0022/0023 — this is 0024 instead.
--
-- Item 1 — entity profiles currently block editing/adding real contact
-- data (only website/email_domain exist, both indirect). Direct fields:
alter table entities add column if not exists email text;
alter table entities add column if not exists phone text;
alter table entities add column if not exists address text;

-- Item 3 — quick-created people (from /log's "Outra pessoa…") need a
-- gender field (Portuguese grammatical address — "Caro"/"Cara" — not
-- assumed for existing/imported contacts, only ever set by explicit
-- founder input for a specific person they know) and a verification flag
-- distinct from linkedin_verified (which is specifically about the
-- LinkedIn URL, not general identity). Existing/imported people default to
-- verified=true; only newly quick-created rows are inserted with false.
alter table people add column if not exists gender text;
alter table people add column if not exists identity_verified boolean not null default true;

-- Needs-review redesign (founder feedback, 23 Jul): the AI pre-classification
-- pass needs to tag which rows it (or deterministic mechanical logic) resolved
-- automatically, so the dossier UI can filter "AI-classified" and revert one
-- click back to needs_review. And the contact-metadata routine needs
-- somewhere to file the full original text of a detected contact card, since
-- entities has no general free-text notes field today (network_cluster_notes
-- is a different, narrower thing — network/dedup notes, not general notes).
-- Both additive, nullable, same convention as 0018/0020 — existing rows read
-- exactly as before (null), nothing here is required or destructive.
alter table interactions add column if not exists classified_by text; -- 'ai' | 'mechanical' | null (human/default)
alter table entities add column if not exists notes text;

create index if not exists interactions_classified_by_idx on interactions (org_id, classified_by) where classified_by is not null;

-- Prompt 359 — covering indexes for 0237/0238's foreign keys (Supabase
-- advisor 0001_unindexed_foreign_keys, INFO level).
create index if not exists roadmap_events_document_id_idx on roadmap_events(document_id);
create index if not exists roadmap_events_badge_id_idx on roadmap_events(badge_id);
create index if not exists roadmap_events_media_id_idx on roadmap_events(media_id);
create index if not exists roadmap_event_suggestions_document_id_idx on roadmap_event_suggestions(document_id);

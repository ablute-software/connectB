-- Batch 3 E5 — persisted document order within a folder, for drag-to-reorder
-- in the Data Room. Additive, default 0 so existing rows keep their current
-- (insertion) order until reordered. Capability-gated
-- (src/lib/document-ordering-capability.ts): drag-reorder stays off until
-- applied; move-to-folder (folder_id) and replace-file (storage_path) already
-- use existing columns and work regardless.
alter table documents add column if not exists position int not null default 0;
create index if not exists documents_folder_position_idx on documents (folder_id, position);

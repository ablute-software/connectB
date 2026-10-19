-- Prompt 918 (Adenda 1, C, 19/10/2026) — the entry page of a call has a cover image and the logo of the entity.
--
-- What changes (additive only; the old code never reads the new columns, so it keeps working until the deploy):
--   · calls.cover_path / calls.cover_updated_at — the call's cover image (PNG, JPG or WebP, checked by content and scanned like every other upload), kept in the private
--     `data-room` bucket under calls/<call id>/ and served through the platform's own routes (never a public bucket URL);
--   · calls.logo_path / calls.logo_updated_at — a logo uploaded FOR THIS CALL. Without it the page uses the logo of the entity's own profile (the firm's or the incubator's, when it
--     has one). The updated_at columns make the image URL change when the image does (a cache must never show the old one).
-- Duplicating a call copies the cover. The logo is the entity's.

alter table public.calls add column if not exists cover_path       text;
alter table public.calls add column if not exists cover_updated_at timestamptz;
alter table public.calls add column if not exists logo_path        text;
alter table public.calls add column if not exists logo_updated_at  timestamptz;

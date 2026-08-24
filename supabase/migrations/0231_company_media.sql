-- Prompt 353 — company photos & videos, distributed by category into the
-- investor dossier (Company -> About, Technology -> a "Product & technology"
-- block within About, Team -> Team). Writes go through service-role routes
-- only (upload/link/reorder/delete), same posture as every other admin
-- upload path in this schema — the org-member SELECT policy below is
-- defense-in-depth, not the write path.
create table company_media (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  kind text not null check (kind in ('image', 'video_upload', 'video_link')),
  category text not null check (category in ('company', 'technology', 'team')),
  caption text not null,
  -- Exactly one of storage_path/external_url is set, matching `kind':
  -- image/video_upload live in Storage; video_link is an allowlisted
  -- (YouTube/Vimeo-only, validated server-side) external URL — never a
  -- hotlinked image, only ever a video link.
  storage_path text,
  external_url text,
  content_sha256 text,
  -- video_link has nothing to scan (no file uploaded) — the insert route
  -- writes 'clean' for it directly; image/video_upload start 'pending' and
  -- get a real verdict from the same VirusTotal path the Vault uses.
  malware_scan_status text not null default 'pending' check (malware_scan_status in ('pending', 'clean', 'flagged')),
  malware_scan_checked_at timestamptz,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  constraint company_media_source check (
    (kind in ('image', 'video_upload') and storage_path is not null and external_url is null)
    or (kind = 'video_link' and external_url is not null and storage_path is null)
  )
);
create index company_media_org_idx on company_media (org_id, sort_order);

alter table company_media enable row level security;
create policy company_media_org_member on company_media for select
  using (is_org_member(org_id));
-- No investor-side policy: the investor-facing read goes through the
-- dossier's own service-role fetch (dossier-fetch.ts), same as every other
-- dossier field — RLS here only ever needs to serve the founder's own
-- Settings card reading its own org's rows.

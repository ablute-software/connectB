-- Prompt 305 §A — Prompt 301's upload-security.ts (detectAllowedKind +
-- scanWithVirusTotal) was only ever wired into the Vault's main upload
-- path. Confirmed by grep of every `storage.from('data-room').upload(`
-- call site that FOUR other routes write to the same bucket with zero
-- content validation: investor_verification_documents (identity docs
-- uploaded by an INVESTOR — an external, lower-trust caller by the
-- root privacy/security rule's own spirit), ndas, support_tickets'
-- attachment_urls (anonymous-allowed — see route comment), and
-- matchdeal_profiles' photo_url. Same "not_scanned is honest, never
-- assume clean" discipline as migration 0205: every existing row here
-- gets 'not_scanned', never a false 'clean'.
alter table public.investor_verification_documents
  add column if not exists malware_scan_status text not null default 'not_scanned'
    check (malware_scan_status in ('not_scanned', 'pending', 'clean', 'flagged')),
  add column if not exists malware_scan_checked_at timestamptz,
  add column if not exists content_sha256 text;

alter table public.ndas
  add column if not exists malware_scan_status text not null default 'not_scanned'
    check (malware_scan_status in ('not_scanned', 'pending', 'clean', 'flagged')),
  add column if not exists malware_scan_checked_at timestamptz,
  add column if not exists content_sha256 text;

-- matchdeal_profiles has exactly one CURRENT photo at a time (no version
-- history like documents/document_versions) — prefixed columns since this
-- table isn't document-specific.
alter table public.matchdeal_profiles
  add column if not exists photo_malware_scan_status text not null default 'not_scanned'
    check (photo_malware_scan_status in ('not_scanned', 'pending', 'clean', 'flagged')),
  add column if not exists photo_scan_checked_at timestamptz,
  add column if not exists photo_content_sha256 text,
  -- photo_url stores a long-lived (10-year) SIGNED URL, not the raw storage
  -- path — this is needed separately so a later 'flagged' verdict can
  -- actually delete the Storage object, not just null the URL column (the
  -- old signed URL would otherwise stay live for whoever already has it).
  add column if not exists photo_storage_path text;

-- support_tickets.attachment_urls is a flat text[] with no per-item row
-- (confirmed by reading upload-attachment/route.ts) — a dedicated table is
-- the only way to track a scan status per attachment without a schema
-- rewrite of that array column.
create table if not exists public.support_attachment_scans (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  storage_path text not null unique,
  malware_scan_status text not null default 'not_scanned'
    check (malware_scan_status in ('not_scanned', 'pending', 'clean', 'flagged')),
  malware_scan_checked_at timestamptz,
  content_sha256 text,
  created_at timestamptz not null default now()
);
create index if not exists support_attachment_scans_pending_idx
  on public.support_attachment_scans (malware_scan_status) where malware_scan_status = 'pending';

alter table public.support_attachment_scans enable row level security;
-- Same admin-only shape as every other backoffice-adjacent table in this
-- schema — support tickets themselves are already admin-managed
-- (support_tickets' own RLS), this is purely the scan-status ledger for
-- that same data, never read by the ticket submitter.
create policy support_attachment_scans_admin_only on public.support_attachment_scans
  for all using (is_platform_admin()) with check (is_platform_admin());

comment on column public.investor_verification_documents.malware_scan_status is
  'Prompt 305 §A. not_scanned = pre-existing row from before this validation existed. See /api/portal/investor-profile/upload-document and lib/upload-security.ts.';
comment on column public.ndas.malware_scan_status is
  'Prompt 305 §A. not_scanned = pre-existing row from before this validation existed. See /api/data-room/nda-upload.';
comment on column public.matchdeal_profiles.photo_malware_scan_status is
  'Prompt 305 §A. Only the CURRENT photo_url is scanned — no version history for this field. See /api/matchdeal/photo.';
comment on table public.support_attachment_scans is
  'Prompt 305 §A — per-attachment malware scan ledger for support_tickets.attachment_urls (a flat text[] with no per-item row of its own). Admin-only read/write.';

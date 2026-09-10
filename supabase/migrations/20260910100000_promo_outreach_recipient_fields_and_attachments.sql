-- Prompt 876 — richer outreach form + document attachments.
--
-- §A: four new nullable columns. recipient_name/recipient_email describe the
-- startup that will actually receive the promo code (distinct from `name`,
-- the program/VC's OWN name, and from the existing email/phone columns,
-- which are the program/VC's own contact channel). contact_person_name is a
-- short structured field for the program/VC's own contact; program_info is
-- free text covering what the program is, its type/format (e.g. "it's a
-- call"), and who at SherlockDeal made the contact.
alter table promo_outreach_targets add column if not exists recipient_name text;
alter table promo_outreach_targets add column if not exists recipient_email text;
alter table promo_outreach_targets add column if not exists contact_person_name text;
alter table promo_outreach_targets add column if not exists program_info text;

-- §C: multi-document attachments, modelled on support_attachment_scans
-- (0207) but as a proper join table rather than an array + side-ledger —
-- unlike support_tickets.attachment_urls, there is no existing flat array
-- column here to hang a side-ledger off, and each file needs its own label
-- (proof_of_publicity / contract / other), which a side-ledger keyed only
-- by storage_path can't express as cleanly as a real row per file.
--
-- malware_scan_status's value set is FIVE values, not the four the prompt's
-- own template listed ('not_scanned','pending','clean','flagged') — flagged
-- deviation, not a silent reshape: migration 0244 (25/08/2026) replaced the
-- VirusTotal-submission strategy app-wide with a hash-only lookup and, in
-- the same migration, widened EVERY existing malware_scan_status check
-- constraint in this schema to also allow 'local_only' — the honest,
-- ordinary outcome for a private file VT has never seen (or when
-- VIRUSTOTAL_API_KEY isn't configured at all, scanWithVirusTotal's own
-- documented behavior). scanWithVirusTotal() is the ONE function every
-- upload path in this app calls, this route included (per this prompt's
-- own instruction to use it "exactly like the support-attachment route
-- does") — a four-value constraint here would hard-fail the very first
-- upload the instant it returns 'local_only', the exact regression 0244's
-- own comment names as the reason to widen every caller together rather
-- than leave one behind.
create table promo_outreach_attachments (
  id                uuid primary key default uuid_generate_v4(),
  target_id         uuid not null references promo_outreach_targets(id) on delete cascade,
  label             text not null check (label in ('proof_of_publicity','contract','other')),
  storage_path      text not null,
  original_filename text not null,
  content_sha256    text,
  malware_scan_status text not null default 'not_scanned'
    check (malware_scan_status in ('not_scanned','pending','clean','local_only','flagged')),
  malware_scan_checked_at timestamptz,
  uploaded_by       uuid references auth.users(id),
  created_at        timestamptz not null default now()
);
alter table promo_outreach_attachments enable row level security;
create policy promo_outreach_attachments_platform_admin on promo_outreach_attachments for all
  using (is_platform_admin()) with check (is_platform_admin());
create index on promo_outreach_attachments (target_id);

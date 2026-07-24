-- Confidence-routed import (v2.1/v3.1 external research prompts, see
-- DECISIONS.md). address/email/phone already exist (migration 0024) — this
-- adds the remaining fields that were previously falling into `notes` free
-- text, which is exactly why they never surfaced on the investor profile.
-- Additive/nullable, same convention as every prior narrow-column addition.
alter table entities add column if not exists postal_code text;
alter table entities add column if not exists key_people text;
alter table entities add column if not exists general_partner_emails text;
alter table entities add column if not exists aum text;
alter table entities add column if not exists current_funds text;
alter table entities add column if not exists latest_fund text;
alter table entities add column if not exists last_investment_found text;

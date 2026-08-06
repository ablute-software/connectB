-- relatorio_verificacao_..._20260805 §4 — the Interaction log's own form
-- had no way to say WHO the interaction was with, and no way to attach a
-- document — not because the screen chose to hide either, but because the
-- table (0125) had nowhere to store either answer. Additive columns only.
--
-- person_id references company_people (the startup's own team, editable
-- on the founder's Company tab) rather than a free-text name, so a
-- reference stays meaningful if the founder later edits that person's
-- details. person_name_other covers the very common case this log exists
-- for in the first place: the person the investor actually spoke to often
-- isn't registered anywhere yet (a Head of BD, an intro contact, etc.) —
-- a final "Other…" option with free text, never blocking the entry on the
-- founder having listed everyone.
--
-- document_id references documents directly — NOT a new upload path (the
-- mini-prompt is explicit: don't invent storage when the data room already
-- has real access control). The API route validates server-side that the
-- chosen document is one this investor firm already has grant access to,
-- exactly like P134-C's own document_ids validation in
-- /api/portal/messages — an attachment can only ever point at something
-- already visible, never a side channel around the data room.
alter table investor_interaction_log
  add column if not exists person_id uuid references company_people(id) on delete set null,
  add column if not exists person_name_other text,
  add column if not exists document_id uuid references documents(id) on delete set null;

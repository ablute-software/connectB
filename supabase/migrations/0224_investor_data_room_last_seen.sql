-- Prompt 338 — the investor's "Data room" panel (renamed/grown from "Access
-- granted", Prompt 121 §2.5) needs a simple per-investor "when did you last
-- look at this" marker to compute the "new since your last visit" badge on
-- documents. One row per real investor identity already exists here
-- (matchdeal_investor_members, one per user_id) — reusing it is simpler
-- than a new single-purpose table for one nullable timestamp.
alter table matchdeal_investor_members add column if not exists data_room_last_seen_at timestamptz;

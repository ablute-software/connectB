-- Addenda ao Prompt 99 §1 — orgs.stage only had 5 values (pre_seed, seed,
-- series_a, later, other), so everything post-Series-A collapsed into
-- "later" — too coarse to calibrate review criteria (or, later, ecosystem
-- stats) by real stage. Confirmed no function hardcodes a CASE over all 5
-- existing values before adding these, so nothing needs updating alongside
-- this. orgs.stage_other stays the free-text escape hatch, unchanged.
alter type public.stage add value 'series_b';
alter type public.stage add value 'series_c_plus';

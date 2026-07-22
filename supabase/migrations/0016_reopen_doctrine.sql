-- IRM_SPEC — reopen doctrine: a `passed` entity is never blocked forever.
-- reopen_trigger records WHAT would have to change for a re-approach to be
-- legitimate (cited verbatim in any future draft, per the doctrine: a
-- re-approach must name the earlier "no" and what changed since).
-- reopen_eligible_after is an optional earliest-retry date for phase/
-- traction-type passes (e.g. "after pilot readout"), left null for
-- thesis/mandate-type passes that reopen on a positioning change instead
-- of a date.
alter table entities add column if not exists reopen_trigger text;
alter table entities add column if not exists reopen_eligible_after date;

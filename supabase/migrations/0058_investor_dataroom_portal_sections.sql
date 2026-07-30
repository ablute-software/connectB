-- Investor Workspace Fase 2 (prompt 55) — data room as a diligence journey.
-- Presentation-only layer: the founder's own internal folder structure is
-- untouched, this just adds an optional label the portal groups by. A
-- folder with no label doesn't appear in the portal at all (container
-- shells like the top-level "Materials"/"Data Room" folders stay
-- unmapped — their children carry the real mapping).
alter table folders
  add column if not exists portal_section text
  check (portal_section is null or portal_section = any (array[
    'start_here','product_market','traction_commercial','financial','team_governance','round_terms'
  ]));

-- Initial mapping for ablute_'s existing folders, per the table shown to
-- Nuno before this file was applied.
update folders set portal_section = 'start_here' where org_id = 'bca54499-03c8-469b-a48d-b9f442e44f69'
  and name in ('Pitch deck', 'Investor deck', 'One-pager', '00 Index and Summary', '01 Summary and Investment Dossier');

update folders set portal_section = 'product_market' where org_id = 'bca54499-03c8-469b-a48d-b9f442e44f69'
  and name in ('04 Technology, Product and IP', 'European trademark', 'Media | Prototype evidence', 'Patents', 'Scientific Publications', 'Software', 'Technology and Biomarkers');

update folders set portal_section = 'traction_commercial' where org_id = 'bca54499-03c8-469b-a48d-b9f442e44f69'
  and name in ('05 Commercial, Market and Pilot', 'Market Research', 'Partners Agreement', 'Pilot Plan and Annexes', 'Commercial, Market and Pilot');

update folders set portal_section = 'financial' where org_id = 'bca54499-03c8-469b-a48d-b9f442e44f69'
  and name in ('Financials', '03 Financial', 'Grants', 'Grant Agreements', 'Financial');

update folders set portal_section = 'team_governance' where org_id = 'bca54499-03c8-469b-a48d-b9f442e44f69'
  and name in ('02 Corporate & Governance', '06 Team', 'Corporate & Governance', 'Team');

update folders set portal_section = 'round_terms' where org_id = 'bca54499-03c8-469b-a48d-b9f442e44f69'
  and name in ('07 Regulatory and Compliance', '08 Due Diligence (Restricted)', 'Regulatory and Compliance');

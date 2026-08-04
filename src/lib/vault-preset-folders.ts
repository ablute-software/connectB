// Prompt 123 §0.2 — the Vault preset folder template, extracted to a single
// shared constant instead of living only as an inline array inside
// provision-org/route.ts. Measured in production: the real preset is 13
// folders (4 materials + 9 data-room sections); ablute_'s own 31 is a
// post-signup customization, not the template. Any doc/prompt that assumes
// 22 preset folders is describing a different, never-shipped template —
// PRESET_FOLDER_COUNT below is always the real, current number, derived
// from this list rather than hard-coded, so the two can never drift apart.
export const PRESET_MATERIALS_FOLDERS = ['Pitch deck', 'Investor deck', 'One-pager', 'Financials'];
export const PRESET_DATA_ROOM_FOLDERS = [
  '00 Index and Summary', '01 Summary and Investment Dossier', '02 Corporate & Governance',
  '03 Financial', '04 Technology, Product and IP', '05 Commercial, Market and Pilot', '06 Team',
  '07 Regulatory and Compliance', '08 Due Diligence (Restricted)',
];
export const PRESET_FOLDER_NAMES = [...PRESET_MATERIALS_FOLDERS, ...PRESET_DATA_ROOM_FOLDERS];
export const PRESET_FOLDER_COUNT = PRESET_FOLDER_NAMES.length;

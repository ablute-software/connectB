// Prompt 411 §A.2 — lookup registry for the BARS content banks. Same
// spirit as terms.ts's TERMS_MARKDOWN_BY_VERSION: content and version
// live together in src/content/bars/, a future revision is a NEW bank
// file plus a new key here, never a silent edit of an existing version's
// questions.
import { TEAM_V1 } from '../content/bars/team_v1';
import { MARKET_V1 } from '../content/bars/market_v1';
import { PRODUCT_V1 } from '../content/bars/product_v1';
import { TECHNOLOGY_V1 } from '../content/bars/technology_v1';
import type { BarsAxis, BarsBank } from './bars-types';

// Every axis's CURRENT bank version — bump per-axis when that axis's bank
// revises, independent of the others (unlike TERMS_VERSION, which is one
// global version, each BARS axis versions on its own schedule).
export const BARS_CURRENT_VERSION: Record<BarsAxis, string> = {
  team: 'team_v1',
  market: 'market_v1',
  product: 'product_v1',
  technology: 'technology_v1',
};

const BARS_BANKS: Record<string, BarsBank> = {
  'team:team_v1': TEAM_V1,
  'market:market_v1': MARKET_V1,
  'product:product_v1': PRODUCT_V1,
  'technology:technology_v1': TECHNOLOGY_V1,
};

// An unknown/stale version string falls back to that axis's CURRENT bank,
// same reasoning as getTermsMarkdown's own fallback (terms.ts) — never a
// hardcoded oldest-version fallback that would silently serve stale
// questions forever.
export function getBarsBank(axis: BarsAxis, version: string = BARS_CURRENT_VERSION[axis]): BarsBank {
  return BARS_BANKS[`${axis}:${version}`] ?? BARS_BANKS[`${axis}:${BARS_CURRENT_VERSION[axis]}`];
}

export function allCurrentBanks(): BarsBank[] {
  return (Object.keys(BARS_CURRENT_VERSION) as BarsAxis[]).map((axis) => getBarsBank(axis));
}

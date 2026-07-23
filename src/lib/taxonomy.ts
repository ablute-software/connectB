// Batch 3 E1 — a shared, standardized vocabulary for investor classification
// so sectors/geos/stage read consistently across every entity, instead of
// free-text drift ("fintech" vs "FinTech" vs "financial"). Each field offers
// these options plus an "outro…" free-text escape hatch, so nothing is lost
// when an investor doesn't fit the list. Pure data — no I/O.
import type { Stage } from './types';

// Investor sectors — health/deep-tech leaning (ablute_'s world) but broad
// enough to classify a mixed pipeline.
export const SECTORS: string[] = [
  'health', 'digital health', 'medtech', 'biotech', 'life sciences', 'wellness',
  'deep tech', 'hardware', 'AI/ML', 'saas', 'enterprise software', 'fintech',
  'marketplace', 'consumer', 'climate', 'mobility', 'edtech', 'foodtech',
  'cybersecurity', 'sector-agnostic',
];

// Geographies an investor covers — regions first, then countries.
export const GEOGRAPHIES: string[] = [
  'Portugal', 'Iberia', 'Europe', 'EU', 'UK', 'DACH', 'France', 'Benelux',
  'Nordics', 'US', 'North America', 'LatAm', 'Middle East', 'Africa', 'Asia', 'Global',
];

export const STAGE_OPTIONS: { value: Stage; label: string }[] = [
  { value: 'pre_seed', label: 'Pre-seed' },
  { value: 'seed', label: 'Seed' },
  { value: 'series_a', label: 'Series A' },
  { value: 'later', label: 'Later' },
];

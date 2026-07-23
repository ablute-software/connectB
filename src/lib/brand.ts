// Single source of truth for the product's public identity. This is a NAME
// change only (connectB → Sherlock Deal) — the visual design (colours #0E7490 /
// #22D3EE, layout, fonts) is unchanged, and a proper wordmark/logo comes later.
//
// Internal identifiers deliberately KEEP the old name — repo, table names,
// IRM_SPEC.md/DECISIONS.md, code comments — so there's no code-identifier churn.
// Only user-facing surfaces import from here; nothing user-visible should
// hard-code a product name anymore.
export const BRAND_NAME = 'Sherlock Deal';
export const BRAND_SHORT = 'sherlockdeal';

// The wordmark lockup is two-tone ("sherlock" + an accented "deal") — the split
// lives here rather than in markup so the logo component stays the only place
// that renders it. Joined, it is exactly BRAND_SHORT.
export const BRAND_WORDMARK: readonly [string, string] = ['sherlock', 'deal'];

// Canonical public URL for links we generate FOR users — invite accept links,
// portal/data-room links, Stripe checkout/portal return URLs. Building these
// from APP_URL means the domain cutover (sherlockdeal.com → this Vercel
// project) is one env change (NEXT_PUBLIC_APP_URL) + a redeploy, with no code
// edits. Until then it falls back to the current Vercel URL.
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://connect-b-delta.vercel.app';

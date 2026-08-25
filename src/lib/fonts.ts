// Prompt 385 §0/§D — Geist, scoped to the Roadmap tab only, per DESIGN.md's
// own typography tokens (400/500/600/700). App-wide adoption is a decision
// for Nuno later, not this prompt — every consumer wraps just its own
// Roadmap markup in `roadmapFont.className`, never the app shell.
//
// One conscious deviation from "via next/font" (CLAUDE.md's own words),
// documented per §0's own rule: next/font/google's built-in catalog on this
// Next 14.2.35 install has no Geist entry — confirmed empirically (TS2305,
// "no exported member 'Geist'") — Geist wasn't added there until a later
// Next release. The `geist` package (Vercel's own, npm) is the real
// next/font-compatible alternative: it ships the same variable font as
// static local files and exposes them through next/font/local under the
// hood, so this is still next/font, just via its `local` loader rather
// than `google` — never a plain <link> to Google Fonts.
import { GeistSans } from 'geist/font/sans';

export const roadmapFont = GeistSans;

// Prompt 385 — shared visual tokens for the Roadmap tab's premium pass
// ("Prism on White" glass, per DESIGN.md in the attached mockup). Centralized
// here, literal strings only (Tailwind's JIT scanner needs to see each class
// name written out — a string built by concatenation at runtime is invisible
// to it), so the founder canvas and the investor dossier render the exact
// same tokens instead of two hand-tuned copies drifting apart.
import type { CategoryColor } from '@/lib/roadmap-categories';

// Container radii per DESIGN.md: 24px for cards/panels, 8px for buttons/
// inputs — never the other way around.
export const GLASS_CARD =
  'relative rounded-[24px] border border-white/60 bg-white/40 shadow-[0_12px_40px_rgba(0,0,0,0.04)] backdrop-blur-xl';
export const GLASS_PILL =
  'rounded-full border border-white/60 bg-white/40 shadow-[0_12px_40px_rgba(0,0,0,0.04)] backdrop-blur-xl';

export const LABEL_CAPS = 'text-[12px] font-semibold uppercase tracking-[0.05em]';

// The three app-chrome tokens from DESIGN.md — never the per-category
// palette below, which stays the founder's own 8-color enum untouched.
export const PRISM = {
  primary: '#0041c8',
  primaryContainer: '#0055ff',
  secondary: '#006c46',
  tertiary: '#883600',
  error: '#ba1a1a',
  onSurface: '#131b2e',
  onSurfaceVariant: '#434656',
  outlineVariant: '#c3c5d9',
  surface: '#faf8ff',
};

// State chips for the derived three-state model (roadmap-canvas.ts's own
// derivedEventState) — secondary/primary/tertiary, exactly DESIGN.md's own
// "Colors" section mapping (Emerald=done, Blue=current/planned, Orange=risk
// /in-progress-attention).
export const STATE_CHIP = {
  completed: 'text-[#006c46] bg-[#006c46]/10',
  planned: 'text-[#0041c8] bg-[#0041c8]/10',
  in_progress: 'text-[#883600] bg-[#883600]/10',
} as const;
export const STATE_LABEL = { completed: 'COMPLETED', planned: 'PLANNED', in_progress: 'IN PROGRESS' } as const;
export const STATE_DOT = {
  completed: 'bg-[#006c46]', planned: 'bg-[#0041c8]', in_progress: 'bg-[#883600]',
} as const;

// Period bars (§A.1 — "barras finas... cor da categoria, SEM título") and
// point-event dots, per the founder's existing 8-color category enum
// (roadmap-categories.ts) — never a new palette, just a translucent-bar
// treatment of the same colors instead of a solid dot+label. Every value
// here is a literal, fully-spelled Tailwind class string on purpose (see
// header note) — never built by interpolating a color name at runtime.
export const CATEGORY_BAR: Record<CategoryColor, { bar: string; barSelected: string; ring: string; text: string }> = {
  teal: { bar: 'bg-[#0E7490]/20 border border-[#0E7490]/40', barSelected: 'bg-[#0E7490] shadow-md', ring: 'ring-2 ring-[#0E7490]/30', text: 'text-[#0E7490]' },
  blue: { bar: 'bg-blue-600/20 border border-blue-600/40', barSelected: 'bg-blue-600 shadow-md', ring: 'ring-2 ring-blue-600/30', text: 'text-blue-600' },
  amber: { bar: 'bg-amber-500/20 border border-amber-500/40', barSelected: 'bg-amber-500 shadow-md', ring: 'ring-2 ring-amber-500/30', text: 'text-amber-600' },
  red: { bar: 'bg-[#B00000]/20 border border-[#B00000]/40', barSelected: 'bg-[#B00000] shadow-md', ring: 'ring-2 ring-[#B00000]/30', text: 'text-[#B00000]' },
  green: { bar: 'bg-green-600/20 border border-green-600/40', barSelected: 'bg-green-600 shadow-md', ring: 'ring-2 ring-green-600/30', text: 'text-green-600' },
  purple: { bar: 'bg-purple-600/20 border border-purple-600/40', barSelected: 'bg-purple-600 shadow-md', ring: 'ring-2 ring-purple-600/30', text: 'text-purple-600' },
  pink: { bar: 'bg-pink-600/20 border border-pink-600/40', barSelected: 'bg-pink-600 shadow-md', ring: 'ring-2 ring-pink-600/30', text: 'text-pink-600' },
  gray: { bar: 'bg-gray-500/20 border border-gray-500/40', barSelected: 'bg-gray-500 shadow-md', ring: 'ring-2 ring-gray-500/30', text: 'text-gray-600' },
};

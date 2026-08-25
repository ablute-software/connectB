'use client';
// Prompt 379 §B — the ONE mini-pitch deck component, rendered by BOTH sides:
// the investor's dossier (DossierOverviewSections) and the founder's own
// MatchDeal tab preview. Extracted verbatim from the investor-side
// MiniPitchSlides so the investor's view is pixel-identical to before, and
// the founder is now looking at literally the same component rather than a
// second, drifting grey-list copy — the same "through the investor's eyes"
// principle the Data Room card already applies.
//
// PRODUCT DECISION (Nuno + verification, 2026-08-25) — read before
// "improving" this into a free-form editor:
//
//   The MatchDeal deck is a uniform format ON PURPOSE. It is what lets an
//   investor compare dozens of startups quickly, and what guarantees every
//   startup looks professional on any screen. Personalisation here is of
//   CONTENT — text, one image per slide, logo — NEVER of layout, typography
//   or positioning. The founder's own fully-designed deck lives in the Vault.
//
// So: no per-slide layout options, no font/colour controls, no draggable
// positions. An image occupies one fixed band at the top of the card, or
// there is no image.
import { useState } from 'react';

export type MiniPitchSlideKind = 'hook' | 'whyNow' | 'proof' | 'team' | 'ask';

export const MINI_PITCH_SLIDE_LABEL: Record<MiniPitchSlideKind, string> = {
  hook: 'Why us', whyNow: 'Why now', proof: 'Proof', team: 'Team', ask: 'The ask',
};

export interface MiniPitchViewSlide {
  kind: MiniPitchSlideKind;
  title?: string;
  body: string;
  // Resolved at render time from a mediaId — never a URL stored in the
  // slide jsonb, so deleting the image from Photos & media degrades the
  // slide to text instead of leaving a broken link behind (§D.4).
  imageUrl?: string | null;
  imageCaption?: string | null;
}

// The card itself — no navigation, no chrome. Shared by both callers so
// neither can drift; the deck wrapper below adds the paging.
export function MiniPitchSlideCard({ slide }: { slide: MiniPitchViewSlide }) {
  return (
    <>
      {slide.imageUrl && (
        // §D.2 — one fixed band, object-cover, position not configurable.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={slide.imageUrl} alt={slide.imageCaption ?? ''}
          className="mb-3 h-32 w-full rounded-lg object-cover" />
      )}
      {slide.title && <p className="mt-1 text-sm font-medium text-gray-700">{slide.title}</p>}
      <p className="mt-1 max-w-prose text-sm text-gray-700">{slide.body}</p>
    </>
  );
}

// The full deck with paging — the investor's exact existing markup.
export function MiniPitchDeck({ slides, footnote, headerRight, renderSlideExtra }: {
  slides: MiniPitchViewSlide[];
  footnote?: string;
  // Founder-side only: the Edit affordance and status chips. The investor
  // never passes these, so their view is unchanged.
  headerRight?: (index: number) => React.ReactNode;
  renderSlideExtra?: (index: number) => React.ReactNode;
}) {
  const [i, setI] = useState(0);
  if (slides.length === 0) return null;
  const safeIndex = Math.min(i, slides.length - 1);
  const slide = slides[safeIndex];

  return (
    <div id="mini-pitch" data-section="Pitch" className="scroll-mt-16 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900">{MINI_PITCH_SLIDE_LABEL[slide.kind]}</h2>
        <div className="flex shrink-0 items-center gap-2">
          {headerRight?.(safeIndex)}
          <span className="text-[11px] text-gray-400">{safeIndex + 1} of {slides.length}</span>
        </div>
      </div>
      <MiniPitchSlideCard slide={slide} />
      {renderSlideExtra?.(safeIndex)}
      <div className="mt-3 flex items-center gap-3">
        <button onClick={() => setI(Math.max(0, safeIndex - 1))} disabled={safeIndex === 0}
          className="text-xs font-medium text-[#0E7490] hover:underline disabled:cursor-not-allowed disabled:text-gray-300 disabled:no-underline">
          ← Back
        </button>
        <div className="flex gap-1">
          {slides.map((_, idx) => (
            <button key={idx} onClick={() => setI(idx)} aria-label={`Slide ${idx + 1}`}
              className={`h-1.5 w-1.5 rounded-full ${idx === safeIndex ? 'bg-[#0E7490]' : 'bg-gray-200'}`} />
          ))}
        </div>
        <button onClick={() => setI(Math.min(slides.length - 1, safeIndex + 1))} disabled={safeIndex === slides.length - 1}
          className="text-xs font-medium text-[#0E7490] hover:underline disabled:cursor-not-allowed disabled:text-gray-300 disabled:no-underline">
          Next →
        </button>
      </div>
      {footnote !== undefined
        ? (footnote && <p className="mt-2 text-[10px] text-gray-400">{footnote}</p>)
        : <p className="mt-2 text-[10px] text-gray-400">Generated from company-provided data.</p>}
    </div>
  );
}

'use client';
// Prompt 742 §D.4 — the same overlay for all three renderable kinds (PDF
// pages, an image, an embedded iframe): diagonal, semi-transparent,
// repeated, carrying the reader's own email + today's date. Deterrence,
// not DRM (D.4's own words) — a determined viewer can always screenshot
// past it, so this is never presented anywhere as real protection.
export function DocumentWatermark({ email }: { email: string }) {
  const label = `${email} · ${new Date().toISOString().slice(0, 10)}`;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden select-none" aria-hidden="true">
      <div className="grid h-[200%] w-[200%] -translate-x-1/4 -translate-y-1/4 rotate-[-30deg] grid-cols-3 gap-16 opacity-[0.12]">
        {Array.from({ length: 30 }, (_, i) => (
          <span key={i} className="whitespace-nowrap text-sm font-semibold text-black">{label}</span>
        ))}
      </div>
    </div>
  );
}

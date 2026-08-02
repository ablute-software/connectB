'use client';
// Prompt 97 §4 — confirmed sequencing: Boost & Extra gets built AFTER Hype
// List v2 (Bloco 2) is operational, not before. The footer reserves its
// position now (this is the tab that opens); the actual plan/consumption/
// buy-more UI described in §4 stays unbuilt until that dependency clears.
// Not a stub for lack of backend, either — matchdeal_activate_super_like /
// matchdeal_startup_hype already exist and work end-to-end at the DB layer
// (found live while surveying this prompt) — what's missing is exclusively
// this client UI, deliberately not built yet per the confirmed sequencing.
export function BoostExtraPanel() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
      <div className="text-4xl">🚀</div>
      <p className="mt-3 text-[15px] font-semibold text-white">Boost & Extra is coming soon</p>
      <p className="mt-1.5 max-w-xs text-[13px] leading-relaxed text-white/60">
        This lands right after the Hype List ships — plans, usage, and buy-more options will show up here.
      </p>
    </div>
  );
}

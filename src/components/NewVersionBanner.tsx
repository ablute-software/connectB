'use client';
// "A new version of Sherlock Deal is available — Reload" (Nuno, 16/10/2026). Asks /api/version every 10 minutes while the tab is visible and when the person comes back to
// the tab; if the server is on another build than this page was loaded from, shows a discreet strip with a Reload button. It NEVER reloads on its own — someone may be in
// the middle of writing — and it stays quiet in development and whenever the answer is missing or unusable.
import { useEffect, useRef, useState } from 'react';
import { BRAND_NAME } from '@/lib/brand';
import { CURRENT_BUILD_ID, VERSION_CHECK_EVERY_MS, buildIdFromResponse, isNewVersion, shouldCheckNow } from '@/lib/build-version';

export function NewVersionBanner() {
  const [available, setAvailable] = useState(false);
  const last = useRef<number | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !CURRENT_BUILD_ID) return;
    let stopped = false;
    const check = async () => {
      if (stopped || document.visibilityState !== 'visible' || !shouldCheckNow(last.current, Date.now())) return;
      last.current = Date.now();
      try {
        const res = await fetch('/api/version', { cache: 'no-store', credentials: 'same-origin' });
        if (!res.ok) return;
        if (isNewVersion(CURRENT_BUILD_ID, buildIdFromResponse(await res.json()))) { setAvailable(true); stopped = true; }
      } catch { /* offline or a hiccup: ask again next time */ }
    };
    const timer = window.setInterval(() => void check(), VERSION_CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => { stopped = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', check); window.removeEventListener('focus', check); };
  }, []);

  if (!available) return null;
  return (
    <div role="status" aria-live="polite" data-testid="new-version-banner"
      className="fixed bottom-20 left-1/2 z-[45] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-full border border-gray-200 bg-white px-4 py-2 text-xs text-gray-700 shadow-lg md:bottom-4">
      <span>A new version of {BRAND_NAME} is available</span>
      <button type="button" onClick={() => window.location.reload()}
        className="rounded-full bg-[#0E7490] px-3 py-1 text-xs font-semibold text-white hover:bg-[#0c637b]">Reload</button>
    </div>
  );
}

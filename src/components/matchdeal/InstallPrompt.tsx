'use client';
// Prompt 92 — PWA install prompt for MatchDeal, approved 02/08 to build as
// proposed. Android gets the native beforeinstallprompt flow (one tap, no
// instructions needed); iOS has no equivalent API, so it's a step-by-step
// "Share -> Add to Home Screen" screen instead. Bounded recurrence (see
// lib/pwa-install.ts) so this doesn't nag on every visit. Never shown once
// already installed (standalone display mode).
import { useEffect, useState } from 'react';
import {
  isIosDevice, isStandaloneDisplayMode, readInstallPromptState, recordInstallPromptDismissed,
  recordInstallPromptSessionSeen, shouldShowInstallPrompt,
} from '@/lib/pwa-install';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallPrompt() {
  const [visible, setVisible] = useState(false);
  const [platform, setPlatform] = useState<'android' | 'ios' | null>(null);
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Chrome/Android fires this unprompted, well before we'd otherwise
    // decide to show anything — capture it early and hold onto it so
    // installAndroid() below can call .prompt() on our own timing instead
    // of the browser's default mini-infobar.
    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setDeferredEvent(e as BeforeInstallPromptEvent);
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  }, []);

  useEffect(() => {
    if (isStandaloneDisplayMode()) return;
    recordInstallPromptSessionSeen();
    if (!shouldShowInstallPrompt(readInstallPromptState(), new Date())) return;
    setPlatform(isIosDevice() ? 'ios' : 'android');
    setVisible(true);
  }, []);

  function dismiss() {
    recordInstallPromptDismissed(new Date());
    setVisible(false);
  }

  async function installAndroid() {
    if (!deferredEvent) { dismiss(); return; }
    await deferredEvent.prompt();
    await deferredEvent.userChoice;
    setDeferredEvent(null);
    dismiss();
  }

  if (!visible || !platform) return null;

  return (
    <div
      role="dialog" aria-label="Install MatchDeal"
      className="absolute inset-0 z-30 flex flex-col items-center justify-end bg-[#0B1220]/85 backdrop-blur-sm"
      onClick={dismiss}
    >
      <div
        className="w-full rounded-t-3xl border-t border-white/10 bg-[#111a2e] p-6 text-center"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 24px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-3xl">📲</div>
        <h2 className="mt-2 text-[17px] font-bold text-white">Add MatchDeal to your Home Screen</h2>

        {platform === 'android' ? (
          <>
            <p className="mt-2 text-[13.5px] leading-relaxed text-white/65">
              Install MatchDeal for the full-screen experience — swipe, match, and pair like a real app.
            </p>
            <button
              type="button" onClick={() => void installAndroid()}
              className="mt-5 w-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-500 py-3 text-[14px] font-bold text-white"
            >
              Install
            </button>
          </>
        ) : (
          <div className="mt-3 space-y-2 text-left text-[13.5px] leading-relaxed text-white/75">
            <p>1. Tap the <span className="font-semibold text-white">Share</span> icon <span aria-hidden="true">⬆️</span> in Safari&apos;s toolbar.</p>
            <p>2. Scroll down and tap <span className="font-semibold text-white">Add to Home Screen</span>.</p>
            <p>3. Tap <span className="font-semibold text-white">Add</span> — MatchDeal opens full-screen next time.</p>
          </div>
        )}

        <button type="button" onClick={dismiss} className="mt-4 w-full rounded-full bg-white/10 py-2.5 text-[13px] font-medium text-white/70">
          Not now
        </button>
      </div>
    </div>
  );
}

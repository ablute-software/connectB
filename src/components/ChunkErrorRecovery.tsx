'use client';
// Prompt 686 §B — mounted once at the app root (layout.tsx), wrapping every
// page. Two independent catch points for the same failure, because a
// failed chunk load can surface either way depending on WHAT was loading it:
//   - window 'error'/'unhandledrejection' listeners: catch it early, often
//     before it ever reaches a React render (this is what actually fired
//     live — a router-triggered chunk fetch rejecting).
//   - the class component's getDerivedStateFromError/componentDidCatch:
//     defense in depth, for the case where the failure DOES reach React's
//     render cycle first (the reported "React error #423" step) with no
//     boundary anywhere above it to stop the whole tree unmounting blank.
// Both funnel through the same guarded decision (chunk-error-recovery.ts):
// first failure this tab has seen → one automatic reload, no visible
// message; a second failure (the reload didn't help) → a real "Reload"
// button instead of silence.
import { Component, useEffect, type ReactNode } from 'react';
import { isChunkLoadError, shouldAutoReloadForChunkError } from '@/lib/chunk-error-recovery';

function handlePossibleChunkError(message: string | null | undefined): boolean {
  if (!isChunkLoadError(message)) return false;
  if (typeof window === 'undefined') return false;
  if (shouldAutoReloadForChunkError(window.sessionStorage)) {
    window.location.reload();
    return true;
  }
  return false;
}

function GlobalChunkErrorListener() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => { handlePossibleChunkError(e.message); };
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason as { message?: string } | string | undefined;
      const message = typeof reason === 'string' ? reason : reason?.message;
      handlePossibleChunkError(message);
    };
    // capture: true — a failed <script> chunk's error event does not
    // bubble, so a bubble-phase listener would never see it.
    window.addEventListener('error', onError, true);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError, true);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
  return null;
}

// 'ok': render children normally. 'reloading': a reload was just triggered
// (either by this boundary or by the window-level listener above racing
// it — handlePossibleChunkError's own guard makes that safe either way) —
// render nothing rather than re-attempt the broken subtree while the
// browser is mid-navigation, which could throw again immediately. 'error':
// the reload guard says this tab already tried once — show a real button
// instead of silence.
type BoundaryPhase = 'ok' | 'reloading' | 'error';

class ChunkErrorBoundaryClass extends Component<{ children: ReactNode }, { phase: BoundaryPhase }> {
  state: { phase: BoundaryPhase } = { phase: 'ok' };

  static getDerivedStateFromError(): { phase: BoundaryPhase } {
    // Stop rendering the broken subtree immediately; componentDidCatch
    // (which may setState again right after) decides which fallback fits.
    return { phase: 'error' };
  }

  componentDidCatch(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (isChunkLoadError(message) && handlePossibleChunkError(message)) {
      this.setState({ phase: 'reloading' });
      return;
    }
    // A non-chunk error is a real bug in the page, not this component's
    // job to diagnose — it still gets the safe fallback (better than a
    // blank page) but logged as what it actually was, so it isn't
    // mistaken for the chunk-load class this boundary exists to handle.
    if (!isChunkLoadError(message)) console.error('ChunkErrorBoundary caught a non-chunk error:', error);
  }

  render() {
    if (this.state.phase === 'reloading') return <div className="min-h-screen bg-[#F7F9FA]" />;
    if (this.state.phase === 'error') {
      return (
        <div className="flex min-h-screen items-center justify-center bg-[#F7F9FA] p-6 text-center">
          <div>
            <p className="mb-3 text-sm text-gray-600">Something went wrong loading this page.</p>
            <button onClick={() => window.location.reload()}
              className="rounded-lg bg-[#0E7490] px-4 py-2 text-sm font-medium text-white hover:bg-[#0c637b]">
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function ChunkErrorRecovery({ children }: { children: ReactNode }) {
  return (
    <ChunkErrorBoundaryClass>
      <GlobalChunkErrorListener />
      {children}
    </ChunkErrorBoundaryClass>
  );
}

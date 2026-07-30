'use client';
// MatchDeal QR pairing (spec Section 5.3) — the page a phone lands on
// when it scans the web modal's QR and doesn't have (or hasn't opened)
// the MatchDeal app. The spec asks this page to detect the phone's OS
// and redirect to the matching App Store / Play Store listing. There is
// no listing to redirect to — MatchDeal is in private beta and isn't
// published on either store yet (confirmed in the prior pairing modal's
// own comment before this rebuild). Redirecting to a URL that doesn't
// exist would be worse than not redirecting at all, so this shows an
// honest holding state instead. Update this page (and the App Store/
// Play Store URLs below) the moment the app is actually published.
import { useEffect, useState } from 'react';

export default function MatchDealPairPage() {
  const [token, setToken] = useState<string | null>(null);
  const [platform, setPlatform] = useState<'ios' | 'android' | 'other'>('other');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setToken(params.get('token'));
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/i.test(ua)) setPlatform('ios');
    else if (/Android/i.test(ua)) setPlatform('android');
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F7F9FA] p-6">
      <div className="w-full max-w-sm rounded-2xl border border-gray-100 bg-white p-6 text-center shadow-sm">
        <div className="text-2xl">🤝</div>
        <h1 className="mt-2 text-lg font-bold text-gray-900">MatchDeal is in private beta</h1>
        <p className="mt-2 text-sm text-gray-600">
          It isn&apos;t on the {platform === 'ios' ? 'App Store' : platform === 'android' ? 'Play Store' : 'App Store or Google Play'} yet.
          If your team already has early access to the app, open it and look for a way to enter or scan a pairing code there.
        </p>
        {token && (
          <div className="mt-4 rounded-lg bg-gray-50 p-3">
            <p className="text-[11px] uppercase tracking-wide text-gray-400">Reference code</p>
            <p className="mt-1 break-all font-mono text-xs text-gray-700">{token}</p>
            <p className="mt-1.5 text-[11px] text-gray-400">Valid for a few minutes — generate a new one from the web if it expires.</p>
          </div>
        )}
        <p className="mt-4 text-xs text-gray-400">
          Want early access? <a href="mailto:hello@sherlockdeal.com" className="text-[#0E7490] hover:underline">Get in touch</a>.
        </p>
      </div>
    </div>
  );
}

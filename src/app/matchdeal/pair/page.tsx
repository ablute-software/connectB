'use client';
// MatchDeal QR pairing v2 — /matchdeal/pair is superseded by /pair
// (the URL app.sherlockdeal.com/pair now points to; see
// prompt "Alteracoes_MatchDeal_QRCode.md" v2). Kept as a redirect, not
// deleted outright, purely so any already-generated QR code from before
// this change (none in real use — MatchDeal has never been paired for
// real yet, confirmed earlier this session) still lands somewhere
// functional instead of 404ing.
import { useEffect } from 'react';

export default function LegacyMatchDealPairRedirect() {
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');
    window.location.replace(token ? `/pair?token=${encodeURIComponent(token)}` : '/pair');
  }, []);
  return null;
}

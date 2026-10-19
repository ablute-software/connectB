// Header segmented control on the public landing pages: Startup vs Investor.
// Each side is its own route (/for-startups and /investors) rather than client state, so
// the choice is a real URL — shareable, and each side keeps its own metadata.
//
// Prompt 920 §F.1 (Nuno's "sim", 16/10/2026) — "For Startups" used to point at "/", which on the home was a link to the page you were
// already on. It now opens /for-startups, the answer page for founders (same call to action, links back to the home). `active` may be
// null on the pages that belong to neither side (/about, /faq).
import Link from 'next/link';
import s from '@/app/landing.module.css';

export function AudienceToggle({ active }: { active: 'startup' | 'investor' | null }) {
  return (
    <div className={s.audience} role="tablist" aria-label="Startup or investor">
      <Link href="/for-startups" role="tab" aria-selected={active === 'startup'}
        className={`${s.audienceOpt} ${active === 'startup' ? s.audienceOptOn : ''}`}>
        For Startups
      </Link>
      <Link href="/investors" role="tab" aria-selected={active === 'investor'}
        className={`${s.audienceOpt} ${active === 'investor' ? s.audienceOptOn : ''}`}>
        For Investors
      </Link>
    </div>
  );
}

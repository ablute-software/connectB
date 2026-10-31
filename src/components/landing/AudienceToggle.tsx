// Header segmented control on the public pages: Startup vs Investor.
// Each side is its own route (/ and /investors) rather than client state, so
// the choice is a real URL — shareable, and each side keeps its own metadata.
//
// It switches between the TWO landing pages and nothing else (Nuno, 31/10/2026). Prompt 920 §F.1 (16/10/2026) had pointed "For Startups" at /for-startups, the editorial answer page
// ("How to find the right investors for your startup"), to give that page internal links; the result was that a visitor who went to Investors and pressed Startups again landed on a long
// article instead of the startups landing. The article keeps its URL (/for-startups: search results and links from elsewhere point at it) and stays linked from the footers
// ("How to find investors"), but never from here. `active` may be null on the pages that belong to neither side (/about, /faq); the article itself is on the startup side.
import Link from 'next/link';
import s from '@/app/landing.module.css';

export function AudienceToggle({ active }: { active: 'startup' | 'investor' | null }) {
  return (
    <div className={s.audience} role="tablist" aria-label="Startup or investor">
      <Link href="/" role="tab" aria-selected={active === 'startup'}
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

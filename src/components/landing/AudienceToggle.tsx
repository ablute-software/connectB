// Header segmented control on the public landing pages: Startup vs Investor.
// Each side is its own route (/ and /investors) rather than client state, so
// the choice is a real URL — shareable, and each side keeps its own metadata.
import Link from 'next/link';
import s from '@/app/landing.module.css';

export function AudienceToggle({ active }: { active: 'startup' | 'investor' }) {
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

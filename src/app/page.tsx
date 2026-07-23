// Public landing page — a faithful implementation of the approved design in
// landing-reference.html. Server component; the only client bits are the
// scroll/reveal effects and the pricing toggle.
//
// Routing: this is `/`. An authenticated visitor never sees it — they are
// redirected straight to the app (/pipeline). Auth logic itself is untouched:
// this only reads the session, it never sets or clears one.
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Fraunces, Inter } from 'next/font/google';
import { serverClient, authEnabled } from '@/lib/supabase-server';
import { BRAND_NAME, APP_URL } from '@/lib/brand';
import { LogoLockup } from '@/components/Logo';
import { LandingEffects } from '@/components/landing/LandingEffects';
import { PricingSection } from '@/components/landing/PricingSection';
import s from './landing.module.css';

const fraunces = Fraunces({
  subsets: ['latin'], weight: ['400', '600', '700'], style: ['normal', 'italic'],
  variable: '--font-fraunces', display: 'swap',
});
const inter = Inter({
  subsets: ['latin'], weight: ['400', '500', '600', '700'],
  variable: '--font-inter', display: 'swap',
});

const TITLE = `${BRAND_NAME} — Investor relations, investigated`;
const DESCRIPTION = `${BRAND_NAME} is the investor relations workspace for founders: track every investor, keep every fact straight, and never let a warm lead go cold.`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  metadataBase: new URL(APP_URL),
  alternates: { canonical: '/' },
  openGraph: {
    title: TITLE, description: DESCRIPTION, url: APP_URL,
    siteName: BRAND_NAME, type: 'website', locale: 'en',
  },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

/* ---------- small inline icons, reused across sections ---------- */
function Arrow() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function TickAmber() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8 12.5l2.6 2.6L16.5 9" stroke="#d9a441" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function CheckGreen({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="#e2f4e8" />
      <path d="M8 12.5l2.6 2.6L16.5 9" stroke="#20714a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ClockAmber({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="#f9efd9" />
      <path d="M12 7v5l3 3" stroke="#8a6414" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function Lens({ className, size, withCheck }: { className?: string; size: number; withCheck?: boolean }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <circle cx="20" cy="20" r="13" stroke="#fff" strokeWidth="2" />
      <line x1="30" y1="30" x2="44" y2="44" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      {withCheck && <path d="M14 20.5l4 4 8-8" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />}
    </svg>
  );
}

const FEATURES = [
  {
    title: 'Matched investors, delivered',
    body: `Don't start from a blank page. ${BRAND_NAME} supplies investors that fit your sector, stage and round size — then tracks every conversation, note and next step in one board.`,
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3" y="4" width="5" height="16" rx="1.5" stroke="#2a7f8e" strokeWidth="1.8" />
        <rect x="10" y="4" width="5" height="11" rx="1.5" stroke="#2a7f8e" strokeWidth="1.8" />
        <rect x="17" y="4" width="4" height="7" rx="1.5" stroke="#2a7f8e" strokeWidth="1.8" />
      </svg>
    ),
  },
  {
    title: 'Outreach discipline, enforced',
    body: "Daily and weekly targets keep momentum honest. Today's agenda tells you exactly who to contact, chase or thank — before leads cool off.",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="#d9a441" strokeWidth="1.8" />
        <path d="M12 7v5l3.5 2" stroke="#d9a441" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    title: 'NDA-protected data room',
    body: 'Share your deck in one click, or gate sensitive documents behind an NDA. Access is enforced per document, per investor — server-side.',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="4" y="10" width="16" height="10" rx="2" stroke="#2a7f8e" strokeWidth="1.8" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="#2a7f8e" strokeWidth="1.8" />
        <circle cx="12" cy="15" r="1.6" fill="#2a7f8e" />
      </svg>
    ),
  },
  {
    title: 'One version of the truth',
    body: 'Confirmed company facts power every message. When a number changes, everything stays consistent — no more contradicting yourself mid-round.',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 3l2.2 5.4L20 9l-4.4 3.8L17 19l-5-3.2L7 19l1.4-6.2L4 9l5.8-.6L12 3z" stroke="#2a7f8e" strokeWidth="1.7" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    title: 'AI drafts — you decide',
    body: 'Replies, follow-ups and investor updates drafted from your confirmed facts. Nothing is ever sent without your review and your click.',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 6h16M4 12h10M4 18h13" stroke="#d9a441" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="19" cy="17" r="3" stroke="#d9a441" strokeWidth="1.7" />
      </svg>
    ),
  },
  {
    title: 'Reawaken cold investors',
    body: `Passed six months ago because you were too early? When your traction changes, ${BRAND_NAME} proposes exactly who deserves a second look.`,
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 14c2-6 6-9 8-9s6 3 8 9" stroke="#2a7f8e" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M12 21v-8m0 0-3 3m3-3 3 3" stroke="#2a7f8e" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];

const STEPS = [
  { n: '1', tag: 'Open the case', h: 'Get your suspect list', p: `Tell ${BRAND_NAME} your sector, stage and round — it delivers investors matched to your profile, scored for fit. Add your own contacts on top, confirm your company facts, and load your data room.` },
  { n: '2', tag: 'Follow the clues', h: 'Run the investigation', p: 'Work your daily agenda, send fact-checked messages, share documents safely. Every reply and every meeting lands back in the file.' },
  { n: '3', tag: 'Close the case', h: 'Close the round', p: "Momentum stays visible, dormant investors resurface at the right moment, and diligence runs from a data room that's already in order." },
];

export default async function LandingPage() {
  // Logged-in visitors go straight to the app — the landing is for the public.
  if (authEnabled) {
    const sb = await serverClient();
    const { data: { user } } = await sb.auth.getUser();
    if (user) redirect('/pipeline');
  }

  return (
    <div className={`${fraunces.variable} ${inter.variable} ${s.landing}`}>
      <LandingEffects />

      {/* ============ NAV ============ */}
      <nav className={s.nav} data-nav data-scrolled="false">
        <div className={s.wrap}>
          <a className={s.logo} href="#top">
            <LogoLockup size={32} accentClassName={s.deal} />
          </a>
          <div className={s.navLinks}>
            <a className={s.link} href="#features">Features</a>
            <a className={s.link} href="#how">How it works</a>
            <a className={s.link} href="#pricing">Pricing</a>
            <Link className={`${s.btn} ${s.btnGhost} ${s.btnSm}`} href="/login">Sign in</Link>
            <Link className={`${s.btn} ${s.btnPrimary} ${s.btnSm}`} href="/signup">Create account</Link>
          </div>
        </div>
      </nav>

      {/* ============ HERO ============ */}
      <header className={s.hero} id="top">
        <Lens className={`${s.lens} ${s.l1}`} size={260} />
        <div className={s.wrap}>
          <div>
            <span className={s.badge}><span className={s.dot} />The investor relations workspace for founders</span>
            <h1>Crack the case on your <em>fundraise.</em></h1>
            <p className={s.lead}>
              Every investor, every conversation, every confirmed fact — in one case file. {BRAND_NAME} keeps
              your raise organised, consistent and moving, so no warm lead ever goes cold.
            </p>
            <div className={s.heroCtas}>
              <Link className={`${s.btn} ${s.btnPrimary}`} href="/signup">Start free <Arrow /></Link>
              <Link className={`${s.btn} ${s.btnGhost}`} href="/login">Sign in</Link>
            </div>
            <p className={s.heroNote}><b>Free to start.</b> No credit card required.</p>
          </div>

          <div className={s.mock}>
            <div className={s.appWindow}>
              <div className={s.bar}>
                <i /><i /><i />
                <span>SHERLOCK DEAL · PIPELINE</span>
              </div>
              <div className={s.cols}>
                <div className={s.col}>
                  <h4>Contacted <b>8</b></h4>
                  <div className={s.kcard}><div className={s.nm}>Northbridge Capital</div><span className={`${s.tg} ${s.tealTag}`}>Intro sent</span></div>
                  <div className={s.kcard}><div className={s.nm}>Atlas Ventures</div><span className={`${s.tg} ${s.due}`}>Follow-up due</span></div>
                  <div className={s.kcard}><div className={s.nm}>Beacon Angels</div><span className={`${s.tg} ${s.tealTag}`}>Deck viewed</span></div>
                </div>
                <div className={s.col}>
                  <h4>In talks <b>5</b></h4>
                  <div className={s.kcard}><div className={s.nm}>Harbour Partners</div><span className={`${s.tg} ${s.warm}`}>Warm · call Fri</span></div>
                  <div className={s.kcard}><div className={s.nm}>Vega Family Office</div><span className={`${s.tg} ${s.ok}`}>NDA signed</span></div>
                </div>
                <div className={s.col}>
                  <h4>Diligence <b>2</b></h4>
                  <div className={s.kcard}><div className={s.nm}>Meridian Growth</div><span className={`${s.tg} ${s.ok}`}>Data room open</span></div>
                  <div className={s.kcard}><div className={s.nm}>Quartz Capital</div><span className={`${s.tg} ${s.warm}`}>Partner meeting</span></div>
                </div>
              </div>
            </div>
            <div className={`${s.chip} ${s.c1}`}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="10" fill="#e2f4e8" />
                <path d="M8 12.5l2.6 2.6L16.5 9" stroke="#20714a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>Fact confirmed<span className={s.sub}>used in 12 messages</span></span>
            </div>
            <div className={`${s.chip} ${s.c2}`}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="10" fill="#f9efd9" />
                <path d="M12 7v5l3 3" stroke="#8a6414" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <span>3 investors reawakened<span className={s.sub}>new milestone detected</span></span>
            </div>
          </div>
        </div>

        <div className={s.strip}>
          <div className={s.wrap}>
            <span><TickAmber />Outreach discipline, enforced</span>
            <span><TickAmber />One version of the truth</span>
            <span><TickAmber />NDA-protected data room</span>
            <span><TickAmber />AI drafts — you decide</span>
          </div>
        </div>
      </header>

      {/* ============ FEATURES ============ */}
      <section className={s.sec} id="features">
        <div className={s.wrap}>
          <div className={`${s.secHead} ${s.rv}`} data-reveal>
            <span className={s.eyebrow}>The case file</span>
            <h2>Everything a raise needs, nothing it doesn&apos;t</h2>
            <p>Built for founders running a round — not adapted from a sales CRM.</p>
          </div>
          <div className={s.grid3}>
            {FEATURES.map((f, i) => (
              <div key={f.title} className={`${s.fcard} ${s.rv} ${i % 3 === 1 ? s.d1 : i % 3 === 2 ? s.d2 : ''}`} data-reveal>
                <div className={s.ic}>{f.icon}</div>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ HOW ============ */}
      <section className={`${s.sec} ${s.how}`} id="how">
        <div className={s.wrap}>
          <div className={`${s.secHead} ${s.rv}`} data-reveal>
            <span className={s.eyebrow}>The method</span>
            <h2>Three steps to a round under control</h2>
          </div>
          <div className={s.steps}>
            {STEPS.map((st, i) => (
              <div key={st.n} className={`${s.step} ${s.rv} ${i === 1 ? s.d1 : i === 2 ? s.d2 : ''}`} data-reveal>
                <span className={s.num}>{st.n}</span>
                <span className={s.tagline}>{st.tag}</span>
                <h3>{st.h}</h3>
                <p>{st.p}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ SPLITS ============ */}
      <section className={s.sec}>
        <div className={s.wrap}>
          <div className={s.split}>
            <div className={s.rv} data-reveal>
              <span className={s.eyebrow}>Company facts</span>
              <h2>Your numbers, confirmed once. Consistent everywhere.</h2>
              <p>
                Investors compare notes. {BRAND_NAME} makes sure the story they compare is the same one —
                every metric you use is a confirmed fact, tracked and versioned.
              </p>
              <ul>
                <li><CheckGreen />Facts are confirmed by you before they&apos;re ever used</li>
                <li><CheckGreen />Outdated numbers are superseded, never silently reused</li>
                <li><CheckGreen />Inconsistencies are flagged before an investor spots them</li>
              </ul>
            </div>
            <div className={`${s.panel} ${s.rv} ${s.d1}`} data-reveal>
              <div className={s.fact}><div className={s.fL}>Monthly recurring revenue<small>updated 3 days ago</small></div><span className={`${s.pill} ${s.pillOk}`}>Confirmed</span></div>
              <div className={s.fact}><div className={s.fL}>Team size<small>updated today</small></div><span className={`${s.pill} ${s.pillOk}`}>Confirmed</span></div>
              <div className={s.fact}><div className={s.fL}>Pilot customers<small>new value detected</small></div><span className={`${s.pill} ${s.pillPending}`}>Confirm?</span></div>
              <div className={s.fact}><div className={s.fL}>Round size &amp; instrument<small>locked for this raise</small></div><span className={`${s.pill} ${s.pillOk}`}>Confirmed</span></div>
            </div>
          </div>

          <div className={s.split}>
            <div className={`${s.panel} ${s.rv}`} data-reveal>
              <div className={s.meter} data-meter>
                <div className={s.row}><span>Today&apos;s outreach</span><span>4 / 5</span></div>
                <div className={s.track}><div className={s.fill} data-fill data-w="80%" /></div>
                <div className={s.row}><span>This week</span><span>14 / 20</span></div>
                <div className={s.track}><div className={s.fill} data-fill data-w="70%" /></div>
                <div className={s.row}><span>Follow-ups on time</span><span>96%</span></div>
                <div className={s.track}><div className={`${s.fill} ${s.fillGold}`} data-fill data-w="96%" /></div>
              </div>
            </div>
            <div className={`${s.rv} ${s.d1}`} data-reveal>
              <span className={s.eyebrow}>Momentum</span>
              <h2>Fundraising is a discipline. We keep score.</h2>
              <p>
                Rounds die from silence, not rejection. {BRAND_NAME} turns outreach into a daily practice —
                visible targets, a clear agenda, and follow-ups that never slip.
              </p>
              <ul>
                <li><ClockAmber />Daily and weekly targets you set, the app enforces</li>
                <li><ClockAmber />A &ldquo;Today&rdquo; view that tells you exactly what moves the round</li>
                <li><ClockAmber />Send from your own mailbox — investors see you, not a tool</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ============ PRICING ============ */}
      <PricingSection />

      {/* ============ CTA ============ */}
      <section className={s.sec}>
        <div className={s.wrap}>
          <div className={`${s.band} ${s.rv}`} data-reveal>
            <Lens className={s.lensBand} size={300} withCheck />
            <h2>The game is afoot.</h2>
            <p>Open your case file today — your pipeline, your facts and your data room, finally in one place.</p>
            <Link className={`${s.btn} ${s.btnPrimary}`} href="/signup">Create your account <Arrow /></Link>
          </div>
        </div>
      </section>

      {/* ============ FOOTER ============ */}
      <footer className={s.footerEl}>
        <div className={s.wrap}>
          <a className={s.logo} href="#top">
            <LogoLockup size={26} accentClassName={s.deal} />
          </a>
          <div className={s.fl}>
            <a href="#features">Features</a>
            <a href="#pricing">Pricing</a>
            <Link href="/login">Sign in</Link>
            <Link href="/signup">Create account</Link>
          </div>
          <p className={s.cp}>© {new Date().getFullYear()} {BRAND_NAME} · Investor relations, investigated.</p>
        </div>
      </footer>
    </div>
  );
}

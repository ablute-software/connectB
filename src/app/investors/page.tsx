// Public landing page for the Investor side of the Startup/Investor toggle.
// Shares the visual system with the Startup landing (src/app/page.tsx) via
// the same CSS module and effects, but is its own route so each side keeps
// its own metadata and is a shareable URL rather than client-side state.
//
// Design record: see landing-investors-reference.html (sibling to the
// startup landing's landing-reference.html) for the static HTML mock this
// page is a faithful port of.
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Fraunces, Inter } from 'next/font/google';
import { serverClient, authEnabled, resolveRole } from '@/lib/supabase-server';
import { BRAND_NAME, APP_URL } from '@/lib/brand';
import { LogoLockup } from '@/components/Logo';
import { LandingEffects } from '@/components/landing/LandingEffects';
import { AudienceToggle } from '@/components/landing/AudienceToggle';
import { InvestorPricingSection } from '@/components/landing/InvestorPricingSection';
import s from '../landing.module.css';

const fraunces = Fraunces({
  subsets: ['latin'], weight: ['400', '600', '700'], style: ['normal', 'italic'],
  variable: '--font-fraunces', display: 'swap',
});
const inter = Inter({
  subsets: ['latin'], weight: ['400', '500', '600', '700'],
  variable: '--font-inter', display: 'swap',
});

const TITLE = `${BRAND_NAME} for Investors — qualified deal flow, verified access`;
const DESCRIPTION = `${BRAND_NAME} continuously analyses startups against your investment mandate and delivers only the opportunities that deserve your team's attention — qualified, explained, and ready for a decision.`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  metadataBase: new URL(APP_URL),
  alternates: { canonical: '/investors' },
  openGraph: {
    title: TITLE, description: DESCRIPTION, url: `${APP_URL}/investors`,
    siteName: BRAND_NAME, type: 'website', locale: 'en',
  },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

/* ---------- CTA target ----------
 * The investor signup flow already exists at /signup?as=investor (it points
 * a claimed/granted email at sign-in — see src/app/signup/page.tsx). That is
 * the "signup flow de investidor" the spec calls for, so every CTA below
 * uses it rather than inventing a separate ?intent=investor convention. */
const SIGNUP_HREF = '/signup?as=investor';

function Arrow() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function CheckGreen() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="#e2f4e8" />
      <path d="M8 12.5l2.6 2.6L16.5 9" stroke="#20714a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ClockAmber() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="#f9efd9" />
      <path d="M12 7v5l3 3" stroke="#8a6414" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

const DEAL_ROWS = [
  { co: 'BioSense Labs', match: 'Perfect 94%', why: 'Round opening', next: 'Propose meeting' },
  { co: 'Northline Robotics', match: 'Strong 81%', why: 'New lead investor', next: 'Review Scout Brief' },
  { co: 'Vantage Grid', match: 'Good 68%', why: 'Traction milestone', next: 'Add to watchlist' },
  { co: 'Cobalt Health', match: 'Perfect 91%', why: 'Thesis match', next: 'Propose meeting' },
];

const STEPS = [
  { n: '1', tag: 'Claim & verify', h: 'Claim & verify', p: 'Find your organisation, verify your work email and your role. Verification is proportional: light to collaborate, strong to administer.' },
  { n: '2', tag: 'Build your mandate', h: 'Build your mandate', p: "Turn your thesis into an operational mandate: hard criteria, weighted preferences, exclusions, cheque range. Usable in your first session." },
  { n: '3', tag: 'Qualify and decide', h: 'Qualify and decide', p: "Forward your own deal flow to your mandate's inbox, get Scout Briefs with fit, evidence and risks, and run your pipeline end to end. As the network grows, Sherlock also brings you companies you did not know." },
];

const FEATURES: { title: string; body: string; soon?: boolean }[] = [
  { title: 'Mandate Builder', body: 'Versioned, shareable investment mandates.' },
  { title: 'Qualification Inbox', body: 'Forward a deck, get a qualified opportunity with fit, risks and questions. Private by default.' },
  { title: 'Scout Brief', body: 'A one-page brief per opportunity: fit criterion by criterion, evidence with sources, recommended next action.' },
  { title: 'Pipeline OS', body: 'Owners, deadlines, decision reasons and full audit trail. Replace the spreadsheet.' },
  { title: 'Evidence you can trust', body: 'Every claim labelled: fact, company claim, estimate, unknown or stale. Nothing invented, ever.' },
  { title: 'Consent-based introductions', body: 'Startups see who is asking; both sides agree before anything is shared.', soon: true },
];

const FAQS = [
  { q: 'Is my deal flow private?', a: 'Yes. Anything you forward to your Qualification Inbox is private to your organisation by default. It is never used to grow the marketplace or train shared models without your explicit consent.' },
  { q: 'Who can see startup data?', a: 'Only verified investor organisations with a complete profile and an active mandate — and startups always control what is shared and see who viewed their profile.' },
  { q: 'How do you verify investors?', a: 'Work email and domain for collaboration; stronger proof — including official registry checks — for organisation control and sensitive actions.' },
  { q: 'What does "qualified opportunity" mean?', a: 'A company that passed your mandate’s hard criteria and received a full analysis: fit, evidence, risks and a recommended action. Raw names on a list do not count against your capacity.' },
];

export default async function InvestorLandingPage() {
  if (authEnabled) {
    const sb = await serverClient();
    const { data: { user } } = await sb.auth.getUser();
    if (user) {
      const role = await resolveRole(user.id, user.email, sb, user.email_confirmed_at);
      redirect(role === 'investor' ? '/portal' : '/pipeline');
    }
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
            <a className={s.link} href="#how">How it works</a>
            <a className={s.link} href="#features">Features</a>
            <a className={s.link} href="#pricing">Pricing</a>
            <AudienceToggle active="investor" />
            <Link className={`${s.btn} ${s.btnGhost} ${s.btnSm}`} href="/login?as=investor">Sign in</Link>
            <Link className={`${s.btn} ${s.btnPrimary} ${s.btnSm}`} href={SIGNUP_HREF}>Claim your profile</Link>
          </div>
        </div>
      </nav>

      {/* ============ HERO ============ */}
      <header className={s.hero} id="top">
        <div className={s.wrap}>
          <div>
            <span className={s.badge}><span className={s.dot} />{BRAND_NAME.toUpperCase()} FOR INVESTORS</span>
            <h1>Fewer, better, <em>investment-ready</em> opportunities.</h1>
            <p className={s.lead}>
              {BRAND_NAME} continuously analyses startups against your investment mandate and delivers
              only the opportunities that deserve your team&apos;s attention — qualified, explained, and
              ready for a decision.
            </p>
            <div className={s.heroCtas}>
              <Link className={`${s.btn} ${s.btnPrimary}`} href={SIGNUP_HREF}>Claim your investor profile <Arrow /></Link>
              <Link className={`${s.btn} ${s.btnGhost}`} href="#how">See how it works</Link>
            </div>
          </div>

          <div className={s.mock}>
            <div className={s.appWindow}>
              <div className={s.bar}>
                <i /><i /><i />
                <span>{BRAND_NAME.toUpperCase()} · DEAL FLOW REVIEW</span>
              </div>
              <div className={s.dealList}>
                <div className={s.dealHead}>
                  <span>Company</span><span>Match</span><span>Why now</span><span>Next action</span>
                </div>
                {DEAL_ROWS.map((r) => (
                  <div key={r.co} className={s.dealRow}>
                    <span className={s.dealCo}>{r.co}</span>
                    <span className={s.dealMatch}>{r.match}</span>
                    <span className={s.dealWhy}>{r.why}</span>
                    <span className={s.dealNext}>{r.next}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ============ CLAIM ============ */}
      <section className={`${s.sec} ${s.claimSec}`}>
        <div className={s.wrap}>
          <div className={s.claimWrap}>
            <div className={s.rv} data-reveal>
              <span className={s.eyebrow}>Already in our database</span>
              <h2>Your firm may already be on {BRAND_NAME}.</h2>
              <p>
                500+ investor profiles — VC funds, family offices and business angels across 25+ European
                countries — compiled and verified from public sources. And growing every week. Search for
                your organisation, claim your profile, verify your affiliation and take control — no
                duplicate profiles, no starting from zero.
              </p>
              <p className={s.claimTrust}>
                Claiming requires a verified work email and proportional proof of authority. Sensitive
                actions require stronger verification.
              </p>
            </div>
            <div className={`${s.claimCard} ${s.rv} ${s.d1}`} data-reveal>
              <span className={s.claimBadge}>Not yet managed by the organisation</span>
              <div className={s.claimOrg}>Northbridge Capital</div>
              <div className={s.claimMeta}>Seed &amp; Series A · Fintech, Climate · Berlin</div>
              <Link className={s.claimBtn} href={SIGNUP_HREF}>Claim this profile</Link>
            </div>
          </div>
        </div>
      </section>

      {/* ============ HOW ============ */}
      <section className={`${s.sec} ${s.how}`} id="how">
        <div className={s.wrap}>
          <div className={`${s.secHead} ${s.rv}`} data-reveal>
            <span className={s.eyebrow}>The method</span>
            <h2>Three steps to a pipeline you can trust</h2>
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

      {/* ============ FEATURES ============ */}
      <section className={s.sec} id="features">
        <div className={s.wrap}>
          <div className={`${s.secHead} ${s.rv}`} data-reveal>
            <span className={s.eyebrow}>What you get</span>
            <h2>Built for how investment teams actually decide</h2>
            <p>Not a lead marketplace — an analysis layer on top of your own mandate.</p>
          </div>
          <div className={s.grid3}>
            {FEATURES.map((f, i) => (
              <div key={f.title} className={`${s.fcard} ${s.rv} ${i % 3 === 1 ? s.d1 : i % 3 === 2 ? s.d2 : ''}`} data-reveal>
                <div className={s.ic}><CheckGreen /></div>
                <h3>{f.title}{f.soon && <span className={s.soonTag}>Coming soon</span>}</h3>
                <p>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ TRUST SPLIT ============ */}
      <section className={s.sec}>
        <div className={s.wrap}>
          <div className={s.split}>
            <div className={s.rv} data-reveal>
              <span className={s.eyebrow}>Access</span>
              <h2>Verified investors only.</h2>
              <p>
                Every investor organisation on {BRAND_NAME} is claimed and verified. No anonymous
                browsing, no tourists: startup identities are visible only to verified, complete investor
                profiles — and startups always see who is looking.
              </p>
              <ul>
                <li><CheckGreen />No anonymous browsing, ever</li>
                <li><CheckGreen />Startups always see who is looking</li>
                <li><CheckGreen />Complete profile and mandate required to unlock identities</li>
              </ul>
            </div>
            <div className={`${s.panel} ${s.rv} ${s.d1}`} data-reveal>
              <div className={s.fact}><div className={s.fL}>Organisation profile<small>verified</small></div><span className={`${s.pill} ${s.pillOk}`}>Complete</span></div>
              <div className={s.fact}><div className={s.fL}>Investment mandate<small>hard criteria set</small></div><span className={`${s.pill} ${s.pillOk}`}>Active</span></div>
              <div className={s.fact}><div className={s.fL}>Startup identities<small>gated by mandate completeness</small></div><span className={`${s.pill} ${s.pillOk}`}>Unlocked</span></div>
            </div>
          </div>

          <div className={s.split}>
            <div className={`${s.panel} ${s.rv}`} data-reveal>
              <div className={s.meter} data-meter>
                <div className={s.row}><span>Mandate completeness</span><span>100%</span></div>
                <div className={s.track}><div className={s.fill} data-fill data-w="100%" /></div>
                <div className={s.row}><span>Organisation profile</span><span>90%</span></div>
                <div className={s.track}><div className={s.fill} data-fill data-w="90%" /></div>
                <div className={s.row}><span>Perfect Match alerts</span><span>Priority</span></div>
                <div className={s.track}><div className={`${s.fill} ${s.fillGold}`} data-fill data-w="100%" /></div>
              </div>
            </div>
            <div className={`${s.rv} ${s.d1}`} data-reveal>
              <span className={s.eyebrow}>Priority</span>
              <h2>Give a little, see a lot.</h2>
              <p>
                Access grows with your profile. Complete your mandate to unlock matches; complete your
                organisation profile to see who they are. Complete, up-to-date mandates are alerted first
                when a Perfect Match appears.
              </p>
              <ul>
                <li><ClockAmber />Complete your mandate to unlock matches</li>
                <li><ClockAmber />Complete your organisation profile to see identities</li>
                <li><ClockAmber />Complete mandates get alerted first on a Perfect Match</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ============ PRICING ============ */}
      <InvestorPricingSection />

      {/* ============ FAQ ============ */}
      <section className={s.sec}>
        <div className={s.wrap}>
          <div className={`${s.secHead} ${s.rv}`} data-reveal>
            <span className={s.eyebrow}>Questions</span>
            <h2>Frequently asked</h2>
          </div>
          <div className={`${s.faq} ${s.rv}`} data-reveal>
            {FAQS.map((f) => (
              <details key={f.q} className={s.faqItem}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ============ CTA ============ */}
      <section className={s.sec}>
        <div className={s.wrap}>
          <div className={`${s.band} ${s.rv}`} data-reveal>
            <h2>Find the right startups before everyone else.</h2>
            <p>Claim your profile, build your mandate, and put your deal flow to work today.</p>
            <Link className={`${s.btn} ${s.btnPrimary}`} href={SIGNUP_HREF}>Claim your investor profile <Arrow /></Link>
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
            <a href="#how">How it works</a>
            <a href="#pricing">Pricing</a>
            <Link href="/">For Startups</Link>
            <Link href="/investors">For Investors</Link>
            <Link href="/contact?from=investors">Contact</Link>
            <Link href="/login?as=investor">Sign in</Link>
          </div>
          <p className={s.cp}>© {new Date().getFullYear()} {BRAND_NAME} · Investor relations, investigated.</p>
        </div>
      </footer>
    </div>
  );
}

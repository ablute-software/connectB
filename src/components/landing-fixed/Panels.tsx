// Prompt 935 — the card's sixteen panels (eight per mode), all in the server HTML so a crawler, a screen reader and a visitor without JavaScript get every word; the stylesheet shows only the selected one
// (.fx-card .fx-body > section.fx-on). Eleven are the approved copy (landing-fixed-panels.ts), the two pricing panels are drawn from plans.ts (the price list is NOT retyped here: a price changed there changes
// here), the two overviews carry the strip of logos that authorized it (landing-logos.json, the 926 rules), and the Documents panel is the mockup's.
import { INVESTOR_PLANS, MATCHDEAL_WEEKLY, PLANS, PRIVATE_DETECTIVE_PLAN, SEAT_COUNT_LABEL } from '@/lib/plans';
import { PANEL_HTML, type StaticPanelId } from '@/content/site/landing-fixed-panels';
import { MODES, type LandingMode } from '@/content/site/landing-fixed';
import { landingLogosFor, logoStripVisible, LOGO_STRIP_LABEL } from '@/content/site/logo-strip';
import { marqueeHtml } from '@/lib/landing-fixed-logos';

const euro = (n: number) => `€${n.toLocaleString('en-US')}`;

/** One plan card. `rec` marks the recommended one; a plan with `price` text instead of an amount ("Custom") draws it as is. */
function PlanCard(p: { name: string; price: string; unit?: string; diff: string; items: readonly string[]; cta: { label: string; href: string; doc?: string }; rec?: boolean }) {
  return (
    <div className={`fx-plan${p.rec ? ' fx-rec' : ''}`}>
      {p.rec && <span className="fx-tag">Recommended</span>}
      <span className="fx-name">{p.name}</span>
      <span className="fx-price">{p.price}{p.unit && <small> {p.unit}</small>}</span>
      <span className="fx-diff">{p.diff}</span>
      <ul>{p.items.map((i) => <li key={i}>{i}</li>)}</ul>
      <a className={`fx-btn ${p.rec ? 'fx-full' : 'fx-btn-ghost'}`} href={p.cta.href} {...(p.cta.doc ? { 'data-doc': p.cta.doc } : {})}>{p.cta.label}</a>
    </div>
  );
}

/** The founders' price list, from plans.ts: three plans and the custom one. */
export function StartupPricing() {
  const pd = PRIVATE_DETECTIVE_PLAN.founder;
  return (
    <div className="fx-panel">
      <div className="fx-plans">
        {PLANS.map((p) => (
          <PlanCard
            key={p.tier}
            name={p.name}
            price={euro(p.monthlyEur)}
            unit={p.paid ? '/month' : 'free forever'}
            diff={`${MATCHDEAL_WEEKLY[p.tier].deck} new investors a week`}
            items={[SEAT_COUNT_LABEL[p.tier], 'AI credits included', 'Curated pipeline*']}
            cta={{ label: p.paid ? 'Choose this plan' : 'Start free', href: '/signup' }}
            rec={!!p.bestValue}
          />
        ))}
        <PlanCard
          name={pd.name}
          price="Custom"
          diff="Many startups, one view"
          items={['Accelerators, studios, funds', 'One invoice, annual terms', 'Dedicated onboarding']}
          cta={{ label: pd.ctaLabel, href: '/contact', doc: 'contact' }}
        />
      </div>
      <p className="fx-fine">* Reviewed by our team before it reaches your list. Prices exclude VAT.</p>
    </div>
  );
}

/** The investors' price list, from plans.ts: there is no free tier, and nothing here is "recommended" (the product does not rank its investor plans). */
export function InvestorPricing() {
  const pd = PRIVATE_DETECTIVE_PLAN.investor;
  return (
    <div className="fx-panel">
      <div className="fx-plans">
        {INVESTOR_PLANS.map((p) => (
          <PlanCard
            key={p.tier}
            name={p.name}
            price={euro(p.monthlyEur)}
            unit="/month"
            diff={p.tagline}
            items={[`${p.seats} ${p.seats === 1 ? 'seat' : 'seats'}`, `Up to ${p.monthlyCap} matched opportunities / month`]}
            cta={{ label: 'Claim your profile', href: '/claim' }}
          />
        ))}
        <PlanCard
          name={pd.name}
          price="Custom"
          diff={pd.tagline}
          items={['Seats and caps set to your team', 'One invoice, annual terms']}
          cta={{ label: pd.ctaLabel, href: '/contact', doc: 'contact' }}
        />
      </div>
      <p className="fx-fine">Prices exclude VAT.</p>
    </div>
  );
}

/** The strips of logos that open the overviews: only those that authorized it (landing-logos.json), and only when there are enough of them to be a strip and not a list (the 926 rules). */
export function landingMarquees(): Record<LandingMode, string> {
  const s = landingLogosFor('startups');
  const i = landingLogosFor('investors');
  return {
    startups: logoStripVisible(s) ? marqueeHtml(s, 'Trusted by', 's', true) : '',
    investors: logoStripVisible(i) ? marqueeHtml(i, LOGO_STRIP_LABEL.investors, 'i', true) : '',
  };
}

/** The public pages the landing links to (it has no footer): About, the FAQ page and the article. Kept here so the links stay one set. */
export const SITE_LINKS = '<p class="fx-fine fx-sitelinks">More: <a href="/about">About</a> · <a href="/faq">FAQ</a> · <a href="/for-startups">How to find investors</a></p>';

/** Every panel of both modes, in a `<section data-id>` each; `contact` is the form's place, filled in by the client. */
export function Panels({ mode: current }: { mode: LandingMode }) {
  const home = MODES[current].items[MODES[current].home].id;
  const ids = new Set<string>();
  for (const m of ['startups', 'investors'] as const) for (const it of MODES[m].items) ids.add(it.id);
  return (
    <>
      {[...ids].map((id) => {
        const mode: LandingMode = id.startsWith('i-') ? 'investors' : 'startups';
        // `docs` belongs to both modes: one panel, shown by either wheel
        const attr = id === 'docs' ? 'any' : mode === 'startups' ? 's' : 'i';
        // the server already shows the page's own mode and its home place: the first paint is the final one (the client only changes it when the visitor does)
        const shared = { 'data-id': id, 'data-mode': attr, hidden: attr !== 'any' && attr !== (current === 'startups' ? 's' : 'i'), className: id === home ? 'fx-on' : undefined };
        if (id === 's-pricing') return <section key={id} {...shared}><StartupPricing /></section>;
        if (id === 'i-pricing') return <section key={id} {...shared}><InvestorPricing /></section>;
        const html = PANEL_HTML[id as StaticPanelId];
        return <section key={id} {...shared} dangerouslySetInnerHTML={{ __html: html }} />;
      })}
    </>
  );
}

// Prompt 935 (02/11/2026) — the server half of the fixed landing, shared by `/` (startups) and `/investors`: the same page, two routes, so each side keeps its own address, metadata and structured data (the mode
// switch inside the page changes the address with history.replaceState; a shared link still lands on the right side).
//
// What it does on the server: the visitor's session decides the redirect (a signed-in visitor with a place in the product never sees the landing, Prompt 515/923), `signedIn` goes to the client for the buttons,
// the panels of both modes go into the HTML (a crawler and a visitor without JavaScript read every word; the stylesheet shows one), and the structured data says exactly what the page says (the FAQ's questions
// and answers are the panels' own text, PANEL_FAQ).
import ReactDOM from 'react-dom';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { serverClient, authEnabled } from '@/lib/supabase-server';
import { LAST_AREA_COOKIE, parseArea } from '@/lib/areas';
import { resolveAreaDestination } from '@/lib/areas-server';
import { JsonLd } from '@/components/seo/JsonLd';
import { FixedLanding } from '@/components/landing-fixed/FixedLanding';
import { Panels, landingMarquees } from '@/components/landing-fixed/Panels';
import { PANEL_FAQ } from '@/content/site/landing-fixed-panels';
import type { LandingMode } from '@/content/site/landing-fixed';
import { INVESTOR_FIT_SECTION } from '@/content/site/investors';
import { articleNode, breadcrumbNode, faqPageNode, graph, organizationNode, softwareApplicationNode, websiteNode } from '@/lib/site-schema';
import '@/app/landing-fixed.css';

const faqItems = (mode: LandingMode) => PANEL_FAQ[mode === 'startups' ? 's' : 'i'].map(([q, a]) => ({ q, a }));

/**
 * `fontClass` is the className of the page's own Fraunces (`fraunces.variable`): next/font only preloads a font that the PAGE file (or a layout) declares, so each route declares it and hands the class here. Declared inside this
 * module the preload link was missing and the heading's font arrived after the stylesheet, late enough to move Lighthouse's LCP to the swap.
 */
export async function FixedLandingPage({ mode, fontClass }: { mode: LandingMode; fontClass: string }) {
  let signedIn = false;
  if (authEnabled) {
    const sb = await serverClient();
    const { data: { user } } = await sb.auth.getUser();
    if (user) {
      signedIn = true;
      // one rule for where a signed-in visitor goes (src/lib/areas.ts); an account with no area gets this public page (path null)
      const { path: dest } = await resolveAreaDestination(user, sb, { intent: mode === 'investors' ? 'investor' : null, last: parseArea(cookies().get(LAST_AREA_COOKIE)?.value) });
      if (dest) redirect(dest);
    }
  }

  // the photograph is what the first paint waits for: ask for the best format the browser can read before the page's own CSS is parsed
  ReactDOM.preload('/landing/fog.avif', { as: 'image', type: 'image/avif', fetchPriority: 'high' });

  const path = mode === 'startups' ? '/' : '/investors';
  const data = mode === 'startups'
    ? graph(organizationNode(), websiteNode(), softwareApplicationNode(), faqPageNode(faqItems(mode), path))
    : graph(
      organizationNode(), websiteNode(),
      articleNode({ headline: INVESTOR_FIT_SECTION.title, description: INVESTOR_FIT_SECTION.lead, path }),
      faqPageNode(faqItems(mode), path),
      breadcrumbNode([{ name: 'Home', path: '/' }, { name: 'For investors', path }]),
    );

  return (
    <div className={fontClass}>
      <FixedLanding initialMode={mode} signedIn={signedIn} strip={landingMarquees()}>
        <Panels mode={mode} />
      </FixedLanding>
      <JsonLd data={data} />
    </div>
  );
}

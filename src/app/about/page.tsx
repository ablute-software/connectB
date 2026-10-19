// Prompt 920 §B.3 — /about: factual, written to be quoted. One definition sentence, what it does, for whom, who runs it, how it is paid for,
// what it is NOT (the wording follows the Terms, §4.4–§4.5), how founders' information is treated. No marketing adjectives, no number that is
// not a constant in src/content/site/facts.ts. Approved text: docs/site-copy-920.md §4.
import type { Metadata } from 'next';
import Link from 'next/link';
import { APP_URL, BRAND_NAME } from '@/lib/brand';
import { CONTROLLER_LEGAL_NAME } from '@/lib/controller';
import p from '@/components/site/site-page.module.css';
import { PublicSiteLayout } from '@/components/site/PublicSiteLayout';
import { JsonLd } from '@/components/seo/JsonLd';
import { ABOUT_META, OG_DEFAULT_IMAGE } from '@/content/site/pages';
import { COUNTRIES_FLOOR, OPERATOR_LOCALITY } from '@/content/site/facts';
import { abs, aboutPageNode, breadcrumbNode, graph, organizationNode, websiteNode } from '@/lib/site-schema';

const PATH = '/about';

export const metadata: Metadata = {
  title: ABOUT_META.title,
  description: ABOUT_META.description,
  metadataBase: new URL(APP_URL),
  alternates: { canonical: PATH },
  openGraph: { title: ABOUT_META.title, description: ABOUT_META.description, url: abs(PATH), siteName: BRAND_NAME, type: 'website', locale: 'en', images: [OG_DEFAULT_IMAGE] },
  twitter: { card: 'summary_large_image', title: ABOUT_META.title, description: ABOUT_META.description, images: [{ url: OG_DEFAULT_IMAGE.url, alt: OG_DEFAULT_IMAGE.alt }] },
};

export default function AboutPage() {
  return (
    <PublicSiteLayout>
      <div className={p.container}>
        <nav className={p.crumbs} aria-label="Breadcrumb">
          <Link href="/">Home</Link><span aria-hidden="true"> › </span><span aria-current="page">About</span>
        </nav>

        <h1 className={p.title}>About Sherlock Deal</h1>
        <p className={p.answer}>
          Sherlock Deal is a fundraising workspace and matching platform that connects startups with the investors that fit them.
          Founders use it to find, approach and track investors; investors use it to receive startups that match their mandate.
          It was built in Portugal, and its investor catalogue covers more than {COUNTRIES_FLOOR} European countries.
        </p>

        <div className={p.prose}>
          <h2>What it does</h2>
          <ul>
            <li><strong>For startups:</strong> matches your company against a catalogue of verified investors on sector, stage, ticket size and geography; runs your outreach with daily and weekly targets; keeps your confirmed facts consistent across every message and document; shares documents through a data room with per-investor access and NDA protection; and, on the paid plans, reviews your documents and prepares you for investor questions.</li>
            <li><strong>For investors:</strong> lets you write your mandate once and receive startups that match it, in curated waves, with the fit explained; you browse in private, compare and follow startups, and an introduction happens only when both sides opt in.</li>
            <li><strong>For ecosystem organisations:</strong> gives incubators, accelerators, university and corporate programmes, and public agencies a workspace to invite their startups, see what each founder chooses to share, publish open calls for applications and manage their team.</li>
          </ul>

          <h2>Who it is for</h2>
          <p>Founders raising a round from pre-seed to Series A, mainly in Portugal and Europe. Business angels and angel networks, venture capital funds, corporate venture arms, family offices and public investment bodies. Incubators, accelerators and other ecosystem organisations.</p>

          <h2>Who runs it</h2>
          <p>Sherlock Deal is operated by {CONTROLLER_LEGAL_NAME}, a company registered in Portugal ({OPERATOR_LOCALITY}).</p>

          <h2>How it is paid for</h2>
          <p>
            Sherlock Deal is paid for by subscription. Founders can start free, with no card required; paid plans raise the limits and add AI-personalised drafts and readiness reviews.
            Investors have their own plans, and accelerators, studios and funds that want to cover their portfolio companies can arrange a custom plan.
            Today Sherlock Deal takes no equity and no success fee. The plans and prices are on the <Link href="/#pricing">home page</Link> and on the <Link href="/investors#pricing">investors page</Link>.
          </p>

          <h2>What Sherlock Deal is not</h2>
          <p>Sherlock Deal is not an investor, a broker or a crowdfunding platform. It does not hold funds, does not give investment advice, and does not verify or guarantee any information, valuation or transaction. A match score is a guide, not a recommendation, and it creates no expectation of an introduction, a meeting or an investment. Any decision and any deal happen directly between the parties, outside the platform.</p>

          <h2>How it treats founders&apos; information</h2>
          <p>Investors see the profile a founder has chosen to show, and only once the core profile is complete; founders can hide their company from investors at any time. Documents are opened investor by investor, behind an NDA where the founder requires one. Sherlock Deal never shows investors a founder&apos;s internal performance data — such as outreach activity, notes, or where the founder stands with other investors.</p>

          <h2>Where the investor catalogue comes from</h2>
          <p>The catalogue is compiled and verified from public sources. People and firms in it can read how their data is used, and ask for it to be corrected or removed, in the <Link href="/legal/privacy-notice">privacy notice</Link> and through the <Link href="/privacy-request">data-rights request</Link>.</p>

          <h2>Contact</h2>
          <p>Use the <Link href="/contact">contact form</Link>.</p>
        </div>
      </div>

      <JsonLd
        data={graph(
          organizationNode(),
          websiteNode(),
          aboutPageNode({ name: 'About Sherlock Deal', description: ABOUT_META.description, path: PATH }),
          breadcrumbNode([{ name: 'Home', path: '/' }, { name: 'About', path: PATH }]),
        )}
      />
    </PublicSiteLayout>
  );
}

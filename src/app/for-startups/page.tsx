// Prompt 920 §B.1 — /for-startups: the answer page for founders ("how do I find the right investors for my startup?"). The direct answer
// comes first, then the method, then what Sherlock Deal does, then the five questions of the FAQ's first group. Approved text:
// docs/site-copy-920.md §2; it lives in src/content/site/ and is rendered here and into the HowTo/FAQPage schema from the same lists.
import type { Metadata } from 'next';
import Link from 'next/link';
import { APP_URL, BRAND_NAME } from '@/lib/brand';
import s from '../landing.module.css';
import p from '@/components/site/site-page.module.css';
import { PublicSiteLayout } from '@/components/site/PublicSiteLayout';
import { FaqList } from '@/components/site/FaqList';
import { JsonLd } from '@/components/seo/JsonLd';
import { FOR_STARTUPS_META } from '@/content/site/pages';
import {
  FOR_STARTUPS_ANSWER, FOR_STARTUPS_H1, FOR_STARTUPS_STEPS, LISTS_FAIL, LISTS_FAIL_INTRO, sherlockDoesThisParagraphs,
} from '@/content/site/for-startups';
import { findingInvestmentItems } from '@/content/site/faq';
import { abs, breadcrumbNode, faqPageNode, graph, howToNode, organizationNode, websiteNode } from '@/lib/site-schema';

const PATH = '/for-startups';

export const metadata: Metadata = {
  title: FOR_STARTUPS_META.title,
  description: FOR_STARTUPS_META.description,
  metadataBase: new URL(APP_URL),
  alternates: { canonical: PATH },
  openGraph: { title: FOR_STARTUPS_META.title, description: FOR_STARTUPS_META.description, url: abs(PATH), siteName: BRAND_NAME, type: 'article', locale: 'en' },
  twitter: { card: 'summary', title: FOR_STARTUPS_META.title, description: FOR_STARTUPS_META.description },
};

export default function ForStartupsPage() {
  const [doesThis, outreach] = sherlockDoesThisParagraphs();
  const questions = findingInvestmentItems();

  return (
    <PublicSiteLayout active="startup">
      <div className={p.container}>
        <nav className={p.crumbs} aria-label="Breadcrumb">
          <Link href="/">Home</Link><span aria-hidden="true"> › </span><span aria-current="page">For startups</span>
        </nav>

        <h1 className={p.title}>{FOR_STARTUPS_H1}</h1>
        <p className={p.answer}>{FOR_STARTUPS_ANSWER}</p>

        <div className={p.prose}>
          <h2>Why most investor lists fail</h2>
          <p>{LISTS_FAIL_INTRO}</p>
          <ul>
            {LISTS_FAIL.map((f) => (
              <li key={f.lead}><strong>{f.lead}</strong> {f.text}</li>
            ))}
          </ul>

          <h2>A five-step method that works</h2>
          <ol>
            {FOR_STARTUPS_STEPS.map((step) => (
              <li key={step.name}><strong>{step.name}.</strong> {step.text}</li>
            ))}
          </ol>

          <h2>How Sherlock Deal does this for you</h2>
          <p>{doesThis}</p>
          <p>{outreach}</p>
        </div>

        <p className={p.ctaRow}>
          <Link className={`${s.btn} ${s.btnPrimary}`} href="/signup">Start free</Link>
          <span className={p.ctaNote}><b>Free to start.</b> No credit card required.</span>
        </p>

        <h2 className={p.groupTitle}>Questions founders ask</h2>
        <FaqList items={questions} />

        <div className={`${s.band} ${p.ctaWrap}`}>
          <h2>The game is afoot.</h2>
          <p>Open your case file today — your pipeline, your facts and your data room, finally in one place.</p>
          <Link className={`${s.btn} ${s.btnPrimary}`} href="/signup">Create your account</Link>
        </div>
      </div>

      <JsonLd
        data={graph(
          organizationNode(),
          websiteNode(),
          howToNode({
            name: 'How to find the right investors for your startup',
            description: FOR_STARTUPS_ANSWER,
            steps: FOR_STARTUPS_STEPS,
            path: PATH,
          }),
          faqPageNode(questions, PATH),
          breadcrumbNode([{ name: 'Home', path: '/' }, { name: 'For startups', path: PATH }]),
        )}
      />
    </PublicSiteLayout>
  );
}

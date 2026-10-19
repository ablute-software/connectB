// Prompt 920 §C — /faq: the 20 questions founders and investors ask, in five groups. Every answer is in the HTML (the accordion is only
// visual) and the FAQPage schema is built from the very same list, so what a machine reads is what a person reads. Approved text:
// docs/site-copy-920.md §5; it lives in src/content/site/faq.ts, where every number is read from the product.
import type { Metadata } from 'next';
import Link from 'next/link';
import { APP_URL, BRAND_NAME } from '@/lib/brand';
import p from '@/components/site/site-page.module.css';
import { PublicSiteLayout } from '@/components/site/PublicSiteLayout';
import { FaqList } from '@/components/site/FaqList';
import { JsonLd } from '@/components/seo/JsonLd';
import { FAQ_META, OG_DEFAULT_IMAGE } from '@/content/site/pages';
import { allFaqItems, buildFaqGroups } from '@/content/site/faq';
import { abs, breadcrumbNode, faqPageNode, graph, organizationNode, websiteNode } from '@/lib/site-schema';

const PATH = '/faq';

export const metadata: Metadata = {
  title: FAQ_META.title,
  description: FAQ_META.description,
  metadataBase: new URL(APP_URL),
  alternates: { canonical: PATH },
  openGraph: { title: FAQ_META.title, description: FAQ_META.description, url: abs(PATH), siteName: BRAND_NAME, type: 'website', locale: 'en', images: [OG_DEFAULT_IMAGE] },
  twitter: { card: 'summary_large_image', title: FAQ_META.title, description: FAQ_META.description, images: [{ url: OG_DEFAULT_IMAGE.url, alt: OG_DEFAULT_IMAGE.alt }] },
};

export default function FaqPage() {
  const groups = buildFaqGroups();

  return (
    <PublicSiteLayout>
      <div className={p.container}>
        <nav className={p.crumbs} aria-label="Breadcrumb">
          <Link href="/">Home</Link><span aria-hidden="true"> › </span><span aria-current="page">FAQ</span>
        </nav>

        <h1 className={p.title}>Frequently asked questions</h1>
        <p className={p.answer}>
          Answers about finding investment, how Sherlock Deal helps, and getting started. For the method behind them, read{' '}
          <Link href="/for-startups">how to find the right investors for your startup</Link>; investors can start from{' '}
          <Link href="/investors">Sherlock Deal for investors</Link>.
        </p>

        {groups.map((g) => (
          <section key={g.id} aria-labelledby={`group-${g.id}`}>
            <h2 id={`group-${g.id}`} className={p.groupTitle}>{g.title}</h2>
            <FaqList items={g.items} />
          </section>
        ))}
      </div>

      <JsonLd
        data={graph(
          organizationNode(),
          websiteNode(),
          faqPageNode(allFaqItems(), PATH),
          breadcrumbNode([{ name: 'Home', path: '/' }, { name: 'FAQ', path: PATH }]),
        )}
      />
    </PublicSiteLayout>
  );
}

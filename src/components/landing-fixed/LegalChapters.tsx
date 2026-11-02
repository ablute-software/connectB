'use client';
// Prompt 935 — the ONE document of the Documents popup: six chapters, the visitor scrolls to the one they chose. Loaded on demand (next/dynamic from the landing), so the legal text is not in the landing's first
// JavaScript. Every chapter is the product's real text, never a summary written for the mockup:
//   Terms, Privacy notice, Suppliers — the same components as /terms, /legal/privacy-notice, /legal/subprocessors (the pages render these too).
//   Data rights — the form lives at /privacy-request; here, what the notice says about the rights and the way in.
//   GDPR — the privacy notice's own statements on lawful basis, retention, rights and the authority; there is no separate "GDPR statement" in the product, and this chapter says so.
//   AI Act — Clause 9 of the Terms, as written (the product's AI transparency commitment lives there); no separate AI Act statement exists, and the chapter says so.
import { useEffect } from 'react';
import Link from 'next/link';
import { TermsDocument } from '@/components/terms/TermsDocument';
import { PrivacyNoticeBody } from '@/components/legal/PrivacyNoticeBody';
import { SuppliersTable } from '@/components/legal/SuppliersTable';
import { CATALOG_RETENTION_MONTHS } from '@/lib/controller';
import { getTermsMarkdown } from '@/lib/terms';
import { DOC_ORDER, type DocId } from '@/content/site/landing-fixed';

export const DOC_TITLES: Record<DocId, string> = {
  terms: 'Terms & conditions',
  privacy: 'Privacy notice',
  suppliers: 'Suppliers & sub-processors',
  'data-rights': 'Data-rights request',
  gdpr: 'GDPR',
  'ai-act': 'AI Act',
};

/** Clause 9 of the Terms, as written: paragraphs only, the markdown's bold markers dropped. */
export function aiClauseParagraphs(markdown: string = getTermsMarkdown()): string[] {
  const a = markdown.indexOf('## 9.');
  const b = markdown.indexOf('## 10.');
  if (a < 0 || b < 0 || b < a) return [];
  return markdown.slice(a, b).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => l.replace(/\*\*/g, ''));
}

function Source({ children }: { children: React.ReactNode }) {
  return <p className="fx-source">{children}</p>;
}

function Chapter({ id, n, highlight, children }: { id: DocId; n: number; highlight: DocId; children: React.ReactNode }) {
  return (
    <section id={`doc-${id}`} className="fx-chapter" data-chapter={id}>
      <h2 className={`fx-chapter-title${id === highlight ? ' fx-hl' : ''}`}>{n}. {DOC_TITLES[id]}</h2>
      {children}
    </section>
  );
}

export default function LegalChapters({ highlight }: { highlight: DocId }) {
  // the popup opens scrolled to the chapter that was chosen: the nearest scrolling ancestor is moved, never the page (scrollIntoView would scroll the fixed root too)
  useEffect(() => {
    const el = document.getElementById(`doc-${highlight}`);
    let p = el?.parentElement ?? null;
    while (p && !/(auto|scroll)/.test(getComputedStyle(p).overflowY)) p = p.parentElement;
    if (el && p) p.scrollTop += el.getBoundingClientRect().top - p.getBoundingClientRect().top;
  }, [highlight]);
  const ai = aiClauseParagraphs();
  const body: Record<DocId, React.ReactNode> = {
    terms: (
      <>
        <Source>The full text of the Terms, as published at /terms.</Source>
        <div className="fx-paper"><TermsDocument /></div>
      </>
    ),
    privacy: (
      <>
        <Source>As published at /legal/privacy-notice.</Source>
        <div className="fx-paper"><PrivacyNoticeBody /></div>
      </>
    ),
    suppliers: (
      <>
        <Source>As published at /legal/subprocessors.</Source>
        <div className="fx-paper"><SuppliersTable /></div>
      </>
    ),
    'data-rights': (
      <div className="fx-paper">
        <p className="mt-2 text-sm leading-relaxed text-gray-700">
          You can ask for a copy of what we hold about you, have it corrected, object to us holding it, or ask us to delete it. Objecting is enough — you do not have to give a reason. We answer within one month; a
          complex request may take up to two months more, and we tell you within the first month if so.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-gray-700">
          The request is made through the data-rights form; it takes an email address and what you would like us to do, and no account is needed.{' '}
          <Link href="/privacy-request" className="underline">Open the data-rights form</Link>.
        </p>
      </div>
    ),
    gdpr: (
      <div className="fx-paper">
        <p className="fx-source" style={{ color: '#5b6f75' }}>
          There is no separate GDPR statement yet. What follows is what the privacy notice says on the subject, in the notice’s words; the notice itself is Chapter 2.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-gray-700"><b>Lawful basis.</b> Legitimate interests (Article 6(1)(f)): the interest is in making a professional introduction market work. We hold only information connected to a person’s professional role, never anything about their private life.</p>
        <p className="mt-2 text-sm leading-relaxed text-gray-700"><b>Retention.</b> An entry with no activity — no delivery to a customer, no contact, no correction — is deleted after {CATALOG_RETENTION_MONTHS} months. Deleted, not archived.</p>
        <p className="mt-2 text-sm leading-relaxed text-gray-700"><b>Rights.</b> Access, correction, objection and deletion. Objecting is enough: you do not have to give a reason, and we will stop.</p>
        <p className="mt-2 text-sm leading-relaxed text-gray-700"><b>Complaints.</b> You can complain to a supervisory authority; in Portugal that is the CNPD (cnpd.pt).</p>
      </div>
    ),
    'ai-act': (
      <div className="fx-paper">
        <p className="fx-source" style={{ color: '#5b6f75' }}>
          There is no separate AI Act statement yet. The product’s commitment on AI is Clause 9 of the Terms, reproduced here as written.
        </p>
        {ai.length === 0
          ? <p className="mt-2 text-sm leading-relaxed text-gray-700">See Clause 9 of the Terms &amp; Conditions (Chapter 1).</p>
          : ai.map((p, i) => <p key={i} className="mt-2 text-sm leading-relaxed text-gray-700">{p}</p>)}
      </div>
    ),
  };
  return (
    <>
      {DOC_ORDER.map((id, i) => <Chapter key={id} id={id} n={i + 1} highlight={highlight}>{body[id]}</Chapter>)}
    </>
  );
}

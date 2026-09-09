// Prompt 616 §B.2 / §F, unblocked by Prompt 624 §B and built in Prompt 626 §C
// — the Article 14 notice for people whose professional details are in the
// catalogue and who never gave them to us.
//
// Public, no session, same as /terms and /legal/subprocessors. That is not a
// convenience: Article 14(5)(b) lets a controller skip telling people
// individually when it would take disproportionate effort — we hold a contact
// channel for 5 of 3 472 — but only if it compensates with measures that make
// the information publicly available. This page IS that compensation, so a
// login in front of it would defeat the exemption it exists to support.
//
// WHAT THIS PAGE DELIBERATELY DOES NOT HAVE, because it is easy to build by
// accident and someone will eventually ask for it (Prompt 616 §B.3, restated
// in 626 §C): a name search. "Am I in your database?" turns the catalogue into
// an oracle — anybody could confirm whether a given person is in it, which is
// a disclosure wearing the costume of transparency. The form takes the
// request; the answer goes by email after identity is verified.
//
// TWO FIELDS ARE VISIBLE PLACEHOLDERS, and that is the instruction, not an
// oversight: "deixem-nos como marcadores visíveis, não inventem. Uma página
// com uma morada errada é pior do que uma com um espaço por preencher."
// (626 §C.) The registered office in our Terms reads "Torre Active Centre, Y"
// — the "Y" is itself an unfilled slot, which is exactly why it is not being
// copied here. Fill CONTROLLER_ADDRESS and NEXT_PUBLIC_PRIVACY_EMAIL and both
// placeholders disappear on their own.
import Link from 'next/link';
import { BRAND_NAME } from '@/lib/brand';
import {
  CATALOG_RETENTION_MONTHS, CONTROLLER_LEGAL_NAME, CONTROLLER_NIPC, PRIVACY_CONTACT_EMAIL,
} from '@/lib/controller';

export const metadata = {
  title: `How we hold professional contact information — ${BRAND_NAME}`,
  description: 'What we hold about people who work at investment firms, where it came from, and how to have it corrected, restricted or deleted.',
};

/** An unfilled fact, made impossible to mistake for a filled one. */
function Pending({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-amber-100 px-1 py-0.5 font-medium text-amber-900">
      [{children}]
    </span>
  );
}

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h2 className="text-sm font-bold text-gray-900">{heading}</h2>
      <div className="mt-1 space-y-2 text-sm leading-relaxed text-gray-700">{children}</div>
    </section>
  );
}

export default function PrivacyNoticePage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-2xl px-4 py-10 md:px-8">
        <Link href="/" className="text-xs text-gray-400 hover:underline">← {BRAND_NAME}</Link>
        <div className="mt-2 mb-4 flex items-center justify-between gap-3 border-b border-gray-100 pb-4">
          <h1 className="text-lg font-bold text-gray-900">How we hold professional contact information</h1>
          <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-500">Updated 9 Sep 2026</span>
        </div>

        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Draft under legal review. The facts below are stated as measured; two fields — our registered office and
          the address for privacy questions — are still to be filled in, and are marked as such rather than guessed.
        </div>

        <p className="text-sm leading-relaxed text-gray-700">
          If you work at an investment firm, your professional details may be in {BRAND_NAME} without you having
          given them to us. This page tells you what we hold, where it came from, and what you can do about it. It is
          the notice required by Article 14 of the GDPR.
        </p>

        <Section heading="Who we are">
          <p>
            {CONTROLLER_LEGAL_NAME} (NIPC {CONTROLLER_NIPC}), <Pending>registered office — to be confirmed</Pending>,
            Portugal. We are the controller for the information described here. You can reach us about anything on
            this page at{' '}
            {PRIVACY_CONTACT_EMAIL
              ? <a className="underline" href={`mailto:${PRIVACY_CONTACT_EMAIL}`}>{PRIVACY_CONTACT_EMAIL}</a>
              : <Pending>privacy contact address — to be confirmed</Pending>}
            , or through the form linked at the bottom of this page, which works today.
          </p>
        </Section>

        <Section heading="What we hold">
          <p>
            For people who work at investment firms: name, job title, the firm, the country or city they are based
            in, and a link to their public professional profile.
          </p>
          <p>
            Where our system has produced one, we also hold a short written summary of a person&apos;s professional
            focus — what they appear to invest in, how a founder might best approach them, and subjects to avoid.
            These summaries are generated automatically from public sources and are intended to help a founder decide
            whether and how to make an approach. We are naming this plainly because it is the most sensitive thing
            here and it would be misleading to file it under &quot;public professional data&quot;: it is profiling in
            the sense of Article 4(4). It is not automated decision-making with legal effects (Article 22) — no
            decision about you is taken by the system; a person reads it and decides for themselves.
          </p>
        </Section>

        <Section heading="Where it came from">
          <p>
            From the firm&apos;s own website, from publicly accessible professional profiles, and in some cases from a
            founder who told us about a person they had met. We record the source for each entry. Entries created
            before we started recording it carry a source marked as <i>inferred</i> rather than recorded — we would
            rather say we are unsure than state a source we cannot stand behind.
          </p>
        </Section>

        <Section heading="Why we hold it">
          <p>
            So that founders raising capital can find investors whose stated focus matches their company, and
            approach the right person rather than a generic address. Our lawful basis is legitimate interests
            (Article 6(1)(f)): the interest is in making a professional introduction market work. We hold only
            information connected to a person&apos;s professional role, never anything about their private life. You
            can object to this at any time, and you do not have to give a reason.
          </p>
        </Section>

        <Section heading="Who sees it">
          <p>
            Founders using {BRAND_NAME} see the entries relevant to the investors they are considering. Our suppliers
            — hosting, email delivery and AI processing — handle it only to keep the service running, on our
            instructions, and cannot use it for their own purposes. The current list is at{' '}
            <Link href="/legal/subprocessors" className="underline">our suppliers</Link>. We do not sell it.
          </p>
        </Section>

        <Section heading="Where it is held">
          <p>
            The database and authentication run in Supabase&apos;s eu-west-2 region (London, United Kingdom, covered
            by an adequacy decision). The application itself runs on Vercel in the United States, and our email and
            AI suppliers are US-based. Transfers outside the EEA therefore exist and rest on adequacy decisions or
            standard contractual clauses; each supplier and its region is listed on the{' '}
            <Link href="/legal/subprocessors" className="underline">suppliers page</Link>.
          </p>
        </Section>

        <Section heading="How long we keep it">
          <p>
            An entry with no activity — no delivery to a customer, no contact, no correction — is deleted after{' '}
            {CATALOG_RETENTION_MONTHS} months. Deleted, not archived.
          </p>
        </Section>

        <Section heading="Your rights">
          <p>
            You can ask us for a copy of what we hold about you, have it corrected, object to us holding it at all,
            or ask us to delete it. <b>Objecting is enough — you do not have to give a reason</b>, and we will stop.
          </p>
          <p>
            If you object or ask for deletion, we keep the minimum needed to make it stick: a record that this person
            asked not to be included, so that the next time we gather information from the same public sources you
            are not added back. That record holds no profile — only enough to recognise and skip you.
          </p>
          <p>
            We answer within one month. If a request is complex we may take up to two months more, and if that
            happens we will tell you within the first month and say why.
          </p>
          <p>
            You can also complain to a supervisory authority. In Portugal that is the CNPD (
            <a href="https://www.cnpd.pt" className="underline" target="_blank" rel="noreferrer noopener">cnpd.pt</a>).
          </p>
        </Section>

        <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
          <p className="text-sm font-semibold text-gray-900">To exercise any of these</p>
          <p className="mt-1 text-sm text-gray-700">
            Use the <Link href="/privacy-request" className="underline">data-rights form</Link>. It takes an email
            address and what you would like us to do; no account is needed.
          </p>
          <p className="mt-2 text-xs text-gray-500">
            There is deliberately no way to search this page for a name. Telling anyone who asks whether a given
            person is in our records would itself be a disclosure. Send the request and we will reply to you, by
            email, once we have confirmed who you are.
          </p>
        </div>

        <p className="mt-6 text-xs text-gray-500">
          <Link href="/terms" className="underline">Terms &amp; Conditions</Link> ·{' '}
          <Link href="/legal/subprocessors" className="underline">Suppliers</Link> ·{' '}
          <Link href="/privacy-request" className="underline">Data-rights request</Link>
        </p>
      </div>
    </div>
  );
}

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
import { PrivacyNoticeBody } from '@/components/legal/PrivacyNoticeBody';

export const metadata = {
  title: `How we hold professional contact information — ${BRAND_NAME}`,
  description: 'What we hold about people who work at investment firms, where it came from, and how to have it corrected, restricted or deleted.',
};

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

        <PrivacyNoticeBody />

        <p className="mt-6 text-xs text-gray-500">
          <Link href="/terms" className="underline">Terms &amp; Conditions</Link> ·{' '}
          <Link href="/legal/subprocessors" className="underline">Suppliers</Link> ·{' '}
          <Link href="/privacy-request" className="underline">Data-rights request</Link>
        </p>
      </div>
    </div>
  );
}

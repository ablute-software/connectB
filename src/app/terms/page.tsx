// Prompt 341 §C — public consultation page (DL 7/2004 pre-contractual
// information duty: the text must be reachable BEFORE anyone contracts,
// not only after signup). No auth — see PUBLIC in middleware.ts.
import Link from 'next/link';
import { TermsDocument } from '@/components/terms/TermsDocument';
import { TERMS_VERSION } from '@/lib/terms';
import { BRAND_NAME } from '@/lib/brand';

export const metadata = { title: `Terms & Conditions — ${BRAND_NAME}` };

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-2xl px-4 py-10 md:px-8">
        <Link href="/" className="text-xs text-gray-400 hover:underline">← {BRAND_NAME}</Link>
        <div className="mt-2 mb-6 flex items-center justify-between border-b border-gray-100 pb-4">
          <h1 className="text-lg font-bold text-gray-900">Terms & Conditions</h1>
          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-500">Version {TERMS_VERSION}</span>
        </div>
        <TermsDocument />
      </div>
    </div>
  );
}

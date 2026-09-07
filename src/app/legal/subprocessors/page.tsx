// Prompt 603 commitment 7 — "the current list is published". Public, no
// auth (same reasoning as /terms). The Terms (v3, clause 8.3) name these
// suppliers and point at "[link]" — this is that link.
//
// Facts as measured on 2026-09-07, to be confirmed in the legal review
// (§C question 2): the database and authentication run in Supabase's
// eu-west-2 region (London); the application's serverless functions ran in
// Vercel's iad1 region (Washington, US) per the platform's own response
// headers; Stripe, Anthropic and Resend are US-headquartered. Transfers
// outside the EEA therefore exist and rest on adequacy decisions or standard
// contractual clauses, as the Terms already state.
import Link from 'next/link';
import { BRAND_NAME } from '@/lib/brand';
import { CONTROLLER_NAME } from '@/content/commitments/v1';

export const metadata = { title: `Suppliers (sub-processors) — ${BRAND_NAME}` };

const SUPPLIERS: { name: string; purpose: string; data: string; where: string }[] = [
  { name: 'Supabase', purpose: 'Database, authentication, file storage', data: 'Everything the workspace stores', where: 'eu-west-2 (London, United Kingdom — adequacy decision)' },
  { name: 'Vercel', purpose: 'Hosting and execution of the application', data: 'Requests and responses in transit; server logs', where: 'Serverless functions in iad1 (United States) — standard contractual clauses' },
  { name: 'Stripe', purpose: 'Payments and subscriptions', data: 'Billing identity and payment status; card data never reaches us', where: 'United States / Ireland — standard contractual clauses' },
  { name: 'Anthropic', purpose: 'AI processing (extractions, summaries, drafts)', data: 'The text of documents and fields sent for a given feature, on your instruction', where: 'United States — standard contractual clauses' },
  { name: 'Resend', purpose: 'Transactional email delivery', data: 'Recipient address, subject and message body of emails we send you', where: 'United States — standard contractual clauses' },
  { name: 'VirusTotal', purpose: 'Malware check on uploaded files', data: 'A SHA-256 hash of the file only — never the file or its content', where: 'Hash lookup only; no personal data' },
];

export default function SubprocessorsPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-2xl px-4 py-10 md:px-8">
        <Link href="/" className="text-xs text-gray-400 hover:underline">← {BRAND_NAME}</Link>
        <div className="mt-2 mb-4 flex items-center justify-between border-b border-gray-100 pb-4">
          <h1 className="text-lg font-bold text-gray-900">Our suppliers (sub-processors)</h1>
          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-500">Updated 7 Sep 2026</span>
        </div>
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Draft under legal review. Regions and legal bases are stated as measured; confirmation with each supplier&apos;s data-processing agreement is pending.
        </div>
        <p className="text-sm text-gray-700">
          {CONTROLLER_NAME} runs {BRAND_NAME} with a short list of suppliers. Each processes your data only on our instructions, cannot use it for its own purposes, and is bound by a data-protection agreement. We tell you before this list changes.
        </p>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-400"><th className="py-1 pr-3">Supplier</th><th className="pr-3">Purpose</th><th className="pr-3">What it processes</th><th>Where</th></tr></thead>
            <tbody>
              {SUPPLIERS.map((s) => (
                <tr key={s.name} className="border-t border-gray-100 align-top">
                  <td className="py-2 pr-3 font-medium text-gray-900">{s.name}</td>
                  <td className="pr-3 text-gray-700">{s.purpose}</td>
                  <td className="pr-3 text-gray-700">{s.data}</td>
                  <td className="text-gray-600">{s.where}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-5 text-xs text-gray-500">
          Questions about a supplier, or a data-rights request: <Link href="/privacy-request" className="underline">data-rights request</Link> · <Link href="/terms" className="underline">Terms &amp; Conditions</Link> (clause 8.3).
        </p>
      </div>
    </div>
  );
}

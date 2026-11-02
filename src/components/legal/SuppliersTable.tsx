// Prompt 935 (02/11/2026) — the suppliers table, moved out of /legal/subprocessors unchanged so the page and the landing's Documents popup show the same list.

const SUPPLIERS: { name: string; purpose: string; data: string; where: string }[] = [
  { name: 'Supabase', purpose: 'Database, authentication, file storage', data: 'Everything the workspace stores', where: 'eu-west-2 (London, United Kingdom — adequacy decision)' },
  { name: 'Vercel', purpose: 'Hosting and execution of the application', data: 'Requests and responses in transit; server logs', where: 'Serverless functions in iad1 (United States) — standard contractual clauses' },
  { name: 'Stripe', purpose: 'Payments and subscriptions', data: 'Billing identity and payment status; card data never reaches us', where: 'United States / Ireland — standard contractual clauses' },
  { name: 'Anthropic', purpose: 'AI processing (extractions, summaries, drafts)', data: 'The text of documents and fields sent for a given feature, on your instruction', where: 'United States — standard contractual clauses' },
  { name: 'Resend', purpose: 'Transactional email delivery', data: 'Recipient address, subject and message body of emails we send you', where: 'United States — standard contractual clauses' },
  { name: 'VirusTotal', purpose: 'Malware check on uploaded files', data: 'A SHA-256 hash of the file only — never the file or its content', where: 'Hash lookup only; no personal data' },
];

export function SuppliersTable() {
  return (
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
  );
}

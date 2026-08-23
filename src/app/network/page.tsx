'use client';
// My Network — Prompt 314 §C. New top-level sidebar entry (Group 3, before
// Messages); placeholder only for now, per explicit instruction — no gate,
// no data, no fake UI. The real feature (a founder's relationship network
// with investors, advisors, and fellow founders) is built in a later prompt.
export default function NetworkPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">My Network</h1>
      <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center">
        <p className="text-sm text-gray-500">
          Coming soon — your relationship network with investors, advisors and fellow founders will live here.
        </p>
      </div>
    </div>
  );
}

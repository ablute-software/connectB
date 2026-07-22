'use client';
// Investor portal — external view (demo). In production: magic-link auth (Supabase),
// grants validated server-side, signed URLs, optional watermark, view logging.
import { useState } from 'react';
import { useStore } from '@/lib/store';

export default function PortalPage() {
  const { db, recordDemoView } = useStore();
  const [email, setEmail] = useState('');
  const [signedIn, setSignedIn] = useState(false);
  const [ndaAccepted, setNdaAccepted] = useState(false);

  const person = db.people.find((p) => p.email_verified?.toLowerCase() === email.toLowerCase());
  const grants = db.grants.filter((g) =>
    !g.revoked_at && (!g.expires_at || new Date(g.expires_at) > new Date())
    && ((person && g.person_id === person.id) || g.grantee_email?.toLowerCase() === email.toLowerCase()));
  const needsNda = grants.some((g) => g.nda_required && !g.nda_accepted_at) && !ndaAccepted;

  const grantedDocs = db.documents.filter((d) =>
    grants.some((g) => g.document_id === d.id || (g.folder_id && g.folder_id === d.folder_id)));
  const grantedFolders = db.folders.filter((f) => grants.some((g) => g.folder_id === f.id));

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <div>
            <span className="text-xl font-bold text-[#0E7490]" style={{ fontFamily: 'Comfortaa, sans-serif' }}>ablute<span className="text-[#22D3EE]">_</span></span>
            <span className="ml-2 text-sm text-gray-400">Investor data room</span>
          </div>
          <span className="text-[10px] font-bold text-[#B00000]">CONFIDENTIAL — SUBJECT TO NDA</span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl p-6">
        {!signedIn ? (
          <div className="mx-auto mt-16 max-w-sm rounded-lg border border-gray-200 bg-white p-6 text-center">
            <h1 className="text-lg font-semibold">Sign in</h1>
            <p className="mt-1 text-sm text-gray-500">Enter the email your access was granted to. We’ll send a magic link — no password.</p>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@fund.com"
              className="mt-4 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <button onClick={() => setSignedIn(true)} disabled={!email.includes('@')}
              className="mt-3 w-full rounded-lg bg-[#0E7490] px-3 py-2 text-sm font-medium text-white disabled:opacity-40">
              Send magic link (demo: signs in directly)
            </button>
          </div>
        ) : grants.length === 0 ? (
          <div className="mt-16 text-center text-sm text-gray-500">
            No active access for <b>{email}</b>. If you believe this is an error, contact {db.org.sender_email}.
          </div>
        ) : needsNda ? (
          <div className="mx-auto mt-16 max-w-md rounded-lg border border-gray-200 bg-white p-6">
            <h1 className="text-lg font-semibold">Non-disclosure agreement</h1>
            <p className="mt-2 text-sm text-gray-600">
              Access to these materials requires accepting the confidentiality terms. Your acceptance is recorded with a timestamp.
            </p>
            <button onClick={() => setNdaAccepted(true)}
              className="mt-4 w-full rounded-lg bg-[#0E7490] px-3 py-2 text-sm font-medium text-white">
              I accept the NDA terms
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-gray-500">Signed in as <b>{email}</b>. You can see only the items granted to you.</p>
            {grantedFolders.map((f) => (
              <div key={f.id} className="rounded-lg border border-gray-200 bg-white p-4">
                <h2 className="text-sm font-semibold">{f.name}</h2>
                <p className="text-xs text-gray-400">Folder access — documents appear here as they are added.</p>
              </div>
            ))}
            {grantedDocs.map((d) => (
              <div key={d.id} className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-4">
                <span className="text-xl">▤</span>
                <div className="flex-1">
                  <div className="text-sm font-medium">{d.name}</div>
                  <div className="text-xs text-gray-400">{d.version} {d.watermark && '· watermarked'} {!d.downloadable && '· view only, no download'}</div>
                </div>
                <a href={d.external_url ?? '#'} target="_blank"
                  onClick={() => recordDemoView(d.id, email)}
                  className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white">Open</a>
              </div>
            ))}
            <p className="text-center text-[10px] text-gray-400">Every access is logged. ablute_ · Seed Round 2026</p>
          </div>
        )}
      </main>
    </div>
  );
}

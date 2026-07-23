'use client';
// Investor portal. Real mode (Supabase configured): grants/documents come
// from /api/portal/* (service-role — investors aren't org_members, so RLS
// can't grant them table access; signed URLs are minted server-side).
// Demo mode: unchanged, reads the local store directly.
//
// Data Room V2 (F5): NDA gating is per-item now, not a blanket page gate —
// unlocked items always show; a small note counts whatever's still pending
// a signed NDA. There's no self-click "I accept" anymore — a real signed
// NDA the founder uploads (and AI cross-checks) is what unlocks access now,
// so there's nothing for the investor to click through here.
import { useState } from 'react';
import { useStore } from '@/lib/store';
import { authEnabled } from '@/lib/supabase';
import { resolveDocumentAccess, unlockedGrants } from '@/lib/data-room';

interface PortalDoc {
  id: string; name: string; version?: string; watermark: boolean;
  downloadable: boolean; folder_id?: string; url: string | null;
}
interface PortalData {
  orgName: string | null; senderEmail?: string | null; pendingNdaCount: number;
  folders: { id: string; name: string }[]; documents: PortalDoc[];
}

export default function PortalPage() {
  const { db, recordDocumentView } = useStore();
  const [email, setEmail] = useState('');
  const [signedIn, setSignedIn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [real, setReal] = useState<PortalData | null>(null);

  // ---- demo-mode data (unchanged behaviour, mirrors the real route's
  // per-item NDA gate so the demo preview matches production exactly) ----
  const person = db.people.find((p) => p.email_verified?.toLowerCase() === email.toLowerCase());
  const demoAllGrants = db.grants.filter((g) =>
    !g.revoked_at && (!g.expires_at || new Date(g.expires_at) > new Date())
    && ((person && g.person_id === person.id) || g.grantee_email?.toLowerCase() === email.toLowerCase()));
  // Same resolution as the real /api/portal/access route: a document's own
  // grant overrides the folder it lives in, in either direction — a naive
  // "any unlocked grant covers it" check would let a looser folder-level
  // grant silently bypass a stricter per-document override (caught live).
  const demoCandidateDocs = db.documents.filter((d) =>
    demoAllGrants.some((g) => g.document_id === d.id || (g.folder_id && g.folder_id === d.folder_id)));
  const demoDocAccess = resolveDocumentAccess(demoAllGrants, demoCandidateDocs.map((d) => ({ id: d.id, folder_id: d.folder_id })));
  const demoDocs = demoCandidateDocs.filter((d) => demoDocAccess.visibleIds.includes(d.id));
  const demoFolderGrants = demoAllGrants.filter((g) => g.folder_id);
  const demoUnlockedFolderGrants = unlockedGrants(demoFolderGrants);
  const demoFolders = db.folders.filter((f) => demoUnlockedFolderGrants.some((g) => g.folder_id === f.id));
  const demoPendingNdaCount = (demoFolderGrants.length - demoUnlockedFolderGrants.length) + demoDocAccess.pendingCount;

  async function fetchAccess() {
    const res = await fetch(`/api/portal/access?email=${encodeURIComponent(email)}`);
    setReal(await res.json());
  }

  async function signIn() {
    if (authEnabled) { setLoading(true); await fetchAccess(); setLoading(false); }
    setSignedIn(true);
  }

  function openDoc(doc: PortalDoc | { id: string; external_url?: string }) {
    if (authEnabled) {
      fetch('/api/portal/view', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ documentId: doc.id, email }),
      });
    } else {
      recordDocumentView(doc.id, email);
    }
    window.open(('url' in doc ? doc.url : doc.external_url) ?? '#', '_blank');
  }

  const orgName = authEnabled ? real?.orgName : db.org.name;
  const senderEmail = authEnabled ? real?.senderEmail : db.org.sender_email;
  const pendingNdaCount = authEnabled ? real?.pendingNdaCount ?? 0 : demoPendingNdaCount;
  const folders = authEnabled ? real?.folders ?? [] : demoFolders;
  const documents = authEnabled ? real?.documents ?? [] : demoDocs;
  const hasAccess = authEnabled
    ? ((real?.documents.length ?? 0) + (real?.folders.length ?? 0) + (real?.pendingNdaCount ?? 0)) > 0
    : demoAllGrants.length > 0;

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
            <button onClick={signIn} disabled={!email.includes('@') || loading}
              className="mt-3 w-full rounded-lg bg-[#0E7490] px-3 py-2 text-sm font-medium text-white disabled:opacity-40">
              {loading ? 'Checking access…' : authEnabled ? 'Check access' : 'Send magic link (demo: signs in directly)'}
            </button>
          </div>
        ) : loading ? (
          <div className="mt-16 text-center text-sm text-gray-400">Loading…</div>
        ) : !hasAccess ? (
          <div className="mt-16 text-center text-sm text-gray-500">
            No active access for <b>{email}</b>. If you believe this is an error, contact {senderEmail ?? 'the founder'}.
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-gray-500">Signed in as <b>{email}</b>{orgName ? <> · <b>{orgName}</b></> : ''}. You can see only the items granted to you.</p>
            {pendingNdaCount > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                Awaiting NDA — {pendingNdaCount} more item{pendingNdaCount === 1 ? '' : 's'} will appear here once your signed NDA is on file.
              </div>
            )}
            {folders.map((f) => (
              <div key={f.id} className="rounded-lg border border-gray-200 bg-white p-4">
                <h2 className="text-sm font-semibold">{f.name}</h2>
                <p className="text-xs text-gray-400">Folder access — documents appear here as they are added.</p>
              </div>
            ))}
            {documents.map((d) => (
              <div key={d.id} className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-4">
                <span className="text-xl">▤</span>
                <div className="flex-1">
                  <div className="text-sm font-medium">{d.name}</div>
                  <div className="text-xs text-gray-400">{d.version} {d.watermark && '· watermarked'} {!d.downloadable && '· view only, no download'}</div>
                </div>
                <button onClick={() => openDoc(d)} className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white">Open</button>
              </div>
            ))}
            <p className="text-center text-[10px] text-gray-400">Every access is logged. ablute_ · Seed Round 2026</p>
            <ClaimProfileSection />
          </div>
        )}
      </main>
    </div>
  );
}

// IRM_SPEC §5 — investor self-claim. Inert until LinkedIn OAuth is actually
// configured (a claim needs a verified identity to score a match against);
// GDPR/RGPD requests don't wait on this — see /privacy-request.
function ClaimProfileSection() {
  const enabled = process.env.NEXT_PUBLIC_LINKEDIN_OAUTH_ENABLED === 'true';
  return (
    <div className="mt-2 rounded-lg border border-dashed border-gray-200 bg-white p-4 text-center">
      <h2 className="text-sm font-semibold text-gray-700">Is this you?</h2>
      {enabled ? (
        <button className="mt-2 rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white">Sign in with LinkedIn to claim your profile</button>
      ) : (
        <p className="mt-1 text-xs text-gray-400">
          LinkedIn sign-in is coming soon. In the meantime, you can{' '}
          <a href="/privacy-request" className="text-[#0E7490] hover:underline">request a correction or removal</a> of your info directly.
        </p>
      )}
    </div>
  );
}

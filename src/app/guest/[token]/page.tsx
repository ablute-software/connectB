'use client';
// Item 1 (Lote E) — the guest preview: no session, no password, no
// "create an account first" wall before seeing anything. Resolves via
// /api/guest/[token] (public, service-role, never a signed URL — see that
// route's own header).
//
// Prompt 154 — 4 gaps closed vs. the original build:
// 1. A static, non-interactive "frosted glass" sidebar now surrounds the
//    preview card — same visual language as WorkspaceSidebar (investor
//    labels, since this guest is being invited to become one), blurred and
//    unclickable, so the page reads as "there's a real app here, sign up to
//    unlock it" rather than a bare card floating on a blank page. It's
//    deliberately its own static markup, not a reuse of WorkspaceSidebar
//    itself: that component assumes real navigation (Link hrefs / tab
//    state) neither of which exists for an unauthenticated guest, and
//    forcing a disabled mode into a primitive three other real shells rely
//    on isn't worth it for a decorative backdrop.
// 2. The document list is now a real folder tree (see GuestPreview type),
//    not a flat sorted name list.
// 3. (documents/page.tsx's grant flow) — separate file, see that page.
//
// Prompt 159 — reverts gap 3 as originally shipped here (commit 26455c1),
// which had pointed this CTA at /signup?as=investor (InvestorSignupPanel ->
// /api/investor-access-request, a manual-review lead form). Flagged in that
// same commit and confirmed a real regression, not a judgment call: this
// page already knows it's talking to a VALIDATED guest — data.invitedEmail
// only exists because /api/guest/[token] resolved a real, used
// access_grants.guest_token row. Routing a validated guest through a cold-
// lead review queue was a real downgrade from the original signInWithOtp()
// -> /portal flow, where "Is this you?" (Bloco 33/47) is what actually
// confirms the grant. /signup?as=investor stays available for genuine cold
// leads (someone arriving with no invite at all) — just no longer what
// this specific, already-invited CTA uses.
import { useEffect, useState } from 'react';
import { BRAND_NAME } from '@/lib/brand';
import { browserClient, authEnabled } from '@/lib/supabase';
import { groupGuestDocuments, type GuestShelf } from '@/lib/guest-shelf';

// Prompt 547 — the address is shown masked in the "we'll email a code" line:
// enough for the recipient to recognise their own inbox, not enough to hand a
// forwarded link's holder a full address they did not already have.
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain || local.length <= 2) return email;
  return `${local[0]}…${local[local.length - 1]}@${domain}`;
}

type GuestDoc = { id: string; name: string; shelf: GuestShelf; ndaRequired: boolean };
type GuestFolder = { id: string; name: string; documents: GuestDoc[] };
type GuestPreview = {
  ok: true; orgName: string; orgDescription: string | null; orgLogoUrl: string | null;
  invitedEmail: string; folders: GuestFolder[]; documentNames: string[]; documentCount: number;
  // Prompt 171 — NDA-gated documents the founder hasn't yet accepted a
  // signed NDA for (uploaded by the founder themselves — see /api/data-room/
  // nda-upload; a guest is never prompted for NDA action here). Lets the
  // empty state read as "still in progress" rather than "nothing shared."
  pendingNdaCount: number;
};
type GuestError = { ok: false; reason: 'expired' | 'invalid' };
type GuestResponse = GuestPreview | GuestError;

// Prompt 154 gap 1 — decorative only: no hrefs, no onClick, no active
// state. Labels mirror InvestorWorkspaceShell.tsx's own NAV array (this
// guest is on a path to becoming an investor, not a founder), minus
// "About your firm" (meaningless before any firm is linked).
const FROSTED_NAV = [
  { icon: '▤', label: 'Pipeline' }, { icon: '⋯', label: 'About your firm' }, { icon: '⚿', label: 'Access granted' },
  { icon: '⚖', label: 'Evaluation tools' }, { icon: '◔', label: 'Agenda' }, { icon: '▣', label: 'Archive' },
  { icon: '☎', label: 'Support' }, { icon: '◈', label: 'Plans & billing' },
];

function FrostedSidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-gray-100 bg-white md:flex" aria-hidden="true">
      <div className="px-6 pb-3 pt-6">
        <div className="text-[26px] font-bold leading-none tracking-tight text-[#0E7490]" style={{ fontFamily: 'Comfortaa, Inter, sans-serif' }}>
          {BRAND_NAME}
        </div>
        <div className="mt-1.5 text-[11px] font-medium uppercase tracking-widest text-gray-300">Investor Workspace</div>
      </div>
      <nav className="pointer-events-none mt-1 flex-1 select-none space-y-0.5 px-3 pb-4 opacity-50 blur-[1.5px]">
        {FROSTED_NAV.map((n) => (
          <div key={n.label} className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13.5px] text-gray-600">
            <span className="w-4 text-center text-gray-400">{n.icon}</span>
            <span>{n.label}</span>
          </div>
        ))}
      </nav>
    </aside>
  );
}

export default function GuestPreviewPage({ params }: { params: { token: string } }) {
  const { token } = params;
  const [data, setData] = useState<GuestResponse | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendErr, setSendErr] = useState('');

  useEffect(() => {
    fetch(`/api/guest/${token}`).then((r) => r.json()).then(setData).catch(() => setLoadErr(true));
  }, [token]);

  async function createAccount() {
    if (!data?.ok) return;
    setSending(true); setSendErr('');
    try {
      const sb = browserClient();
      const { error } = await sb.auth.signInWithOtp({
        email: data.invitedEmail,
        options: { shouldCreateUser: true, emailRedirectTo: `${window.location.origin}/auth/callback?next=/portal` },
      });
      if (error) { setSendErr(error.message); return; }
      setSent(true);
    } finally { setSending(false); }
  }

  return (
    <div className="min-h-screen bg-[#F7F9FA]">
      <FrostedSidebar />
      <div className="flex min-h-screen items-center justify-center px-4 py-10 md:pl-60">
        <div className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-7 shadow-sm">
          <div className="mb-5 text-xl font-bold tracking-tight text-[#0E7490] md:hidden" style={{ fontFamily: 'Comfortaa, Inter, sans-serif' }}>
            {BRAND_NAME}
          </div>

          {!authEnabled || loadErr ? (
            <p className="text-sm text-gray-500">This preview isn&apos;t available right now.</p>
          ) : !data ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : !data.ok ? (
            data.reason === 'expired' ? (
              <>
                <p className="text-sm font-medium text-gray-900">This link expired.</p>
                <p className="mt-1.5 text-sm text-gray-500">Ask the founder who invited you for a new one.</p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-gray-900">This link doesn&apos;t work.</p>
                <p className="mt-1.5 text-sm text-gray-500">It may have already been used, or the invite was revoked. Ask the founder who invited you for a new link.</p>
              </>
            )
          ) : (
            <>
              <div className="mb-4 flex items-center gap-3">
                {data.orgLogoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={data.orgLogoUrl} alt="" className="h-10 w-10 rounded-lg border border-gray-100 object-cover" />
                )}
                <div>
                  <p className="text-base font-semibold text-gray-900">{data.orgName}</p>
                  {data.orgDescription && <p className="text-xs text-gray-500">{data.orgDescription}</p>}
                </div>
              </div>
              <p className="mb-4 text-xs text-gray-400">This preview was shared with {data.invitedEmail}.</p>


              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
                {data.documentCount} document{data.documentCount === 1 ? '' : 's'} shared with you
              </p>
              {data.documentCount === 0 ? (
                data.pendingNdaCount > 0 ? (
                  <p className="text-sm text-gray-400">
                    {data.pendingNdaCount} document{data.pendingNdaCount === 1 ? '' : 's'} pending NDA signature.
                  </p>
                ) : (
                  <p className="text-sm text-gray-400">No documents shared yet — check back later.</p>
                )
              ) : (
                (() => {
                  // Prompt 547 — grouped by what the recipient can DO, not by
                  // folder. The old flat list treated both shelves the same and
                  // opened neither, which is what made a shared deck look
                  // broken. Grouping uses the same predicate the open route
                  // enforces (guest-shelf.ts), so a link is never offered that
                  // the route would refuse.
                  const all = data.folders.flatMap((f) => f.documents);
                  const { openNow, confirmRequired } = groupGuestDocuments(all);
                  return (
                    <div className="space-y-5">
                      {openNow.length > 0 && (
                        <div>
                          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">Open now</p>
                          <ul className="space-y-1">
                            {openNow.map((d) => (
                              <li key={d.id}>
                                <a href={`/api/guest/${token}/open/${d.id}`} target="_blank" rel="noopener noreferrer"
                                  className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-[#0E7490] hover:bg-gray-50">
                                  📄 <span className="truncate font-medium">{d.name}</span>
                                  <span className="ml-auto shrink-0 text-[10px] text-gray-400">view only</span>
                                </a>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {confirmRequired.length > 0 && (
                        <div>
                          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">Confirm it&apos;s you to open</p>
                          <ul className="space-y-1">
                            {confirmRequired.map((d) => (
                              <li key={d.id} className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2 text-sm text-gray-600">
                                {d.ndaRequired ? '🔒' : '📄'} <span className="truncate">{d.name}</span>
                              </li>
                            ))}
                          </ul>
                          {sent ? (
                            <div className="mt-2 rounded-xl border border-cyan-100 bg-[#E8F4F8] px-3 py-3 text-sm text-gray-700">
                              Check your email — we sent a one-time code to {data.invitedEmail}.
                            </div>
                          ) : (
                            <div className="mt-2">
                              <button disabled={sending} onClick={() => void createAccount()}
                                className="w-full rounded-lg bg-[#0E7490] px-3 py-2 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40">
                                {sending ? 'Sending…' : 'Send me a code'}
                              </button>
                              {/* The code path is not a signup, so the copy no
                                  longer says it is — that wording is what told
                                  Nuno the link was not for him. */}
                              <p className="mt-1.5 text-center text-[11px] text-gray-400">
                                We&apos;ll email a one-time code to {maskEmail(data.invitedEmail)}. No password, no form.
                              </p>
                              {sendErr && <p className="mt-2 text-xs text-[#B00000]">{sendErr}</p>}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

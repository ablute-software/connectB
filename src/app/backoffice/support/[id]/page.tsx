'use client';
// Contact & Support — back-office ticket detail: original message + event
// timeline, plus the four actions (status, priority, note, reply).
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Card } from '@/components/ui';

interface Ticket {
  id: string; created_at: string; source: string; org_id: string | null; user_id: string | null;
  name: string; email: string; category: string; subject: string; message: string; context: string | null; area: string | null;
  status: string; priority: string; last_activity_at: string; first_response_at: string | null; resolved_at: string | null;
}
interface Event { id: string; created_at: string; author: string; kind: string; body: string | null }
interface Attachment { path: string; url: string | null; malwareFlagged?: boolean }

// Prompt 531 §2/§4 — the reported CONTENT, alongside the report. Before
// this, this page showed only the reporter's own message: a moderator could
// read the complaint but never the post it was about.
interface ContentSnapshot {
  postId: string | null; body: string; kind: string; structured: Record<string, string> | null;
  target: string | null; groupName: string | null; createdAt: string | null;
  authorActorId: string | null; authorName: string | null;
}
interface EvidenceMedia { url: string | null; kind: 'image' | 'file'; label: string | null; unavailableReason?: string }
interface ModerationEvidence {
  source: 'snapshot' | 'live_post' | 'unavailable';
  body: string | null; structured: Record<string, string> | null; media: EvidenceMedia[];
  authorName: string | null; authorActorId: string | null;
  publishedAt: string | null; capturedAt: string | null;
  contentType: 'network_post' | 'network_actor'; contentId: string | null;
  liveStatus: 'unchanged' | 'edited' | 'author_deleted' | 'moderation_removed' | 'gone';
  liveBody: string | null; unavailableReason: string | null;
}
interface ModerationCase {
  snapshot: ContentSnapshot | null; snapshotId: string | null; capturedAt: string | null;
  postId: string | null; actorId: string | null; actorName: string | null; actorKind: 'founder' | 'investor' | null;
  live: { body: string; createdAt: string; deletedAt: string | null; moderationRemovedAt: string | null } | null;
  activeStrikeCount: number; suspendedAt: string | null;
  strike: { id: string; status: 'active' | 'reversed'; appliedAt: string; contentRemoved: boolean } | null;
  relatedTicketIds: string[];
  evidence: ModerationEvidence;
}

const EVIDENCE_SOURCE_LABEL: Record<ModerationEvidence['source'], string> = {
  snapshot: 'Content as reported',
  live_post: 'Reported content (resolved live — this report predates snapshots)',
  unavailable: 'Reported content',
};
const LIVE_STATUS_NOTE: Record<ModerationEvidence['liveStatus'], string | null> = {
  unchanged: 'The live post is unchanged since the report.',
  edited: null, // rendered as its own block, with the current text
  author_deleted: 'The author has since deleted this post. The content above is the preserved evidence.',
  moderation_removed: 'Removed from My Network by moderation. The content above is the preserved evidence.',
  gone: 'The post no longer exists.',
};

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const STATUS_LABEL: Record<string, string> = { new: 'New', open: 'Open', waiting_user: 'Waiting on user', resolved: 'Resolved', closed: 'Closed' };
const CATEGORY_LABEL: Record<string, string> = {
  question: 'Question', problem: 'Problem/bug', billing: 'Billing',
  data_correction: 'Data correction', claim_profile: 'Profile claim', network_content_report: 'My Network report', other: 'Other',
};
const SOURCE_LABEL: Record<string, string> = {
  landing: 'Landing', landing_investors: 'Landing (investors)', founder_app: 'App (founder)', investor_portal: 'Portal (investor)',
};
const KIND_LABEL: Record<string, string> = { note: 'Internal note', reply: 'Reply', status_change: 'Change', email_sent: 'Email sent' };

export default function SupportTicketPage() {
  const { id } = useParams<{ id: string }>();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [moderationCase, setModerationCase] = useState<ModerationCase | null>(null);
  const [alsoRemove, setAlsoRemove] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [reply, setReply] = useState('');
  const [alsoEmail, setAlsoEmail] = useState(false);

  function load() {
    fetch(`/api/backoffice/support/${id}`).then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setTicket(body.ticket); setEvents(body.events); setAttachments(body.attachments ?? []);
      setModerationCase(body.moderationCase ?? null);
    });
  }
  useEffect(load, [id]);

  async function act(body: Record<string, unknown>) {
    setBusy(true); setErr('');
    try {
      const res = await fetch(`/api/backoffice/support/${id}/action`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) { setErr(data.error ?? 'Failed.'); return; }
      setNote(''); setReply(''); setAlsoEmail(false);
      load();
    } finally { setBusy(false); }
  }

  if (err && !ticket) return <p className="text-sm text-[#B00000]">{err}</p>;
  if (!ticket) return <p className="text-sm text-gray-400">Loading…</p>;

  return (
    <div className="max-w-3xl space-y-4">
      <Link href="/backoffice/support" className="text-xs text-[#0E7490] hover:underline">← Customer Support</Link>

      <Card title={ticket.subject}>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
          <span className="font-semibold text-gray-700">{ticket.name}</span> · {ticket.email}
          · {CATEGORY_LABEL[ticket.category] ?? ticket.category} · {SOURCE_LABEL[ticket.source] ?? ticket.source}
          {ticket.area && <> · area: {ticket.area}</>}
          · {ticket.created_at.slice(0, 16).replace('T', ' ')}
        </div>
        <p className="whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm text-gray-800">{ticket.message}</p>
        {/* Prompt 533 §3/§23/§29 — for a My Network report this line used to
            be the ONLY thing shown about the reported content
            ("Screen: network_post:2cfc7718-…"). A UUID is an internal
            reference, not evidence. The content itself is now the card
            below; the id survives only as secondary technical metadata
            there. For every other ticket category this is a genuine screen
            hint and is unchanged. */}
        {ticket.context && ticket.category !== 'network_content_report' && (
          <p className="mt-2 text-xs text-gray-500">Screen: {ticket.context}</p>
        )}
        {attachments.length > 0 && (
          <div className="mt-3">
            <p className="mb-1 text-xs font-medium text-gray-500">Attachments</p>
            <div className="flex flex-wrap gap-2">
              {attachments.map((a) => a.url ? (
                <a key={a.path} href={a.url} target="_blank" rel="noreferrer" className="block">
                  <img src={a.url} alt="Attachment" className="h-20 w-20 rounded-lg border border-gray-200 object-cover" />
                </a>
              ) : a.malwareFlagged ? (
                <span key={a.path} className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-bold text-[#B00000]" title="VirusTotal flagged this file as malicious — withheld from preview.">
                  ⚠ flagged as malware
                </span>
              ) : (
                <span key={a.path} className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-400">Unavailable</span>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="text-xs text-gray-500">Status
            <select value={ticket.status} disabled={busy} onChange={(e) => act({ action: 'status', value: e.target.value })}
              className="ml-1.5 rounded border border-gray-300 px-1.5 py-1 text-xs">
              {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label className="text-xs text-gray-500">Priority
            <select value={ticket.priority} disabled={busy} onChange={(e) => act({ action: 'priority', value: e.target.value })}
              className="ml-1.5 rounded border border-gray-300 px-1.5 py-1 text-xs">
              <option value="low">low</option><option value="normal">normal</option>
              <option value="high">high</option><option value="urgent">urgent</option>
            </select>
          </label>
        </div>
        {err && <p className="mt-2 text-xs text-[#B00000]">{err}</p>}
      </Card>

      {ticket.category === 'network_content_report' && (
        <Card title="Reported content">
          {!moderationCase ? (
            <p className="text-sm text-gray-400">
              Moderation case data activates once migration 0291 is applied. Until then this report carries the reporter&apos;s
              message only.
            </p>
          ) : (
            <div className="space-y-3">
              {/* Author + publication metadata (§16, §40-5/6). The author is
                  the canonical Network post author, never inferred from the
                  reporter. */}
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                <span className="font-semibold text-gray-700">{moderationCase.evidence.authorName ?? moderationCase.actorName ?? 'Unknown author'}</span>
                {moderationCase.actorKind && <span className="rounded bg-gray-100 px-1.5 py-0.5 uppercase tracking-wide text-gray-500">{moderationCase.actorKind}</span>}
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-500">
                  {moderationCase.evidence.contentType === 'network_post' ? 'Network post' : 'Network profile'}
                </span>
                {moderationCase.evidence.publishedAt && <span>Published {fmtDateTime(moderationCase.evidence.publishedAt)}</span>}
                <span className="text-gray-400">·</span>
                <span>{moderationCase.activeStrikeCount} active strike{moderationCase.activeStrikeCount === 1 ? '' : 's'}</span>
                {moderationCase.suspendedAt && (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-[#B00000]">Network banned</span>
                )}
              </div>

              {/* THE CONTENT. This is the whole point of the fix: the
                  moderator reads the reported post here, without leaving the
                  page and without resolving a UUID by hand (§30). */}
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  {EVIDENCE_SOURCE_LABEL[moderationCase.evidence.source]}
                  {moderationCase.evidence.capturedAt && ` · captured ${fmtDateTime(moderationCase.evidence.capturedAt)}`}
                </p>

                {moderationCase.evidence.source === 'unavailable' ? (
                  // §15/§41-17 — truthful, never the UUID dressed up as content.
                  <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    {moderationCase.evidence.unavailableReason}
                  </p>
                ) : (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                    <p className="whitespace-pre-wrap text-sm text-gray-800">
                      {moderationCase.evidence.body || <span className="text-gray-400">(this report is about a profile, not a post — no post body)</span>}
                    </p>
                    {moderationCase.evidence.structured && (
                      <ul className="mt-2 space-y-0.5 border-t border-gray-200 pt-2 text-xs text-gray-600">
                        {Object.entries(moderationCase.evidence.structured).map(([k, v]) => (
                          <li key={k}><span className="font-medium capitalize">{k}:</span> {v}</li>
                        ))}
                      </ul>
                    )}

                    {/* §5/§6/§26 — every media item on the post, in order,
                        with an explicit unavailable tile rather than a broken
                        report when one asset cannot be resolved. My Network
                        posts carry no media today (network_posts is
                        text-only), so this renders nothing; it is here so a
                        post that gains media is moderatable on day one
                        rather than silently text-only in review. */}
                    {moderationCase.evidence.media.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {moderationCase.evidence.media.map((m, i) => (
                          m.url ? (
                            <a key={i} href={m.url} target="_blank" rel="noreferrer" title={m.label ?? 'Open full size'}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={m.url} alt={m.label ?? 'Reported media'}
                                className="h-28 w-28 rounded-lg border border-gray-200 object-cover" />
                            </a>
                          ) : (
                            <span key={i} className="flex h-28 w-28 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 p-2 text-center text-[10px] text-amber-800"
                              title={m.unavailableReason}>
                              Media unavailable
                            </span>
                          )
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* §12/§13 — an edit after the report is shown NEXT TO the
                  evidence, never instead of it. */}
              {moderationCase.evidence.liveStatus === 'edited' && moderationCase.evidence.liveBody !== null && (
                <div>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                    Current version — the author edited this after it was reported
                  </p>
                  <p className="whitespace-pre-wrap rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-gray-800">
                    {moderationCase.evidence.liveBody}
                  </p>
                </div>
              )}
              {LIVE_STATUS_NOTE[moderationCase.evidence.liveStatus] && (
                <p className="text-xs text-gray-400">{LIVE_STATUS_NOTE[moderationCase.evidence.liveStatus]}</p>
              )}

              {/* §3/§28 — the raw reference, demoted to what it actually is. */}
              {moderationCase.evidence.contentId && (
                <p className="text-[10px] text-gray-300">
                  Content type: {moderationCase.evidence.contentType} · Content ID: {moderationCase.evidence.contentId}
                </p>
              )}

              {/* The REPORT itself — reason and timing, for authorized
                  back-office eyes only (§17/§18). This never reaches the
                  reported startup: the startup-facing projection
                  (toStartupStrikeView) is built from an allowlist that has
                  no reporter field to carry. */}
              <div className="rounded-lg border border-gray-100 p-2.5">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Report</p>
                <p className="text-xs text-gray-500">
                  Reported {fmtDateTime(ticket.created_at)}
                  {ticket.category && ` · ${CATEGORY_LABEL[ticket.category] ?? ticket.category}`}
                </p>
                {ticket.message && (
                  <p className="mt-1.5 whitespace-pre-wrap text-sm text-gray-700">{ticket.message}</p>
                )}
                <p className="mt-1 text-[10px] text-gray-300">Reporter details are back-office only and are never shown to the reported startup.</p>
              </div>

              {moderationCase.relatedTicketIds.length > 0 && (
                <p className="text-xs text-gray-500">
                  {moderationCase.relatedTicketIds.length} other report{moderationCase.relatedTicketIds.length === 1 ? '' : 's'} about this same
                  content:{' '}
                  {moderationCase.relatedTicketIds.map((tid, i) => (
                    <span key={tid}>
                      {i > 0 && ', '}
                      <Link href={`/backoffice/support/${tid}`} className="text-[#0E7490] hover:underline">{tid.slice(0, 8)}</Link>
                    </span>
                  ))}
                  . One strike covers the content — applying it here will not double-count.
                </p>
              )}
            </div>
          )}
        </Card>
      )}

      {ticket.category === 'network_content_report' && moderationCase && (
        <Card title="Moderation decision">
          {moderationCase.strike ? (
            <p className="text-sm text-gray-600">
              A strike was already applied for this report on {moderationCase.strike.appliedAt.slice(0, 10)}
              {moderationCase.strike.status === 'reversed' && ' and later reversed'}
              {moderationCase.strike.contentRemoved && '; the post was removed from My Network'}. Manage it in{' '}
              <Link href="/backoffice/startups" className="text-[#0E7490] hover:underline">Startups → Strikes</Link>.
            </p>
          ) : (
            <>
              <p className="text-sm text-gray-600">
                Applying a strike notifies the reported startup, shows them the content, and offers them the appeal — it never
                reveals who reported it or why. 3 active strikes suspends My Network access (not the SherlockDeal account).
              </p>
              <label className="mt-2 flex items-center gap-2 text-xs text-gray-600">
                <input type="checkbox" checked={alsoRemove} disabled={!moderationCase.postId}
                  onChange={(e) => setAlsoRemove(e.target.checked)} />
                Also remove the post from My Network
                {!moderationCase.postId && <span className="text-gray-400">(this report is not about a specific post)</span>}
              </label>
              <div className="mt-3 flex flex-wrap gap-2">
                <button disabled={busy} onClick={() => act({ action: 'strike', removeContent: alsoRemove && !!moderationCase.postId })}
                  className="rounded-lg bg-[#B00000] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
                  Apply strike{alsoRemove && moderationCase.postId ? ' and remove post' : ''}
                </button>
                {moderationCase.postId && !moderationCase.live?.moderationRemovedAt && (
                  <button disabled={busy} onClick={() => act({ action: 'remove_content' })}
                    className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-[#B00000] hover:bg-red-50 disabled:opacity-40">
                    Remove post only
                  </button>
                )}
                <button disabled={busy} onClick={() => act({ action: 'dismiss_report' })}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40">
                  No violation — dismiss
                </button>
              </div>
              <p className="mt-2 text-[11px] text-gray-400">
                Removing a post hides it from every My Network feed server-side. The moderation record and the snapshot above
                survive the removal.
              </p>
            </>
          )}
        </Card>
      )}

      <Card title="Timeline">
        {events.length === 0 ? <p className="text-sm text-gray-400">No events yet.</p> : (
          <ul className="space-y-2">
            {events.map((e) => (
              <li key={e.id} className="rounded-lg border border-gray-100 p-2 text-sm">
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <span className="rounded-full bg-gray-100 px-1.5 py-0.5 font-semibold text-gray-600">{KIND_LABEL[e.kind] ?? e.kind}</span>
                  <span>{e.author}</span>
                  <span className="ml-auto">{e.created_at.slice(0, 16).replace('T', ' ')}</span>
                </div>
                {e.body && <p className="mt-1 whitespace-pre-wrap text-gray-700">{e.body}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Internal note">
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
          placeholder="Only visible in the back-office…" className="w-full rounded-lg border border-gray-300 p-2 text-sm" />
        <button disabled={busy || !note.trim()} onClick={() => act({ action: 'note', body: note })}
          className="mt-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-40">
          Add note
        </button>
      </Card>

      <Card title="Reply">
        <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={4}
          placeholder={`Reply to ${ticket.name}…`} className="w-full rounded-lg border border-gray-300 p-2 text-sm" />
        <label className="mt-2 flex items-center gap-2 text-xs text-gray-500">
          <input type="checkbox" checked={alsoEmail} onChange={(e) => setAlsoEmail(e.target.checked)} />
          Also send by email
        </label>
        <button disabled={busy || !reply.trim()} onClick={() => act({ action: 'reply', body: reply, alsoEmail })}
          className="mt-2 rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
          {alsoEmail ? 'Reply and send email' : 'Save reply'}
        </button>
      </Card>
    </div>
  );
}

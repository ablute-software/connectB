'use client';
// Prompt 611 §F — inside an investor firm's account.
//
// Read-only by construction, not by a flag: nothing on this page posts
// anywhere except the exit route. That is also why it does not reuse the
// startup viewer's write-blocking frame — there is no shell being swapped
// underneath it and no cookie redirecting anyone's queries; see
// developer-viewer.ts's note on why assertNotViewer is deliberately not
// extended to this session.
//
// The banner is permanent and says whose account this is, for the same reason
// the startup viewer's is: an operator who forgets where they are is the whole
// risk. Leaving writes the duration, so the audit line can answer "for how
// long" the way it does for a startup.
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card } from '@/components/ui';

interface Member { id: string; email: string | null; status: string; role: string | null; domainVerified: boolean; createdAt: string }
interface PipelineRow { id: string; orgName: string; admittedAt: string }
interface WatchRow { id: string; orgName: string; status: string; requestedAt: string; decidedAt: string | null; lastSeenAt: string | null }
interface DecisionRow { id: string; orgName: string; decision: string; reasonDetail: string | null; decidedAt: string; accessRevokedCount: number | null }
interface InterestRow { id: string; orgName: string; level: string; status: string; requestedAt: string; decidedAt: string | null; note: string | null }
interface TaskRow { id: string; ownerEmail: string; title: string; kind: string | null; orgName: string | null; dueAt: string | null; done: boolean }
interface Payload {
  firm: { id: string; name: string; website: string | null; country: string | null };
  members: Member[]; pipeline: PipelineRow[]; watchlist: WatchRow[];
  decisions: DecisionRow[]; interest: InterestRow[]; tasks: TaskRow[];
}

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

export default function InvestorViewerPage() {
  const { entityId } = useParams<{ entityId: string }>();
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState('');
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    fetch(`/api/backoffice/investor-viewer/${entityId}`).then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setData(body);
    }).catch(() => setErr('Failed to load.'));
  }, [entityId]);

  const leave = useCallback(async () => {
    setLeaving(true);
    await fetch('/api/backoffice/viewer/exit-investor', { method: 'POST' }).catch(() => {});
    router.push('/backoffice/investors');
  }, [router]);

  // A session left open by closing the tab would otherwise never get its
  // duration written — the same hole Prompt 598 found on the startup side.
  // keepalive, because the request has to outlive the document.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') {
        fetch('/api/backoffice/viewer/exit-investor', { method: 'POST', keepalive: true }).catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, []);

  if (err) return <Card title="Investor firm"><p className="text-sm text-[#B00000]">{err}</p></Card>;
  if (!data) return <Card title="Investor firm"><p className="text-sm text-gray-400">Loading…</p></Card>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-orange-900">Inside {data.firm.name}</div>
          <div className="text-xs text-orange-800">
            Read-only. This visit is logged with your reason and its duration, in the same audit trail as a startup workspace.
          </div>
        </div>
        <button onClick={leave} disabled={leaving}
          className="ml-auto rounded-lg bg-orange-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-800 disabled:opacity-40">
          {leaving ? 'Leaving…' : 'Leave'}
        </button>
      </div>

      <Card title={`Seats (${data.members.length})`}>
        {data.members.length === 0 ? <p className="text-sm text-gray-400">No members.</p> : (
          <ul className="divide-y divide-gray-100 text-sm">
            {data.members.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2 py-1.5">
                <span className="font-medium">{m.email ?? '(no email on the account)'}</span>
                {m.role && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600">{m.role}</span>}
                <span className="text-xs text-gray-400">{m.status}{m.domainVerified ? ' · domain verified' : ''}</span>
                <span className="ml-auto text-xs text-gray-400">since {m.createdAt.slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={`Pipeline — startups admitted (${data.pipeline.length})`}>
        {data.pipeline.length === 0 ? <p className="text-sm text-gray-400">Nothing admitted.</p> : (
          <ul className="divide-y divide-gray-100 text-sm">
            {data.pipeline.map((r) => (
              <li key={r.id} className="flex items-center gap-2 py-1.5">
                <span>{r.orgName}</span>
                <span className="ml-auto text-xs text-gray-400">{fmt(r.admittedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={`Watchlist (${data.watchlist.length})`}>
        {data.watchlist.length === 0 ? <p className="text-sm text-gray-400">Nothing watched.</p> : (
          <ul className="divide-y divide-gray-100 text-sm">
            {data.watchlist.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 py-1.5">
                <span>{r.orgName}</span>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600">{r.status}</span>
                <span className="ml-auto text-xs text-gray-400">requested {fmt(r.requestedAt)}{r.lastSeenAt ? ` · last seen ${fmt(r.lastSeenAt)}` : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={`Relationship decisions (${data.decisions.length})`}>
        {data.decisions.length === 0 ? <p className="text-sm text-gray-400">No decisions.</p> : (
          <ul className="divide-y divide-gray-100 text-sm">
            {data.decisions.map((r) => (
              <li key={r.id} className="py-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span>{r.orgName}</span>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-700">{r.decision}</span>
                  <span className="ml-auto text-xs text-gray-400">{fmt(r.decidedAt)}</span>
                </div>
                {r.reasonDetail && <div className="text-xs text-gray-500">{r.reasonDetail}</div>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={`Interest levels (${data.interest.length})`}>
        {data.interest.length === 0 ? <p className="text-sm text-gray-400">No interest levels.</p> : (
          <ul className="divide-y divide-gray-100 text-sm">
            {data.interest.map((r) => (
              <li key={r.id} className="py-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span>{r.orgName}</span>
                  <span className="rounded-full bg-cyan-50 px-2 py-0.5 text-[10px] font-semibold text-cyan-800">{r.level}</span>
                  <span className="text-xs text-gray-400">{r.status}</span>
                  <span className="ml-auto text-xs text-gray-400">{fmt(r.requestedAt)}</span>
                </div>
                {r.note && <div className="text-xs text-gray-500">{r.note}</div>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* §F — the members' own tasks, inside the firm's view and with the owner
          in front. Without them an operator sees a pipeline with no activity
          and concludes the investor has stopped, which is a wrong diagnosis
          drawn from an incomplete view. */}
      <Card title={`Tasks of the people in this firm (${data.tasks.length})`}>
        <p className="mb-2 text-xs text-gray-500">
          Tasks belong to a PERSON, not to the firm — every line names its owner.
        </p>
        {data.tasks.length === 0 ? (
          <p className="text-sm text-gray-400">No tasks. (The table is empty platform-wide today, so this is an empty table rather than an idle firm.)</p>
        ) : (
          <ul className="divide-y divide-gray-100 text-sm">
            {data.tasks.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 py-1.5">
                <span className="font-medium text-gray-700">{t.ownerEmail}</span>
                <span className={t.done ? 'text-gray-400 line-through' : ''}>{t.title}</span>
                {t.orgName && <span className="text-xs text-gray-400">· {t.orgName}</span>}
                <span className="ml-auto text-xs text-gray-400">{t.dueAt ? `due ${fmt(t.dueAt)}` : 'no due date'}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

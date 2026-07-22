'use client';
// Settings — org, plan (demo toggle), caps, AI Review (paid), demo reset
import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { Card } from '@/components/ui';
import { authEnabled, browserClient } from '@/lib/supabase';

type Invitation = { id: string; email: string; role: string; status: string; created_at: string; expires_at: string };

function TeamCard({ orgId }: { orgId: string }) {
  const [orgRole, setOrgRole] = useState<string | null>(null);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [link, setLink] = useState('');
  const [emailed, setEmailed] = useState(false);
  const [err, setErr] = useState('');

  function refresh() {
    browserClient().from('org_invitations').select('*').eq('org_id', orgId)
      .order('created_at', { ascending: false }).then(({ data }) => setInvitations((data as Invitation[]) ?? []));
  }

  useEffect(() => {
    fetch('/api/me').then((r) => r.json()).then((me) => setOrgRole(me.orgRole ?? null));
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  async function sendInvite() {
    setErr(''); setLink(''); setEmailed(false);
    const { data, error } = await browserClient().from('org_invitations')
      .insert({ org_id: orgId, email, role }).select('token').single();
    if (error) { setErr(error.message); return; }
    setLink(`${window.location.origin}/invite/${data.token}`);
    setEmail('');
    refresh();
    // Best-effort: sends a real email if RESEND_API_KEY is configured; the
    // copyable link above always works regardless, so a failure here is silent.
    try {
      const res = await fetch('/api/invite/send-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: data.token }),
      });
      const body = await res.json();
      if (body.sent) setEmailed(true);
    } catch { /* keep the copyable link path — nothing to show the user */ }
  }

  async function revoke(id: string) {
    await browserClient().from('org_invitations').update({ status: 'revoked' }).eq('id', id);
    refresh();
  }

  const canInvite = orgRole === 'owner' || orgRole === 'admin';

  return (
    <Card title="Team">
      {canInvite ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="teammate@company.com"
            className="min-w-[220px] flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
          <select value={role} onChange={(e) => setRole(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
            <option value="member">member</option>
            <option value="manager">manager</option>
            <option value="admin">admin</option>
          </select>
          <button disabled={!email} onClick={sendInvite}
            className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
            Create invite
          </button>
        </div>
      ) : (
        <p className="mb-3 text-xs text-gray-400">Only owners/admins can invite teammates.</p>
      )}
      {err && <p className="mb-2 text-xs text-[#B00000]">{err}</p>}
      {link && (
        <div className="mb-4 rounded-lg border border-cyan-200 bg-[#E8F4F8] px-3 py-2 text-xs text-cyan-900">
          {emailed
            ? 'Invite email sent. Link also below in case it lands in spam:'
            : 'Invite link — copy and send by hand (email sending needs RESEND_API_KEY configured):'}
          <div className="mt-1 break-all font-mono">{link}</div>
        </div>
      )}
      {invitations.length === 0 ? <p className="text-sm text-gray-400">No invitations yet.</p> : (
        <ul className="space-y-1.5 text-sm">
          {invitations.map((i) => (
            <li key={i.id} className="flex items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                i.status === 'pending' ? 'bg-amber-50 text-amber-700'
                  : i.status === 'accepted' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                {i.status}
              </span>
              <span className="font-medium">{i.email}</span>
              <span className="text-xs text-gray-400">{i.role}</span>
              {canInvite && i.status === 'pending' && (
                <button onClick={() => revoke(i.id)} className="ml-auto text-xs text-gray-400 hover:text-[#B00000] hover:underline">Revoke</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function PaidFeatureLock({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-6 text-center">
      <p className="text-sm font-medium text-amber-900">🔒 Paid feature</p>
      <p className="mt-1 text-xs text-amber-700">Upgrade to unlock {label}. Billing isn't wired up yet (Phase 7) — ask the platform team to flip your org's plan in the meantime.</p>
    </div>
  );
}

export default function SettingsPage() {
  const { db, resetDemo } = useStore();
  const [draft, setDraft] = useState('');
  const [personId, setPersonId] = useState('');
  const [aiResult, setAiResult] = useState<string>('');
  const [aiLoading, setAiLoading] = useState(false);
  const isPaid = db.org.plan === 'paid';

  const [docKind, setDocKind] = useState<'deck_review' | 'one_pager_review'>('deck_review');
  const [docText, setDocText] = useState('');
  const [docResult, setDocResult] = useState('');
  const [docLoading, setDocLoading] = useState(false);

  const [marketEntityId, setMarketEntityId] = useState('');
  const [marketResult, setMarketResult] = useState('');
  const [marketLoading, setMarketLoading] = useState(false);

  async function reviewDocument() {
    setDocLoading(true); setDocResult('');
    try {
      const res = await fetch('/api/ai-review', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: docKind, draft: docText }),
      });
      const data = await res.json();
      setDocResult(data.review ?? data.error ?? 'No response');
    } catch (e) {
      setDocResult(`Error: ${(e as Error).message}`);
    } finally { setDocLoading(false); }
  }

  async function researchMarket() {
    setMarketLoading(true); setMarketResult('');
    const entity = db.entities.find((e) => e.id === marketEntityId);
    try {
      const res = await fetch('/api/ai-review', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'market_data',
          context: entity ? {
            name: entity.name, type: entity.type, hq: `${entity.hq_city ?? ''} ${entity.hq_country ?? ''}`.trim(),
            sectors: entity.sectors, thesis: entity.thesis, website: entity.website,
          } : undefined,
        }),
      });
      const data = await res.json();
      setMarketResult(data.review ?? data.error ?? 'No response');
    } catch (e) {
      setMarketResult(`Error: ${(e as Error).message}`);
    } finally { setMarketLoading(false); }
  }

  async function reviewMessage() {
    setAiLoading(true); setAiResult('');
    const person = db.people.find((p) => p.id === personId);
    const entity = person && db.entities.find((e) => e.id === person.entity_id);
    try {
      const res = await fetch('/api/ai-review', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'message_review', draft,
          context: person && entity ? {
            person: person.full_name, role: person.role, hook: person.hook,
            kill_words: person.kill_words, watch_outs: person.watch_outs,
            entity: entity.name, thesis: entity.thesis, the_ask: entity.the_ask,
          } : undefined,
        }),
      });
      const data = await res.json();
      setAiResult(data.review ?? data.error ?? 'No response');
    } catch (e) {
      setAiResult(`Error: ${(e as Error).message}`);
    } finally { setAiLoading(false); }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-lg font-bold">Settings</h1>

      <Card title="Organisation">
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <div><dt className="text-xs text-gray-500">Org</dt><dd>{db.org.name}</dd></div>
          <div><dt className="text-xs text-gray-500">Plan</dt><dd className="capitalize">{db.org.plan}</dd></div>
          <div><dt className="text-xs text-gray-500">Sender</dt><dd>{db.org.sender_email}</dd></div>
          <div><dt className="text-xs text-gray-500">BCC (reply record)</dt><dd>{db.org.bcc_email}</dd></div>
          <div><dt className="text-xs text-gray-500">Daily cap</dt><dd>{db.org.daily_cap} outbounds</dd></div>
          <div><dt className="text-xs text-gray-500">Weekly cap</dt><dd>{db.org.weekly_cap} outbounds</dd></div>
        </dl>
        <p className="mt-2 text-xs text-gray-400">
          In production these live on the org record (Supabase) and billing is handled by Stripe.
          Caps are strategic, not technical — a €1.3M seed closes on 15–40 conversations.
        </p>
      </Card>

      {authEnabled && <TeamCard orgId={db.org.id} />}

      <Card title="AI Review — second opinion on a draft (paid feature)">
        <p className="mb-2 text-xs text-gray-500">
          Beyond the mechanical linter: tone, hook strength, investor fit — using the IRM context (thesis, kill words,
          watch-outs) as grounding. Requires <code className="rounded bg-gray-100 px-1">ANTHROPIC_API_KEY</code> in the environment.
          The AI never sends anything and never edits your data — it produces a report; acting on it is yours.
        </p>
        {!isPaid ? <PaidFeatureLock label="AI review" /> : (
          <>
            <select value={personId} onChange={(e) => setPersonId(e.target.value)} className="mb-2 rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option value="">Reviewing for… (person)</option>
              {db.people.map((p) => <option key={p.id} value={p.id}>{p.full_name} — {db.entities.find((e) => e.id === p.entity_id)?.name}</option>)}
            </select>
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={5}
              placeholder="Paste the draft to review…" className="w-full rounded border border-gray-300 p-2 text-sm font-mono" />
            <button disabled={!draft || aiLoading} onClick={reviewMessage}
              className="mt-2 rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
              {aiLoading ? 'Reviewing…' : 'Review with Claude'}
            </button>
            {aiResult && <pre className="mt-3 whitespace-pre-wrap rounded bg-gray-50 border border-gray-200 p-3 text-xs text-gray-700">{aiResult}</pre>}
          </>
        )}
      </Card>

      <Card title="Deck / one-pager review (paid)">
        <p className="mb-2 text-xs text-gray-500">
          Paste the text content (deck speaker notes, one-pager copy) for a per-dimension report: problem clarity,
          traction evidence, number credibility, narrative, design notes if inferable — plus issues with severity
          and top rewrite suggestions. Review only — nothing is edited or sent.
        </p>
        {!isPaid ? <PaidFeatureLock label="deck/one-pager review" /> : (
          <>
            <select value={docKind} onChange={(e) => setDocKind(e.target.value as typeof docKind)}
              className="mb-2 rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option value="deck_review">Deck</option>
              <option value="one_pager_review">One-pager</option>
            </select>
            <textarea value={docText} onChange={(e) => setDocText(e.target.value)} rows={6}
              placeholder="Paste the deck/one-pager text content…" className="w-full rounded border border-gray-300 p-2 text-sm font-mono" />
            <button disabled={!docText || docLoading} onClick={reviewDocument}
              className="mt-2 rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
              {docLoading ? 'Reviewing…' : 'Review with Claude'}
            </button>
            {docResult && <pre className="mt-3 whitespace-pre-wrap rounded bg-gray-50 border border-gray-200 p-3 text-xs text-gray-700">{docResult}</pre>}
          </>
        )}
      </Card>

      <Card title="Market data — investor research (paid)">
        <p className="mb-2 text-xs text-gray-500">
          Researches an investor's thesis, typical cheque, stage, and recent relevant investments. Every item is
          marked "AI-sourced — verify before relying"; the model is instructed to never invent specifics it isn't
          confident about.
        </p>
        {!isPaid ? <PaidFeatureLock label="market data research" /> : (
          <>
            <select value={marketEntityId} onChange={(e) => setMarketEntityId(e.target.value)}
              className="mb-2 rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option value="">Research… (entity)</option>
              {db.entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <button disabled={!marketEntityId || marketLoading} onClick={researchMarket}
              className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
              {marketLoading ? 'Researching…' : 'Research with Claude'}
            </button>
            {marketResult && <pre className="mt-3 whitespace-pre-wrap rounded bg-gray-50 border border-gray-200 p-3 text-xs text-gray-700">{marketResult}</pre>}
          </>
        )}
      </Card>

      <Card title="Demo data">
        <button onClick={() => { if (window.confirm('Reset all demo data to the seeded pipeline?')) resetDemo(); }}
          className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-[#B00000] hover:bg-red-50">
          Reset demo to seed
        </button>
        <p className="mt-2 text-xs text-gray-400">Demo state persists in this browser (localStorage). Connecting Supabase replaces this with the real database.</p>
      </Card>
    </div>
  );
}

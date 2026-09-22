'use client';
// Prompt 706 Bloco C — AI credits: plans (monthly allowance per tier,
// including custom ones an admin can create on the spot) and the action
// registry (per-action cost, whether it warns first, and a kill switch to
// disable one entirely). Same list+create-form shape as the Promo Codes
// screen (the closest existing precedent for "a list of editable named
// records plus a create button" in this backoffice) — two sections here
// since both tables are small and this prompt's own spec treats them as one
// screen ("ecrã de planos e limites").
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';

interface Plan {
  key: string; label: string; monthly_ai_credits: number; is_custom: boolean;
}
interface AiAction {
  key: string; label: string; category: string; credit_cost: number;
  needs_confirmation: boolean; enabled: boolean;
}

function CreatePlanForm({ onCreated }: { onCreated: () => void }) {
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [credits, setCredits] = useState('200');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/backoffice/ai-plans', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: key.trim(), label: label.trim(), monthlyAiCredits: Number(credits) }),
      });
      const body = await res.json();
      if (!body.ok) { setErr(body.error ?? 'Could not create plan.'); return; }
      setKey(''); setLabel(''); setCredits('200');
      onCreated();
    } finally { setBusy(false); }
  }

  return (
    <Card title="New custom plan">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs font-medium text-gray-500">
          Key (used internally — lowercase, no spaces)
          <input value={key} onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
            placeholder="e.g. accelerator_batch_9" autoComplete="off"
            className="mt-1 w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm" />
        </label>
        <label className="text-xs font-medium text-gray-500">
          Label (shown to the org and in this list)
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Accelerator Batch 9" autoComplete="off"
            className="mt-1 w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm" />
        </label>
        <label className="text-xs font-medium text-gray-500">
          Monthly AI credits
          <input type="number" min={0} step={1} value={credits} onChange={(e) => setCredits(e.target.value)} autoComplete="off"
            className="mt-1 w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm" />
        </label>
      </div>
      {err && <p className="mt-2 text-xs text-[#B00000]">{err}</p>}
      <button onClick={submit} disabled={busy || !key.trim() || !label.trim()}
        className="mt-3 rounded-lg bg-[#0E7490] px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40">
        {busy ? 'Creating…' : 'Create custom plan'}
      </button>
    </Card>
  );
}

function PlanRow({ plan, onChanged }: { plan: Plan; onChanged: () => void }) {
  const [credits, setCredits] = useState(String(plan.monthly_ai_credits));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const dirty = credits !== String(plan.monthly_ai_credits);

  async function save() {
    setBusy(true); setErr('');
    try {
      const res = await fetch(`/api/backoffice/ai-plans/${plan.key}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ monthlyAiCredits: Number(credits) }),
      });
      const body = await res.json();
      if (!body.ok) { setErr(body.error ?? 'Could not save.'); return; }
      onChanged();
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!confirm(`Delete the "${plan.label}" plan? Any org still on it must be moved first.`)) return;
    const res = await fetch(`/api/backoffice/ai-plans/${plan.key}`, { method: 'DELETE' });
    const body = await res.json();
    if (!body.ok) { alert(body.error ?? 'Could not delete.'); return; }
    onChanged();
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-100 bg-white px-3 py-2">
      <div className="min-w-[160px]">
        <div className="text-sm font-medium text-gray-900">{plan.label}</div>
        <div className="text-[11px] text-gray-400">{plan.key}{plan.is_custom ? ' · custom' : ' · built-in'}</div>
      </div>
      <label className="ml-auto flex items-center gap-1.5 text-xs text-gray-500">
        Credits/month
        <input type="number" min={0} step={1} value={credits} onChange={(e) => setCredits(e.target.value)} autoComplete="off"
          className="w-24 rounded-lg border border-gray-300 px-2 py-1 text-sm" />
      </label>
      <button onClick={save} disabled={busy || !dirty}
        className="rounded-lg border border-[#0E7490] px-2.5 py-1 text-xs font-medium text-[#0E7490] hover:bg-[#E8F4F8] disabled:opacity-40">
        {busy ? 'Saving…' : 'Save'}
      </button>
      {plan.is_custom && (
        <button onClick={remove} className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs text-[#B00000] hover:bg-red-50">
          Delete
        </button>
      )}
      {err && <p className="w-full text-[11px] text-[#B00000]">{err}</p>}
    </div>
  );
}

function ActionRow({ action, onChanged }: { action: AiAction; onChanged: () => void }) {
  const [cost, setCost] = useState(String(action.credit_cost));
  const [busy, setBusy] = useState(false);
  const dirty = cost !== String(action.credit_cost);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/backoffice/ai-actions/${action.key}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) { alert(data.error ?? 'Could not save.'); return; }
      onChanged();
    } finally { setBusy(false); }
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${action.enabled ? 'border-gray-100 bg-white' : 'border-amber-200 bg-amber-50'}`}>
      <div className="min-w-[220px]">
        <div className="text-sm font-medium text-gray-900">{action.label}</div>
        <div className="text-[11px] text-gray-400">{action.key} · {action.category}{action.needs_confirmation ? ' · warns first' : ''}</div>
      </div>
      <label className="ml-auto flex items-center gap-1.5 text-xs text-gray-500">
        Credits
        <input type="number" min={1} step={1} value={cost} onChange={(e) => setCost(e.target.value)} autoComplete="off"
          className="w-16 rounded-lg border border-gray-300 px-2 py-1 text-sm" />
      </label>
      <button onClick={() => patch({ creditCost: Number(cost) })} disabled={busy || !dirty}
        className="rounded-lg border border-[#0E7490] px-2.5 py-1 text-xs font-medium text-[#0E7490] hover:bg-[#E8F4F8] disabled:opacity-40">
        Save
      </button>
      <label className="flex items-center gap-1.5 text-xs text-gray-500">
        <input type="checkbox" checked={action.needs_confirmation}
          onChange={(e) => patch({ needsConfirmation: e.target.checked })} />
        Warn first
      </label>
      {/* Prompt 706 Bloco C.3 — the kill switch: disable one action entirely
          (e.g. a model started costing too much) with no deploy. */}
      <button onClick={() => patch({ enabled: !action.enabled })} disabled={busy}
        className={`rounded-lg px-2.5 py-1 text-xs font-medium ${action.enabled ? 'border border-gray-300 text-gray-600 hover:bg-gray-50' : 'bg-amber-600 text-white hover:bg-amber-700'}`}>
        {action.enabled ? 'Disable' : 'Re-enable'}
      </button>
    </div>
  );
}

export default function AiPlansPage() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [actions, setActions] = useState<AiAction[] | null>(null);
  const [err, setErr] = useState('');

  function refreshPlans() {
    fetch('/api/backoffice/ai-plans').then((r) => r.json()).then((body) => {
      if (!body.ok) { setErr(body.error ?? 'Could not load plans.'); return; }
      setPlans(body.plans);
    });
  }
  function refreshActions() {
    fetch('/api/backoffice/ai-actions').then((r) => r.json()).then((body) => {
      if (!body.ok) { setErr(body.error ?? 'Could not load actions.'); return; }
      setActions(body.actions);
    });
  }
  useEffect(() => { refreshPlans(); refreshActions(); }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">AI Credits — Plans &amp; Actions</h1>
        <p className="mt-1 text-sm text-gray-500">
          Each plan&apos;s monthly credit allowance, and what every AI action costs — editable here, applied on the very next request, no deploy needed.
        </p>
      </div>

      {err && <p className="text-sm text-[#B00000]">{err}</p>}

      <section className="space-y-3">
        <h2 className="text-sm font-bold text-gray-700">Plans</h2>
        <CreatePlanForm onCreated={refreshPlans} />
        {!plans ? <p className="text-sm text-gray-400">Loading…</p> : (
          <div className="space-y-2">
            {plans.map((p) => <PlanRow key={p.key} plan={p} onChanged={refreshPlans} />)}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-bold text-gray-700">Actions</h2>
        {!actions ? <p className="text-sm text-gray-400">Loading…</p> : (
          <div className="space-y-2">
            {actions.map((a) => <ActionRow key={a.key} action={a} onChanged={refreshActions} />)}
          </div>
        )}
      </section>
    </div>
  );
}

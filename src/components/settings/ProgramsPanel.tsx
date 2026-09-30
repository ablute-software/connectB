'use client';
// Prompt I-01 §C.4 — Founder › Definições › Programas. Every incubator
// relationship of this org: incubator (name/logo/kind), cohort, state,
// "partilhado desde", the level selector (0–2 active; 3–4 visible and
// disabled), what each level includes (v4 §5.1, literal), the public-profile
// switch (D4), "Terminar relação" (D6), the D3 notice, and "Quem consultou".
// The founder decides; every write is a SQL function that checks the caller
// is a member of this org.
import { useCallback, useEffect, useState } from 'react';
import { Card, Toggle } from '@/components/ui';
import {
  ACCESS_LOG_SURFACE_LABEL, ALSO_INVESTS_NOTICE, LEVEL_COMING_SOON_TEXT, RELATIONSHIP_STATUS_LABEL, SHARING_LEVELS,
  endRelationshipConfirmText, incubatorErrorText, incubatorKindLabel, type RelationshipStatus,
} from '@/lib/incubators';
import { DEMO_FOUNDER_PROGRAMS } from '@/lib/incubator-demo';

interface Rel {
  relationship_id: string; incubator_name: string; incubator_logo_url: string | null; incubator_kind: string;
  incubator_also_invests: boolean; cohort_name: string | null; status: RelationshipStatus; sharing_level: number;
  public_badge: boolean; started_at: string; graduated_at: string | null; ended_at: string | null;
  ended_by: 'founder' | 'incubator' | 'platform' | null; end_reason: string | null;
}
interface LogRow { id: string; relationship_id: string; incubator_name: string; member_name: string; surface: string; viewed_at: string }

function fmt(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function post(url: string, body: unknown) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false }));
}

function RelationshipCard({ rel, demo, onChanged }: { rel: Rel; demo: boolean; onChanged: () => void }) {
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const ended = rel.status === 'ended';

  async function run(fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    setBusy(true); setMsg('');
    try {
      const r = await fn();
      if (!r.ok) setMsg(r.message ?? incubatorErrorText(r.error));
      onChanged();
    } finally { setBusy(false); }
  }

  function end() {
    if (!window.confirm(`Terminar a relação com a ${rel.incubator_name}?\n\n${endRelationshipConfirmText(rel.incubator_name)}`)) return;
    const reason = window.prompt('Razão (opcional — a incubadora vê-a):') ?? '';
    run(() => post(`/api/founder/incubator-programs/${rel.relationship_id}/end`, { reason }));
  }

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm" data-testid="program-card">
      <div className="flex flex-wrap items-center gap-3">
        {rel.incubator_logo_url
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={rel.incubator_logo_url} alt="" className="h-10 w-10 rounded-lg object-contain" />
          : <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#E8F4F8] font-bold text-[#0E7490]">{rel.incubator_name.slice(0, 1).toUpperCase()}</div>}
        <div>
          <div className="text-sm font-semibold text-gray-900">{rel.incubator_name}</div>
          <div className="text-xs text-gray-500">{incubatorKindLabel(rel.incubator_kind)}{rel.cohort_name ? ` · ${rel.cohort_name}` : ''}</div>
        </div>
        <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold ${rel.status === 'active' ? 'bg-emerald-50 text-emerald-700' : rel.status === 'ended' ? 'bg-gray-100 text-gray-500' : 'bg-amber-50 text-amber-700'}`}>
          {RELATIONSHIP_STATUS_LABEL[rel.status]}
        </span>
      </div>
      <p className="mt-2 text-xs text-gray-500">Partilhado desde {fmt(rel.started_at)}{rel.graduated_at ? ` · graduada em ${fmt(rel.graduated_at)}` : ''}</p>
      {rel.incubator_also_invests && !ended && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{ALSO_INVESTS_NOTICE}</p>
      )}

      {ended ? (
        <p className="mt-3 text-sm text-gray-600">
          Terminada em {fmt(rel.ended_at)} {rel.ended_by === 'founder' ? 'por ti' : rel.ended_by === 'incubator' ? 'pela incubadora' : 'pela plataforma'}
          {rel.end_reason ? ` — “${rel.end_reason}”` : ''}. A incubadora já não tem acesso.
        </p>
      ) : (
        <>
          <div className="mt-4">
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">O que a {rel.incubator_name} vê</div>
            <div className="space-y-1.5" role="radiogroup" aria-label="Nível de partilha">
              {SHARING_LEVELS.map((l) => {
                const selected = rel.sharing_level === l.level;
                return (
                  <label key={l.level}
                    className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-sm ${selected ? 'border-[#0E7490] bg-[#E8F4F8]' : 'border-gray-100'} ${l.enabled ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
                    <input type="radio" name={`level-${rel.relationship_id}`} className="mt-1" checked={selected}
                      disabled={!l.enabled || busy || demo}
                      onChange={() => run(() => post(`/api/founder/incubator-programs/${rel.relationship_id}/level`, { level: l.level }))} />
                    <span>
                      <span className="font-semibold text-gray-900">{l.label}</span>
                      <span className="ml-1 text-gray-600">{l.includes}</span>
                      {!l.enabled && <span className="mt-0.5 block text-xs text-gray-500">{LEVEL_COMING_SOON_TEXT}</span>}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <Toggle checked={rel.public_badge} label="Visível no meu perfil público"
              onChange={(v) => { if (!demo) run(() => post(`/api/founder/incubator-programs/${rel.relationship_id}/badge`, { value: v })); }} />
            <button className="ml-auto rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
              disabled={busy || demo} onClick={end}>Terminar relação</button>
          </div>
        </>
      )}
      {msg && <p className="mt-2 text-xs text-red-600">{msg}</p>}
    </div>
  );
}

export function ProgramsPanel() {
  const [data, setData] = useState<{ relationships: Rel[]; accessLog: LogRow[]; demo: boolean; available: boolean } | null>(null);

  const load = useCallback(() => {
    fetch('/api/founder/incubator-programs').then((r) => r.json()).then((d) => {
      if (d.demo) setData({ ...(DEMO_FOUNDER_PROGRAMS as unknown as { relationships: Rel[]; accessLog: LogRow[] }), demo: true, available: true });
      else setData({ relationships: d.relationships ?? [], accessLog: d.accessLog ?? [], demo: false, available: d.available !== false });
    }).catch(() => setData({ relationships: [], accessLog: [], demo: false, available: false }));
  }, []);
  useEffect(load, [load]);

  if (!data) return <p className="text-sm text-gray-400">A carregar…</p>;
  return (
    <div className="space-y-4" data-testid="programs-panel">
      <Card title="Programas">
        <p className="text-sm text-gray-600">As incubadoras e aceleradoras com que a tua startup está ligada. Tu decides o que cada uma vê, e podes terminar a relação a qualquer momento.</p>
        {data.demo && <p className="mt-2 text-xs text-amber-700">Modo demo — dados de exemplo, sem gravação.</p>}
      </Card>
      {data.relationships.length === 0 ? (
        <Card><p className="text-sm text-gray-500">Ainda não estás ligado a nenhum programa. Quando uma incubadora te convidar, o convite chega por e-mail e só te liga se aceitares.</p></Card>
      ) : data.relationships.map((r) => <RelationshipCard key={r.relationship_id} rel={r} demo={data.demo} onChanged={load} />)}
      <Card title="Quem consultou">
        {data.accessLog.length === 0 ? (
          <p className="text-sm text-gray-500">Ainda ninguém consultou o que partilhas. Cada consulta de uma incubadora (dossier, declarações, relatórios) aparece aqui, com o gestor, o quê e quando.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-gray-100 text-[11px] uppercase tracking-wide text-gray-400"><th className="py-2 pr-3">Quando</th><th className="pr-3">Incubadora</th><th className="pr-3">Gestor</th><th>O quê</th></tr></thead>
            <tbody>
              {data.accessLog.map((l) => (
                <tr key={l.id} className="border-b border-gray-50">
                  <td className="py-1.5 pr-3 text-gray-600">{fmtTime(l.viewed_at)}</td>
                  <td className="pr-3 text-gray-900">{l.incubator_name}</td>
                  <td className="pr-3 text-gray-600">{l.member_name}</td>
                  <td className="text-gray-600">{ACCESS_LOG_SURFACE_LABEL[l.surface] ?? l.surface}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

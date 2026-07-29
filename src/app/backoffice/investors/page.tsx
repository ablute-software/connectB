'use client';
// Prompt B — "Investors": the internal source of truth about the investor
// base. The public landing quotes rounded-down bands (500+ profiles, 25+
// countries); this page quotes the real numbers, because deciding what to
// build next on a rounded number is how you end up believing your own
// marketing. Read-only — the CRUD lives in Catálogo, linked at the bottom.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui';
import type { DomainMatchVerdict } from '@/lib/investor-domain-match';

type Totals = {
  total: number; verified: number; imported: number; demo: number; backfilled: number;
  withPerson: number; withEmail: number; personPct: number; countries: number;
};
type CountryRow = { country: string; total: number; verified: number };
type PackRow = { id: string; name: string; description: string | null; price_eur: number; active: boolean; items: number };
type DeliveryRow = { orgId: string; orgName: string; total: number; viaPack: number };
type AccessRequest = {
  id: string; created_at: string; email: string; firm_name: string | null; note: string | null;
  status: 'pending' | 'approved' | 'rejected'; contacted_at: string | null; reviewed_at: string | null;
  domainMatch: DomainMatchVerdict;
};

// Anexo B claim-decision matrix, surfaced plainly to the reviewing admin —
// see src/lib/investor-domain-match.ts for the underlying rule.
function DomainMatchBadge({ v }: { v: DomainMatchVerdict }) {
  if (v.kind === 'match') {
    return (
      <span className="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-700">
        ✅ Email domain matches {v.entityDomain} — auto-eligible for V1
      </span>
    );
  }
  const reason =
    v.kind === 'mismatch' ? `Email domain (${v.emailDomain}) does NOT match claimed entity's domain (${v.entityDomain})`
    : v.kind === 'generic_email' ? `Generic email provider (${v.emailDomain}) — never auto-eligible`
    : v.kind === 'no_entity_website' ? `"${v.entityName}" has no website on file — nothing to verify against`
    : v.firmName ? `"${v.firmName}" doesn't match any catalog entity` : 'No firm name given to verify against';
  return (
    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
      ⚠️ {reason} — manual verification required
    </span>
  );
}

// Approving a request grants investor access — it can only be undone by
// manually revoking the resulting access_grants row, so this asks for one
// explicit click of confirmation rather than acting on the first click.
function AccessRequestsQueue() {
  const [requests, setRequests] = useState<AccessRequest[] | null>(null);
  const [err, setErr] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  function refresh() {
    fetch('/api/backoffice/investor-access-requests').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setRequests(body.requests);
    });
  }
  useEffect(refresh, []);

  async function approve(id: string) {
    setBusyId(id); setConfirmingId(null);
    const res = await fetch(`/api/backoffice/investor-access-requests/${id}/approve`, { method: 'POST' });
    const body = await res.json();
    setBusyId(null);
    if (body.ok === false) { setErr(body.error); return; }
    refresh();
  }
  async function reject(id: string) {
    setBusyId(id);
    const res = await fetch(`/api/backoffice/investor-access-requests/${id}/reject`, { method: 'POST' });
    const body = await res.json();
    setBusyId(null);
    if (body.ok === false) { setErr(body.error); return; }
    refresh();
  }

  if (err) return <Card title="Investor access requests"><p className="text-sm text-[#B00000]">{err}</p></Card>;
  if (!requests) return <Card title="Investor access requests"><p className="text-sm text-gray-400">A carregar…</p></Card>;

  const pending = requests.filter((r) => r.status === 'pending');
  const resolved = requests.filter((r) => r.status !== 'pending');

  return (
    <Card title={`Investor access requests (${pending.length} pending)`}>
      <p className="mb-3 text-xs text-gray-500">
        Leads from the public &quot;request access&quot; form. Approving grants the email an
        access_grants row against ablute_&apos;s Data Room — the mechanism resolveRole() checks
        for the investor role, so the requester can then sign in as an investor.
      </p>
      {pending.length === 0 ? <p className="text-sm text-gray-400">No pending requests.</p> : (
        <ul className="mb-4 space-y-2">
          {pending.map((r) => (
            <li key={r.id} className={`rounded-xl border p-3 text-sm ${
              r.domainMatch.kind === 'match' ? 'border-green-200 bg-green-50/40' : 'border-amber-200 bg-amber-50/50'}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{r.email}</span>
                {r.firm_name && <span className="text-gray-500">· {r.firm_name}</span>}
                <span className="text-xs text-gray-400">{r.created_at.slice(0, 10)}</span>
                <div className="ml-auto flex gap-2">
                  {confirmingId === r.id ? (
                    <>
                      <span className="text-xs text-amber-800">Grant investor access?</span>
                      <button disabled={busyId === r.id} onClick={() => approve(r.id)}
                        className="rounded-lg bg-green-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-green-800 disabled:opacity-40">
                        Confirm
                      </button>
                      <button onClick={() => setConfirmingId(null)} className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs">Cancel</button>
                    </>
                  ) : (
                    <>
                      <button disabled={busyId === r.id} onClick={() => setConfirmingId(r.id)}
                        className="rounded-lg bg-green-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-green-800 disabled:opacity-40">
                        Approve
                      </button>
                      <button disabled={busyId === r.id} onClick={() => reject(r.id)}
                        className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                        Reject
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="mt-1.5"><DomainMatchBadge v={r.domainMatch} /></div>
              {r.note && <p className="mt-1 text-xs text-gray-600">{r.note}</p>}
            </li>
          ))}
        </ul>
      )}
      {resolved.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs text-gray-400">{resolved.length} resolved</summary>
          <ul className="mt-2 space-y-1">
            {resolved.map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-xs text-gray-500">
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${r.status === 'approved' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{r.status}</span>
                <span>{r.email}</span>
                {r.reviewed_at && <span className="text-gray-400">{r.reviewed_at.slice(0, 10)}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-2xl font-bold tabular-nums text-[#0E7490]">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-gray-400">{hint}</div>}
    </div>
  );
}

export default function InvestorsPage() {
  const [data, setData] = useState<{
    ok: boolean; error?: string; totals: Totals; byCountry: CountryRow[]; packs: PackRow[]; deliveries: DeliveryRow[];
  } | null>(null);

  useEffect(() => {
    fetch('/api/backoffice/investors').then((r) => r.json()).then(setData).catch(() => setData(null));
  }, []);

  if (!data) return <p className="text-sm text-gray-400">A carregar…</p>;
  if (!data.ok) return <p className="text-sm text-[#B00000]">{data.error}</p>;

  const { totals, byCountry, packs, deliveries } = data;
  const packable = totals.total - totals.demo;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Investors</h1>
        <p className="mt-1 text-sm text-gray-500">
          Números reais do catálogo global. A landing pública mostra bandas arredondadas para
          baixo ({Math.floor(packable / 100) * 100}+ perfis, {Math.floor(totals.countries / 5) * 5}+ países) — aqui é a verdade.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total no catálogo" value={totals.total} hint={`${totals.demo} demo excluídas dos packs`} />
        <Stat label="Verified" value={totals.verified} hint="tem contacto confirmado" />
        <Stat label="Imported" value={totals.imported} hint="por enriquecer" />
        <Stat label="Países" value={totals.countries} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Com pessoa nomeada" value={`${totals.personPct}%`} hint={`${totals.withPerson} de ${packable}`} />
        <Stat label="Com email direto" value={totals.withEmail} />
        <Stat label="Vindas do backfill" value={totals.backfilled} hint="com proveniência" />
        <Stat label="Packs" value={packs.length} />
      </div>

      <AccessRequestsQueue />

      <Card title={`Por país (${byCountry.length})`}>
        <div className="max-h-[420px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white text-left text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="pb-2">País</th>
                <th className="pb-2 text-right">Verified</th>
                <th className="pb-2 text-right">Total</th>
                <th className="pb-2 text-right">%</th>
              </tr>
            </thead>
            <tbody>
              {byCountry.map((c) => (
                <tr key={c.country} className="border-t border-gray-100">
                  <td className="py-1.5 font-medium">{c.country === '—' ? <span className="text-gray-400">sem país</span> : c.country}</td>
                  <td className="py-1.5 text-right tabular-nums">{c.verified}</td>
                  <td className="py-1.5 text-right tabular-nums text-gray-500">{c.total}</td>
                  <td className="py-1.5 text-right tabular-nums text-gray-400">
                    {c.total ? Math.round((c.verified / c.total) * 100) : 0}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title={`Packs (${packs.length})`}>
        <p className="mb-3 text-xs text-gray-500">
          Preço 0 = ainda sem economia de unlock definida (Fase 0). Os packs só incluem entidades verified.
        </p>
        <table className="w-full text-sm">
          <thead className="text-left text-[11px] uppercase tracking-wide text-gray-500">
            <tr><th className="pb-2">Pack</th><th className="pb-2 text-right">Entidades</th><th className="pb-2 text-right">Preço</th></tr>
          </thead>
          <tbody>
            {packs.map((p) => (
              <tr key={p.id} className="border-t border-gray-100">
                <td className="py-1.5">
                  <div className="font-medium">{p.name}</div>
                  {p.description && <div className="text-[11px] text-gray-400">{p.description}</div>}
                </td>
                <td className="py-1.5 text-right tabular-nums">{p.items}</td>
                <td className="py-1.5 text-right tabular-nums text-gray-500">
                  {p.price_eur ? `€${p.price_eur}` : <span className="text-gray-400">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title={`Entregas por org (${deliveries.length})`}>
        <p className="mb-3 text-xs text-gray-500">
          Uma entrega marca uma entidade do catálogo como já colocada no pipeline de uma org —
          é o que impede que um unlock futuro a duplique. As {totals.backfilled} da ablute_ foram
          semeadas pelo backfill (via_pack vazio), porque já lá estavam.
        </p>
        <table className="w-full text-sm">
          <thead className="text-left text-[11px] uppercase tracking-wide text-gray-500">
            <tr><th className="pb-2">Org</th><th className="pb-2 text-right">Entregas</th><th className="pb-2 text-right">Via pack</th></tr>
          </thead>
          <tbody>
            {deliveries.map((d) => (
              <tr key={d.orgId} className="border-t border-gray-100">
                <td className="py-1.5 font-medium">{d.orgName}</td>
                <td className="py-1.5 text-right tabular-nums">{d.total}</td>
                <td className="py-1.5 text-right tabular-nums text-gray-500">{d.viaPack}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <p className="text-sm text-gray-500">
        Para editar, verificar ou fundir entidades:{' '}
        <Link href="/backoffice/catalog" className="font-medium text-[#0E7490] underline">Catálogo →</Link>
      </p>
    </div>
  );
}

'use client';
// Prompt B — "Investors": the internal source of truth about the investor
// base. The public landing quotes rounded-down bands (500+ profiles, 25+
// countries); this page quotes the real numbers, because deciding what to
// build next on a rounded number is how you end up believing your own
// marketing. Read-only — the CRUD lives in Catálogo, linked at the bottom.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui';

type Totals = {
  total: number; verified: number; imported: number; demo: number; backfilled: number;
  withPerson: number; withEmail: number; personPct: number; countries: number;
};
type CountryRow = { country: string; total: number; verified: number };
type PackRow = { id: string; name: string; description: string | null; price_eur: number; active: boolean; items: number };
type DeliveryRow = { orgId: string; orgName: string; total: number; viaPack: number };

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

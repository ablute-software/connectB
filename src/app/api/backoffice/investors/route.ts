// Prompt B — the internal truth about the investor catalogue. The public
// landing shows rounded-down bands (500+, 25+); this route shows the real
// numbers, for the platform team only. Read-only: it counts, it never writes.
//
// Prompt 644 §2.1 — it no longer counts by itself. The seven queries that
// used to live here said one thing and counted another ("Total 763 — 3 demo
// excluded" counted the demo rows; "Verified — confirmed contact" counted
// catalog_status = verified, which since 633 means "delivered to at least
// one org"; "Imported" showed two test leftovers and hid the four developer
// imports). The definitions now live in ONE place, the database function
// catalog_metrics_compute(), which the daily snapshot and the chart read
// too — a card and a curve cannot disagree because they are the same
// function. This route only maps metric names to the shape the page shows.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await admin.rpc('catalog_metrics_compute', { p_day: today });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 200 });

  const m: Record<string, number | null> = {};
  for (const row of (data ?? []) as { metric: string; value: number | string | null }[]) {
    m[row.metric] = row.value === null || row.value === undefined ? null : Number(row.value);
  }
  const n = (k: string) => m[k] ?? 0;

  return NextResponse.json({
    ok: true,
    asOf: today,
    totals: {
      total: n('entities_total'),
      verified: n('entities_verified'),
      imported: n('entities_imported'),
      importedPending: n('entities_imported_pending'),
      confirmedContact: n('entities_confirmed_contact'),
      withPerson: n('entities_with_person'),
      withEmail: n('entities_with_email'),
      backfilled: n('entities_from_backfill'),
      countries: n('entities_countries'),
      enriched: n('entities_enriched'),
      // Share of the catalogue (demo and test rows excluded) with a named
      // person — the number that decides whether an entity is actually
      // actionable for a founder. People, not the key_people text.
      personPct: n('entities_total') > 0 ? Math.round((n('entities_with_person') / n('entities_total')) * 100) : 0,
      peopleTotal: n('people_total'),
      peopleWithHook: n('people_with_hook'),
      peopleHookHuman: n('people_hook_human'),
      contributionsQueue: n('contributions_submitted'),
    },
  });
}

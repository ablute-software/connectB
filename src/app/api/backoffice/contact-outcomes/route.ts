// Prompt 585 §F.9/§G.3 — "métrica no back-office: taxa de resposta com/
// sem hook, por veredicto." One GET assembles the aggregate stats + the
// row list, same shape as every other back-office dossier-style route.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const { data: rowsRaw, error } = await admin.from('contact_outcomes')
    .select(`
      id, channel, sent_at, replied_at, hook_suggestion_id,
      orgs(name), catalog_entities(name), catalog_people(full_name),
      hook_suggestions(verdict)
    `)
    .order('sent_at', { ascending: false }).limit(200);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const rows = (rowsRaw ?? []).map((r) => {
    const org = r.orgs as unknown as { name: string } | { name: string }[] | null;
    const entity = r.catalog_entities as unknown as { name: string } | { name: string }[] | null;
    const person = r.catalog_people as unknown as { full_name: string } | { full_name: string }[] | null;
    const hook = r.hook_suggestions as unknown as { verdict: string } | { verdict: string }[] | null;
    return {
      id: r.id as string, channel: r.channel as string, sentAt: r.sent_at as string, repliedAt: r.replied_at as string | null,
      hasHook: !!r.hook_suggestion_id, hookVerdict: (Array.isArray(hook) ? hook[0] : hook)?.verdict ?? null,
      orgName: (Array.isArray(org) ? org[0] : org)?.name ?? '(unknown org)',
      entityName: (Array.isArray(entity) ? entity[0] : entity)?.name ?? '(unknown fund)',
      personName: (Array.isArray(person) ? person[0] : person)?.full_name ?? null,
    };
  });

  function rate(sent: number, replied: number): number | null { return sent > 0 ? replied / sent : null; }

  const withHook = rows.filter((r) => r.hasHook);
  const withoutHook = rows.filter((r) => !r.hasHook);
  const byVerdict = new Map<string, { sent: number; replied: number }>();
  for (const r of withHook) {
    const key = r.hookVerdict ?? 'unknown';
    const bucket = byVerdict.get(key) ?? { sent: 0, replied: 0 };
    bucket.sent += 1; if (r.repliedAt) bucket.replied += 1;
    byVerdict.set(key, bucket);
  }

  const summary = {
    totalSent: rows.length, totalReplied: rows.filter((r) => r.repliedAt).length,
    responseRate: rate(rows.length, rows.filter((r) => r.repliedAt).length),
    withHookSent: withHook.length, withHookReplied: withHook.filter((r) => r.repliedAt).length,
    withHookResponseRate: rate(withHook.length, withHook.filter((r) => r.repliedAt).length),
    withoutHookSent: withoutHook.length, withoutHookReplied: withoutHook.filter((r) => r.repliedAt).length,
    withoutHookResponseRate: rate(withoutHook.length, withoutHook.filter((r) => r.repliedAt).length),
    byVerdict: Object.fromEntries([...byVerdict.entries()].map(([k, v]) => [k, { ...v, responseRate: rate(v.sent, v.replied) }])),
  };

  return NextResponse.json({ ok: true, summary, rows });
}

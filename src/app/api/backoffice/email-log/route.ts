// Prompt 537 §1(b) — the back-office read side of email_send_log.
//
// Last 100 attempts, newest first, filterable by status, with the provider's
// verbatim text included. Deliberately NOT summarised or classified: the
// whole failure of the previous three weeks was that the raw reason existed
// somewhere unreadable and everything downstream worked from a paraphrase.
import { NextResponse, type NextRequest } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';

const PAGE_SIZE = 100;
const STATUSES = ['sent', 'failed', 'not_configured', 'render_failed'];

export async function GET(req: NextRequest) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const sp = req.nextUrl.searchParams;
  const status = sp.get('status');
  const kind = sp.get('kind');

  let query = admin.from('email_send_log')
    .select('id, org_id, kind, recipient, subject, status, provider_id, provider_error, from_address_used, related_grant_id, created_at')
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE);
  if (status && STATUSES.includes(status)) query = query.eq('status', status);
  if (kind) query = query.eq('kind', kind);

  const { data, error } = await query;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const rows = data ?? [];
  const orgIds = [...new Set(rows.map((r) => r.org_id as string | null).filter(Boolean))] as string[];
  const { data: orgs } = orgIds.length
    ? await admin.from('orgs').select('id, name').in('id', orgIds)
    : { data: [] };
  const orgNameById = new Map((orgs ?? []).map((o) => [o.id as string, o.name as string]));

  return NextResponse.json({
    ok: true,
    rows: rows.map((r) => ({ ...r, org_name: r.org_id ? orgNameById.get(r.org_id as string) ?? null : null })),
    counts: {
      total: rows.length,
      failed: rows.filter((r) => r.status !== 'sent').length,
    },
  });
}

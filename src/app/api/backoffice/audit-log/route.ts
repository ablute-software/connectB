// Prompt 69 Bloco 2 — the redesigned Audit log's data source. Split out of
// /api/backoffice/metrics (which now only returns the stat cards) because
// this needs its own filtering (date range, admin) and pagination — the
// stat cards don't.
import { NextResponse, type NextRequest } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';

const PAGE_SIZE = 20;

function adminLabel(user: { email?: string | null; user_metadata?: Record<string, unknown> } | null | undefined): string {
  if (!user) return 'Unknown admin';
  const fullName = user.user_metadata?.full_name;
  if (typeof fullName === 'string' && fullName.trim()) return fullName.trim();
  return user.email?.split('@')[0] ?? 'Unknown admin';
}

export async function GET(req: NextRequest) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const sp = req.nextUrl.searchParams;
  const from = sp.get('from'); // yyyy-mm-dd, inclusive
  const to = sp.get('to'); // yyyy-mm-dd, inclusive
  const adminUserId = sp.get('adminUserId');
  const offset = Number(sp.get('offset') ?? '0') || 0;

  let query = admin.from('admin_audit_log').select('*', { count: 'exact' }).order('created_at', { ascending: false });
  if (from) query = query.gte('created_at', `${from}T00:00:00.000Z`);
  if (to) query = query.lte('created_at', `${to}T23:59:59.999Z`);
  if (adminUserId) query = query.eq('admin_user_id', adminUserId);
  query = query.range(offset, offset + PAGE_SIZE - 1);

  const [{ data: rows, count, error }, { data: platformAdmins }] = await Promise.all([
    query,
    admin.from('platform_admins').select('user_id'),
  ]);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // Resolve every admin_user_id on this page, plus the full platform_admins
  // roster (for the filter dropdown, so admins with zero logged actions yet
  // still show up as a filter option).
  const idsToResolve = new Set<string>();
  for (const r of rows ?? []) if (r.admin_user_id) idsToResolve.add(r.admin_user_id);
  for (const pa of platformAdmins ?? []) idsToResolve.add(pa.user_id);

  const resolved = await Promise.all([...idsToResolve].map(async (id) => {
    const { data } = await admin.auth.admin.getUserById(id);
    return [id, adminLabel(data?.user)] as const;
  }));
  const nameById = new Map(resolved);

  return NextResponse.json({
    ok: true,
    rows: (rows ?? []).map((r) => ({ ...r, adminName: r.admin_user_id ? nameById.get(r.admin_user_id) ?? 'Unknown admin' : 'System' })),
    hasMore: offset + PAGE_SIZE < (count ?? 0),
    total: count ?? 0,
    admins: (platformAdmins ?? []).map((pa) => ({ id: pa.user_id, label: nameById.get(pa.user_id) ?? 'Unknown admin' })),
  });
}

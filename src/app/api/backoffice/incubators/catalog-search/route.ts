// Prompt I-01 §C.1 — pick the D3 link (the investing arm of the same house)
// from the catalog by name. Only id + name come back: the link exists for the
// founder's notice and nothing else.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';

// Per-user, per-request data: never prerendered (an env-less build would
// otherwise freeze the not-configured answer into a static file).
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;
  const q = new URL(req.url).searchParams.get('q')?.trim() ?? '';
  if (q.length < 2) return NextResponse.json({ ok: true, results: [] });
  const { data, error } = await admin.from('catalog_entities').select('id, name')
    .ilike('name', `%${q.replace(/[%_]/g, '')}%`).order('name').limit(10);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, results: data ?? [] });
}

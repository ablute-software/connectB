// "Claim this profile" — name search over catalog_entities, scoped behind
// a real signed-in session (not exposed on the public /investors landing
// itself) since this is a full-catalog lookup. Excludes is_test and
// non-active-moderation rows — the same absolute blocks POST
// /api/portal/claims enforces, so a search never surfaces a profile that
// couldn't actually be claimed anyway.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { investorEntityClaimsAvailable } from '@/lib/investor-entity-claims-capability';
import { pipelineTestFlagAvailable } from '@/lib/pipeline-test-flag-capability';
import { accountModerationAvailable } from '@/lib/account-moderation-capability';

const RESULT_LIMIT = 20;

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });
  if (!(await investorEntityClaimsAvailable())) return NextResponse.json({ ok: true, entities: [] });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const q = new URL(req.url).searchParams.get('q')?.trim() ?? '';
  if (q.length < 2) return NextResponse.json({ ok: true, entities: [] });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  let query = admin.from('catalog_entities')
    .select('id, name, website, hq_city, hq_country, verification_status, is_test, moderation_status')
    .ilike('name', `%${q}%`).limit(RESULT_LIMIT);
  const { data, error } = await query;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const testFlagAvailable = await pipelineTestFlagAvailable();
  const moderationAvailable = await accountModerationAvailable();
  const entities = (data ?? []).filter((e) => {
    if (testFlagAvailable && (e as { is_test?: boolean }).is_test) return false;
    if (moderationAvailable && (e as { moderation_status?: string }).moderation_status && (e as { moderation_status?: string }).moderation_status !== 'active') return false;
    return true;
  }).map((e) => ({
    id: e.id, name: e.name, website: e.website, hqCity: e.hq_city, hqCountry: e.hq_country,
    verificationStatus: e.verification_status,
  }));

  return NextResponse.json({ ok: true, entities });
}

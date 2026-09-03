// Prompt 412 §B.2 — accepted company claims for one org, for the BARS
// evidence rail's 'claim' candidates. Same safety gate as watch/route.ts's
// own company_claims read: status='accepted' is the ONLY thing that makes
// a claim investor-visible at all (company_claims migration 0176's own
// words: "NADA entra em superfície nenhuma sem status='accepted'") —
// evidence_class is a quality signal, not a visibility gate, so unlike
// watch/route.ts's narrower "what's new" digest this returns every
// accepted claim, not just evidence_class 1-2.
//
// Eligibility: company_claims is STARTUP-owned data (unlike bars_answers/
// investor_case_risks, which are investor-owned and scoped by seat alone)
// — reading it needs the same "is this org even in my Pipeline" gate the
// dossier route itself (`/api/portal/startup/[orgId]/route.ts`) uses via
// getPipelineWaves, reused here rather than a weaker check, since a bare
// curl with a valid session but no relationship to this org must not see
// another startup's claims just because it knows the orgId.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { closedOrgGuard } from '@/lib/org-closed';
import { serverClient } from '@/lib/supabase-server';
import { getPipelineWaves } from '@/lib/investor-pipeline';

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ claims: [] });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const orgId = new URL(req.url).searchParams.get('orgId');
  if (!orgId) return NextResponse.json({ error: 'orgId is required.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  // Prompt 556 §C — a startup whose org is closed is gone, not hidden.
  const closedBlock = await closedOrgGuard(admin, orgId);
  if (closedBlock) return closedBlock;
  const result = await getPipelineWaves(sb, admin, user.id, email);
  const eligible = result.linked && result.waves.some((w) => w.items.some((c) => c.orgId === orgId));
  if (!eligible) return NextResponse.json({ claims: [] });

  const { data } = await admin.from('company_claims').select('id, statement, category, evidence_class')
    .eq('org_id', orgId).eq('status', 'accepted').order('updated_at', { ascending: false });

  return NextResponse.json({ claims: data ?? [] });
}

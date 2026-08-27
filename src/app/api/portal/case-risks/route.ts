// Prompt 411 §D — this investor's own Risk Register for one startup: 14
// fixed categories, GET always returns all 14 (a real row where one
// exists, a synthetic "not assessed" placeholder otherwise — assessed
// defaults false because "unknown != low": not-yet-assessed is its own
// visible state, never silently read as a low-risk rating). Same pattern
// as bars/route.ts and berkus/route.ts: session ->
// resolveActiveInvestorMember -> service-role client -> ownership scope.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resolveActiveInvestorMember } from '@/lib/investor-membership';
import { assertNotViewer } from '@/lib/developer-viewer';
import { parseEvidenceRefs } from '@/lib/bars-scoring';

const RISK_CATEGORIES = [
  'technology', 'product', 'market', 'adoption', 'commercial', 'financial',
  'financing', 'team', 'governance', 'legal_ip', 'regulatory', 'competitive',
  'execution', 'exit_liquidity',
] as const;
type RiskCategory = typeof RISK_CATEGORIES[number];
const RISK_LEVELS = ['low', 'medium', 'high'] as const;
type RiskLevel = typeof RISK_LEVELS[number];

function isCategory(x: unknown): x is RiskCategory {
  return typeof x === 'string' && (RISK_CATEGORIES as readonly string[]).includes(x);
}
function isRiskLevelOrNull(x: unknown): x is RiskLevel | null {
  return x == null || (typeof x === 'string' && (RISK_LEVELS as readonly string[]).includes(x));
}

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const emptyRisks = RISK_CATEGORIES.map((category) => ({
    category, probability: null, impact: null, assessed: false,
    mitigation: null, residual: null, thesis_breaking: false, evidence_refs: [], note: null, updated_at: null,
  }));
  if (!url || !serviceKey) return NextResponse.json({ risks: emptyRisks });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const orgId = new URL(req.url).searchParams.get('orgId');
  if (!orgId) return NextResponse.json({ error: 'orgId is required.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const member = await resolveActiveInvestorMember(admin, user.id);
  if (!member) return NextResponse.json({ risks: emptyRisks });

  const { data: rows } = await admin.from('investor_case_risks')
    .select('category, probability, impact, assessed, mitigation, residual, thesis_breaking, evidence_refs, note, updated_at')
    .eq('investor_member_id', member.id).eq('startup_org_id', orgId);

  const byCategory = new Map((rows ?? []).map((r) => [r.category as RiskCategory, r]));
  const risks = RISK_CATEGORIES.map((category) => byCategory.get(category) ?? {
    category, probability: null, impact: null, assessed: false,
    mitigation: null, residual: null, thesis_breaking: false, evidence_refs: [], note: null, updated_at: null,
  });

  return NextResponse.json({ risks });
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const orgId = typeof body.orgId === 'string' ? body.orgId : null;
  if (!orgId) return NextResponse.json({ ok: false, error: 'orgId is required.' }, { status: 400 });
  if (!isCategory(body.category)) {
    return NextResponse.json({ ok: false, error: `category must be one of ${RISK_CATEGORIES.join(', ')}.` }, { status: 400 });
  }
  if (!isRiskLevelOrNull(body.probability) || !isRiskLevelOrNull(body.impact) || !isRiskLevelOrNull(body.residual)) {
    return NextResponse.json({ ok: false, error: 'probability/impact/residual must be low/medium/high or null.' }, { status: 400 });
  }
  if (typeof body.assessed !== 'boolean') {
    return NextResponse.json({ ok: false, error: 'assessed must be a boolean.' }, { status: 400 });
  }
  const thesisBreaking = body.thesisBreaking === true;
  const mitigation = typeof body.mitigation === 'string' ? body.mitigation : null;
  const note = typeof body.note === 'string' ? body.note : null;
  const evidenceRefs = parseEvidenceRefs(body.evidenceRefs);
  if (evidenceRefs === null) return NextResponse.json({ ok: false, error: 'evidenceRefs is malformed.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const member = await resolveActiveInvestorMember(admin, user.id);
  if (!member) return NextResponse.json({ ok: false, error: 'No investor firm linked to this session.' }, { status: 403 });

  const { error } = await admin.from('investor_case_risks').upsert({
    investor_member_id: member.id, startup_org_id: orgId, category: body.category,
    probability: body.probability, impact: body.impact, assessed: body.assessed,
    mitigation, residual: body.residual, thesis_breaking: thesisBreaking, evidence_refs: evidenceRefs, note,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'investor_member_id,startup_org_id,category' });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

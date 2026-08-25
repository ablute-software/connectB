// Prompt 373 §D — "cost estimated up front, real cost after." There is no
// pre-call token-estimation anywhere in this codebase (confirmed by reading
// every AI-call site before writing this) — the honest estimate available
// is the average of what this SAME purpose has actually cost in the past,
// across the whole platform (an org's own history is usually too thin —
// one click per section — to be a meaningful average on its own). Falls
// back to a disclosed placeholder range when there is no history yet,
// never a fabricated precise number.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { SECTIONS } from '@/lib/market-research-sections';

const FALLBACK_ESTIMATE_EUR = 0.03;

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ estimateEur: FALLBACK_ESTIMATE_EUR, basedOnRuns: 0 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const sectionParam = new URL(req.url).searchParams.get('section');
  const section = sectionParam && (SECTIONS as string[]).includes(sectionParam) ? sectionParam : null;
  if (!section) return NextResponse.json({ error: 'A valid section is required.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data } = await admin.from('ai_call_log').select('cost_eur')
    .eq('purpose', `market_research_${section}`).order('created_at', { ascending: false }).limit(50);
  const costs = ((data ?? []) as { cost_eur: number | null }[]).map((r) => r.cost_eur).filter((c): c is number => c != null);
  if (costs.length === 0) return NextResponse.json({ estimateEur: FALLBACK_ESTIMATE_EUR, basedOnRuns: 0 });

  const avg = costs.reduce((sum, c) => sum + c, 0) / costs.length;
  return NextResponse.json({ estimateEur: avg, basedOnRuns: costs.length });
}

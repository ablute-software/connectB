// Prompt 340 Block A — investor Dashboard tab data. All aggregation lives in
// investor-dashboard.ts (getDashboardData) so this route is a thin
// auth+wiring shell, same split as every other /api/portal/* route.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { getDashboardData } from '@/lib/investor-dashboard';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const data = await getDashboardData(sb, admin, user.id, email);
  return NextResponse.json({ ok: true, ...data });
}

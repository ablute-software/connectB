// Provision a new founder's org + owner membership using the service role.
// Idempotent: if the user already owns an org, it is returned unchanged.
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const { user_id, org_name, email } = await req.json();
  if (!user_id || !org_name) return NextResponse.json({ ok: false, error: 'missing fields' }, { status: 400 });

  const admin = createClient(url, service, { auth: { persistSession: false } });

  const { data: existing } = await admin.from('org_members').select('org_id').eq('user_id', user_id).maybeSingle();
  if (existing) return NextResponse.json({ ok: true, org_id: existing.org_id, already: true });

  const { data: org, error: orgErr } = await admin
    .from('orgs')
    .insert({ name: org_name, sender_email: email })
    .select('id')
    .single();
  if (orgErr) return NextResponse.json({ ok: false, error: orgErr.message }, { status: 500 });

  const { error: memErr } = await admin.from('org_members').insert({ org_id: org.id, user_id, role: 'owner' });
  if (memErr) return NextResponse.json({ ok: false, error: memErr.message }, { status: 500 });

  // Seed default folders so a new founder has a data room to work with immediately.
  const materials = ['Pitch deck', 'Investor deck', 'One-pager', 'Financials'];
  const dataroom = ['00 Index and Summary', '01 Summary and Investment Dossier', '02 Corporate & Governance',
    '03 Financial', '04 Technology, Product and IP', '05 Commercial, Market and Pilot', '06 Team',
    '07 Regulatory and Compliance', '08 Due Diligence (Restricted)'];
  await admin.from('folders').insert([
    ...materials.map((name, i) => ({ org_id: org.id, name, kind: 'materials', position: i + 1 })),
    ...dataroom.map((name, i) => ({ org_id: org.id, name, kind: 'data_room', position: i + 11 })),
  ]);

  return NextResponse.json({ ok: true, org_id: org.id });
}

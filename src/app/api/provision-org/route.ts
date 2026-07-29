// Provision a new founder's org + owner membership using the service role.
// Idempotent: if the user already owns an org, it is returned unchanged.
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isAbluteTeamEmail } from '@/lib/supabase-server';
import { ABLUTE_ORG_ID } from '@/lib/ablute-org';
import { logAdminAction } from '@/lib/audit';

// The platform owner. Signing up with either of these two specific,
// hardcoded addresses links to the real ablute_ org (already seeded) as
// owner AND grants back-office (developer) access — so the owner gets full
// founder + back-office capabilities from a single sign-up.
//
// A LIST, not a single address, deliberately: the project account moved to
// sherlockdeal.com@gmail.com, and with a single constant, signing up as the
// new address would have silently produced an ordinary founder with a fresh
// empty org and no back-office — locking the owner out of the platform
// console with no error to explain why. Both addresses stay valid.
const OWNER_EMAILS = ['ablutecompany@gmail.com', 'sherlockdeal.com@gmail.com'];

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const {
    user_id, org_name,
    website, sector, stage, round_target_eur, country, one_liner,
    full_name, title, phone, linkedin_url,
  } = await req.json();
  if (!user_id || !org_name) return NextResponse.json({ ok: false, error: 'missing fields' }, { status: 400 });
  if (!full_name || !title) return NextResponse.json({ ok: false, error: 'full_name and title/cargo are required' }, { status: 400 });

  const admin = createClient(url, service, { auth: { persistSession: false } });

  // The request body's `email` field is never used for this decision — it's
  // whatever the signup form sent, unverified. The email that actually
  // decides ownership/domain-admin comes from auth.users itself, via the
  // service role, which is also the only place email_confirmed_at lives.
  const { data: authUser } = await admin.auth.admin.getUserById(user_id);
  const email = authUser?.user?.email;
  const emailConfirmed = !!authUser?.user?.email_confirmed_at;

  const isLegacyOwner = typeof email === 'string' && OWNER_EMAILS.includes(email.trim().toLowerCase());
  // Hard requirement (DECISIONS.md): the @ablute.pt domain grant only ever
  // applies once Supabase has confirmed the address — never on the strength
  // of a just-submitted signup form alone. The two legacy OWNER_EMAILS are
  // pre-vetted, hardcoded, known accounts and don't carry this restriction —
  // that's a different, narrower trust decision than "anyone who can receive
  // mail at this whole domain."
  const isAbluteTeam = emailConfirmed && isAbluteTeamEmail(email);
  const isOwner = isLegacyOwner || isAbluteTeam;
  const profileFields = { full_name, title, phone: phone || null, linkedin_url: linkedin_url || null };

  // Owner always gets platform (back-office) access — best effort, never
  // blocks sign-up. Prompt 43/44: this used to swallow a failure silently
  // (`catch { /* ignore */ }`) — a confirmed @ablute.pt teammate could fail
  // to get backoffice access with nothing to show for it. Still never
  // blocks sign-up (the outer flow continues either way — is_platform_admin()
  // also has the domain-based fallback now, see migration 0050), but a
  // failure here is at least visible in admin_audit_log instead of invisible.
  if (isOwner) {
    const { error: adminGrantErr } = await admin.from('platform_admins').upsert({ user_id }, { onConflict: 'user_id' });
    if (adminGrantErr) {
      try {
        await logAdminAction(admin, {
          adminUserId: user_id, action: 'platform_admin_grant_failed', subjectType: 'user',
          subjectId: user_id, detail: { email, error: adminGrantErr.message },
        });
      } catch { /* logging itself must never block sign-up either */ }
    }
  }

  const { data: existing } = await admin.from('org_members').select('org_id').eq('user_id', user_id).maybeSingle();
  if (existing) return NextResponse.json({ ok: true, org_id: existing.org_id, already: true });

  // Owner joins the existing seeded ablute_ org as owner rather than a fresh empty org.
  // Revisited for Phase 2: the owner's own org (ablute_) already has a real 15-entity
  // pipeline — onboarding's startup-detail fields don't apply to them, only their own
  // person profile does. Multi-org platform-admin management is a later concern.
  if (isOwner) {
    const { error: linkErr } = await admin.from('org_members').insert({ org_id: ABLUTE_ORG_ID, user_id, role: 'owner', ...profileFields });
    if (!linkErr) return NextResponse.json({ ok: true, org_id: ABLUTE_ORG_ID, owner: true });
    // If linking failed for any reason, fall through to creating a normal org.
  }

  const { data: org, error: orgErr } = await admin
    .from('orgs')
    .insert({
      name: org_name, sender_email: email,
      website: website || null, sector: sector || null, stage: stage || null,
      round_target_eur: round_target_eur || null, country: country || null, one_liner: one_liner || null,
    })
    .select('id')
    .single();
  if (orgErr) return NextResponse.json({ ok: false, error: orgErr.message }, { status: 500 });

  const { error: memErr } = await admin.from('org_members').insert({ org_id: org.id, user_id, role: 'owner', ...profileFields });
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

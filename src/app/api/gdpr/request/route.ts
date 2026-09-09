// IRM_SPEC §5 / Prompt 616 §B.3 / Prompt 626 §D — public data-subject request
// intake. No auth required: a data-rights request is valid however it arrives,
// and must not depend on the (not yet built) LinkedIn claim flow.
//
// THREE THINGS CHANGED HERE, and the first is the one that mattered.
//
// 1. `.ilike(email)` IS NOT AN EQUALITY TEST. PostgREST's `ilike` takes a
//    PATTERN. `_` is a single-character wildcard and is perfectly legal in the
//    local part of an address, so `a_b@x.com` also matched `aXb@x.com` — the
//    request would attach to a DIFFERENT person's record, and the reviewer
//    would see a name that was never the claimant's. It is the same class of
//    defect Prompt 614 found in `erase_gdpr_person`, at the other end of the
//    same journey. Escaping the pattern is the obvious fix and the wrong one:
//    PostgREST also rewrites `*` to `%` before the SQL is built, and `*` is
//    likewise legal in an address, so no escape survives that rewrite. The fix
//    is to stop asking a pattern operator a question about equality — `.eq()`
//    on the lowercased address. That inherits an assumption the back-office
//    queue already makes (it re-resolves with `.in()` over lowercased
//    addresses), and it flips the failure mode to the safe side: a
//    non-lowercase stored address now yields NO match rather than the WRONG
//    one, and this lookup was always best-effort — it never blocks the
//    request, it only gives the reviewer a starting point.
//
// 2. All four rights, not two. `access` and `object` now exist in the enum
//    (migration 20260909014000), so the form can offer what the public notice
//    promises. Objection under Article 21(2) is absolute for direct marketing:
//    no reason is required, which is why `details` is not mandatory for that
//    kind — demanding a justification for an unconditional right is a way of
//    discouraging it.
//
// 3. The deadline is returned. The person is told the date we are bound to at
//    the moment they submit, instead of "within 30 days" — a number that was
//    both wrong (the period is one calendar month) and unverifiable.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isGdprKind } from '@/lib/gdpr';

const PROFILES = ['catalog_person', 'product_user', 'other'] as const;
type Profile = (typeof PROFILES)[number];

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const { name, email, kind, details, profile } = await req.json() as {
    name?: string; email?: string; kind?: string; details?: string; profile?: string;
  };
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ ok: false, error: 'A valid email is required.' }, { status: 400 });
  }
  if (!isGdprKind(kind)) {
    return NextResponse.json({ ok: false, error: 'Choose what you would like us to do.' }, { status: 400 });
  }
  if (kind !== 'object' && !details?.trim()) {
    return NextResponse.json({ ok: false, error: 'Please describe what you are requesting.' }, { status: 400 });
  }
  const claimantProfile: Profile | null =
    PROFILES.includes(profile as Profile) ? (profile as Profile) : null;

  const normalisedEmail = email.trim().toLowerCase();
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: match } = await admin
    .from('people').select('id').eq('email_verified', normalisedEmail).limit(1).maybeSingle();

  const { data: inserted, error } = await admin.from('gdpr_requests').insert({
    person_id: match?.id ?? null,
    claimant_name: name?.trim() || null,
    claimant_email: normalisedEmail,
    kind,
    details: details?.trim() || null,
    source: 'public_form',
    claimant_profile: claimantProfile,
  }).select('due_at').single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // Deliberately the same response whether or not `match` found anything.
  // Prompt 626 §C: the catalogue must not become an oracle, and "we found you"
  // versus "we did not" is exactly the answer a public name search would have
  // given — reached through a different door.
  return NextResponse.json({ ok: true, dueAt: inserted.due_at });
}

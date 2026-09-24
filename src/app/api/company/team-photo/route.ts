// Prompt 729 §2.1 — upload for a team member's photo (StartupTeamCard.tsx),
// decalcada de /api/matchdeal/photo/route.ts (Prompt 161 D / 305 §A): the
// same real-content validation and virus scan, the same 'data-room' bucket
// and long-lived signed URL — MatchDealDeck/MiniPitchPreviewModal already
// read company_people.photo_url exactly like that, so nothing downstream
// changes. personId is optional: a person being added for the first time
// (StartupTeamCard's "+ Add person" draft) has no row yet, so the caller
// can upload the photo before the person is saved — the URL just sits in
// client draft state, same contract as pasting a URL by hand today.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { validateAndUploadImage, signUploadedImage } from '@/lib/image-upload-server';

export const maxDuration = 30;

const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'No organization.' }, { status: 403 });
  const orgId = member.org_id as string;

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  const personId = form?.get('personId');
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ ok: false, error: 'A file is required.' }, { status: 400 });
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Ownership check — only when a personId was given (an existing row);
  // a brand-new person being added has nothing to own yet, so there is
  // nothing to check beyond the caller already being an org member above.
  if (typeof personId === 'string' && personId) {
    const { data: person } = await admin.from('company_people').select('id').eq('id', personId).eq('org_id', orgId).maybeSingle();
    if (!person) return NextResponse.json({ ok: false, error: 'Not your team member.' }, { status: 403 });
  }

  const outcome = await validateAndUploadImage(admin, file, { maxBytes: MAX_BYTES, pathPrefix: `_team_photos/${orgId}` });
  if (!outcome.ok) return NextResponse.json({ ok: false, error: outcome.error }, { status: outcome.status });

  const signed = await signUploadedImage(admin, outcome.storagePath);
  if (!signed.ok) return NextResponse.json({ ok: false, error: signed.error }, { status: 500 });

  return NextResponse.json({ ok: true, url: signed.url });
}

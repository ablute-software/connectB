// Identity verification Fase A (prompt 63) — backoffice queue combining the
// two things a founder/admin needs to review: a pending catalog_entities
// row an investor added themselves (Bloco 1), and an uploaded verification
// document (Bloco 3). Both approve to the same effect (the entity becomes
// verification_status='verified'), so they share one queue rather than two
// disconnected tabs.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient, resolveRole } from '@/lib/supabase-server';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const role = await resolveRole(user.id, user.email, sb, user.email_confirmed_at);
  if (role !== 'developer') return NextResponse.json({ ok: false, error: 'Platform admin only.' }, { status: 403 });

  const admin = createClient(url, service, { auth: { persistSession: false } });

  const { data: addedEntities } = await admin.from('investor_added_entities')
    .select('id, catalog_entity_id, added_by_email, created_at, catalog_entities(id, name, website, verification_status)')
    .order('created_at', { ascending: false });
  const pendingEntities = (addedEntities ?? []).filter((e) => (e.catalog_entities as unknown as { verification_status: string })?.verification_status === 'pending');

  const { data: documents } = await admin.from('investor_verification_documents')
    .select('id, investor_email, catalog_entity_id, file_name, storage_path, status, created_at, catalog_entities(name)')
    .eq('status', 'pending_review').order('created_at', { ascending: false });

  const documentsWithUrls = await Promise.all((documents ?? []).map(async (d) => {
    const { data: signed } = await admin.storage.from('data-room').createSignedUrl(d.storage_path as string, 300);
    return {
      id: d.id, investorEmail: d.investor_email, catalogEntityId: d.catalog_entity_id, fileName: d.file_name,
      createdAt: d.created_at, entityName: (d.catalog_entities as unknown as { name: string })?.name ?? 'Unknown',
      url: signed?.signedUrl ?? null,
    };
  }));

  return NextResponse.json({
    pendingEntities: pendingEntities.map((e) => ({
      id: e.id, catalogEntityId: e.catalog_entity_id, addedByEmail: e.added_by_email, createdAt: e.created_at,
      entityName: (e.catalog_entities as unknown as { name: string })?.name ?? 'Unknown',
      website: (e.catalog_entities as unknown as { website: string | null })?.website ?? null,
    })),
    documents: documentsWithUrls,
  });
}

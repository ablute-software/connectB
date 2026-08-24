// Prompt 355 §A — the one place that resolves "what is this document's
// CURRENT version row" — documents.storage_path always mirrors the current
// version (0029's own comment), and version numbers only ever increase
// (store-supabase.tsx's addDocumentVersion), so the highest `version` row
// for a document is always the current one. Never join on storage_path —
// a restore can point a NEW version row back at an OLD object, so two rows
// could share the same path.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export async function getCurrentDocumentVersionId(admin: SupabaseClient, documentId: string): Promise<string | null> {
  const { data } = await admin.from('document_versions').select('id')
    .eq('document_id', documentId).order('version', { ascending: false }).limit(1).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

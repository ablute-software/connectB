// Prompt 311 §B — one-off production cleanup, run once against
// wkjcaoqdvhykrfacsylr and kept here for the record (same convention as the
// other scripts/_cleanup_*.mjs one-off fixes in this repo).
//
// Context: documentToAtom (src/lib/company-knowledge.ts) used to
// materialize a company_claims row PER Vault document, purely so ruleG4
// (src/lib/company-gaps.ts) could ask "is there a vault_doc claim in this
// category?". Prompt 311 §A replaced that with a direct read of
// documents/folders (company-knowledge-db.ts's hasAnyVaultDocument) — no
// claim in between, ever again. That leaves every ALREADY-INSERTED
// vault_doc/proposed row orphaned: it answers a question the review queue
// no longer asks, and it isn't a founder decision to keep or reverse (the
// founder never chose to reject it — the row type itself stopped existing
// in the new model). Confirmed by direct SQL before writing this: 66 rows,
// source_kind='vault_doc', status='proposed', category='prova_tecnica', ALL
// in ablute_'s org (bca54499-03c8-469b-a48d-b9f442e44f69) — exactly the
// "To review (68)" bug Nuno reported (68 = 66 of these + 2 real founder_answer
// claims still worth reviewing).
//
// Scope, deliberately narrow (per the prompt's own wording): only
// status='proposed' AND source_kind='vault_doc'. NEVER 'accepted' (a
// founder already decided to keep one — confirmed one such row exists,
// dbl-checked by SQL, left untouched) and NEVER 'rejected' (a founder's own
// past decision, not this cleanup's business). Global — not org-scoped —
// since the same orphaning applies to any other org that ever ran an
// analysis with a Vault document present.
//
// Usage: node scripts/_cleanup_vault_doc_proposed_claims.mjs
//   (requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the
//   environment — this file does not read .env.local itself)
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in environment.');
  process.exit(1);
}
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

async function main() {
  const { data: before, error: beforeErr } = await admin
    .from('company_claims')
    .select('id, org_id')
    .eq('status', 'proposed')
    .eq('source_kind', 'vault_doc');
  if (beforeErr) throw beforeErr;
  console.log(`Found ${before.length} orphaned proposed/vault_doc claim(s) across ${new Set(before.map((r) => r.org_id)).size} org(s).`);
  if (before.length === 0) {
    console.log('Nothing to clean up.');
    return;
  }

  const { error: delErr, count } = await admin
    .from('company_claims')
    .delete({ count: 'exact' })
    .eq('status', 'proposed')
    .eq('source_kind', 'vault_doc');
  if (delErr) throw delErr;
  console.log(`Deleted ${count} row(s).`);

  const { data: after, error: afterErr } = await admin
    .from('company_claims')
    .select('id')
    .eq('status', 'proposed')
    .eq('source_kind', 'vault_doc');
  if (afterErr) throw afterErr;
  console.log(`Remaining proposed/vault_doc rows: ${after.length} (should be 0).`);
}

main().catch((e) => { console.error(e); process.exit(1); });

// Prompt 358 Phase 1.3 — production cleanup of the exact bug the rest of
// this phase fixes going forward: before the routeAnswer/gap_disposition
// fix, choosing a non-informative chip ("Not yet", "No document yet", …)
// with no free text was inserted VERBATIM as a new company_claims row
// (source_kind='founder_answer', status='accepted'). Confirmed by direct
// SQL against production (org bca54499-03c8-469b-a48d-b9f442e44f69,
// ablute_) before writing this — the exact junk statements below are real
// rows from Nuno's own reported broken session, several of them chained
// (a junk claim's own id later becomes ANOTHER gap's source_ref target,
// which is exactly how the "N left" counter climbed while he was
// answering).
//
// Never deletes anything. For each junk claim found:
//   1. Its own status flips to 'rejected' — removed from every rule's
//      'accepted' pool (G1/G3/G4/G7/…) without erasing the row; the AI
//      guess that produced it stays inspectable.
//   2. Its PARENT claim (parsed from source_ref = 'gap:RULE:discriminator'
//      — for G1/G2/G4/G5/G7 the discriminator IS the parent claim's own
//      id) gets gap_disposition set when the junk text maps to a real
//      founder decision ("No document yet" -> 'no_document', "It exists
//      but is not in the Vault yet" -> 'document_pending'). Fillers with
//      no real decision behind them ("Not yet", "yes, there is", "Yes — I
//      will attach it" with nothing actually attached) leave the parent's
//      disposition alone — those gaps stay honestly open until answered
//      for real.
//
// Usage:
//   node scripts/_prompt358_reclassify_gap_junk_claims.mjs --dry-run   # counts only, writes nothing
//   node scripts/_prompt358_reclassify_gap_junk_claims.mjs             # writes
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const envText = readFileSync('.env.local', 'utf8');
const env = Object.fromEntries(envText.split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const dryRun = process.argv.includes('--dry-run');

// Exact-match only (trimmed, case-insensitive) — deliberately conservative:
// anything with real added text (e.g. "Not yet — We signed an NDA but did
// not proceed") is NOT touched, since it carries genuine information
// beyond the filler chip.
const JUNK_TO_DISPOSITION = new Map([
  ['not yet', null],
  ['yes, there is', null],
  ['it exists but is not in the vault yet', 'document_pending'],
  ['no document yet', 'no_document'],
  ['yes — i will attach it', null],
  ['yes - i will attach it', null],
]);

// ALL claims, not just founder_answer — a junk claim's parent (source_ref's
// discriminator) is very often the ORIGINAL claim (roadmap/profile/fact
// sourced), which the first query missed entirely, silently skipping every
// disposition update below.
const { data: allClaims, error } = await admin.from('company_claims')
  .select('id, org_id, category, statement, status, source_ref, source_kind');
if (error) throw error;

const claims = allClaims.filter((c) => c.source_kind === 'founder_answer');
const junk = claims.filter((c) => JUNK_TO_DISPOSITION.has(c.statement.trim().toLowerCase()));
console.log(`Found ${junk.length} junk claim(s) out of ${claims.length} founder_answer claims.`);

for (const c of junk) {
  const disposition = JUNK_TO_DISPOSITION.get(c.statement.trim().toLowerCase());
  const parentId = c.source_ref?.startsWith('gap:') ? c.source_ref.split(':')[2] : null;
  const parent = parentId ? allClaims.find((x) => x.id === parentId) : null;

  console.log(`- ${c.id} [${c.category}] "${c.statement}" -> status=rejected${
    disposition && parent ? `, parent ${parent.id} gap_disposition=${disposition}` : disposition && !parent ? ` (parent ${parentId} not found — skipping disposition)` : ''
  }`);

  if (dryRun) continue;

  const { error: rejectErr } = await admin.from('company_claims').update({ status: 'rejected' }).eq('id', c.id);
  if (rejectErr) throw rejectErr;

  if (disposition && parent) {
    const { error: dispErr } = await admin.from('company_claims').update({ gap_disposition: disposition }).eq('id', parent.id);
    if (dispErr) throw dispErr;
  }
}

console.log(dryRun ? '\nDry run — nothing written. Re-run without --dry-run to apply.' : '\nDone.');

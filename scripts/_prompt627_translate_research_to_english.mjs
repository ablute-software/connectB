// Prompt 627 §6.4 — the hooks written in the wrong language.
//
// The bug itself was fixed in the system prompt (Prompt 280); the DATA never
// was. So there are research rows in Romanian and Portuguese sitting in a
// product whose interface is English throughout, and a founder reading a
// Romanian hook about a Romanian investor learns nothing from it.
//
// TRANSLATION, NOT RE-RESEARCH, and the distinction is the whole point. The
// content was gathered from a read source and validated under Nuno's rule
// (a hook only exists if a source was actually read). Going back to the web
// would re-open a question that is already answered, cost real money, and
// risk replacing a verified fact with a fresher-sounding worse one. This
// script never fetches anything: it hands the model the stored text and asks
// for the same text in English.
//
// FIELDS: hook, intro_path, watch_outs, background — the four §6.4 names.
// Deliberately NOT translated:
//   · kill_words   — phrases that make this person disengage. If a Romanian
//                    investor closes the door on a Romanian phrase, the
//                    Romanian phrase is the fact. Translating it would
//                    destroy it.
//   · email_guess  — an address, not prose.
//   · hook_source  — provenance. §6.4: "Mantém hook_source como está."
//
// The model decides what is already English rather than me deciding by eye:
// it returns is_english and the script skips those rows without a write, so
// a row is only ever touched when the model states it is not in English.
//
//   node scripts/_prompt627_translate_research_to_english.mjs          # dry run
//   node scripts/_prompt627_translate_research_to_english.mjs --apply  # writes
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const APPLY = process.argv.includes('--apply');
const MODEL = 'claude-haiku-4-5';
const FIELDS = ['hook', 'intro_path', 'watch_outs', 'background'];

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const TOOL = {
  name: 'rewrite_in_english',
  description: 'Return the same research notes in English, or state that they are already in English.',
  input_schema: {
    type: 'object',
    properties: {
      detected_language: { type: 'string', description: 'The language the notes are actually written in, in English (e.g. "Romanian", "Portuguese", "English").' },
      is_english: { type: 'boolean', description: 'True if the notes are already written in English and need no change.' },
      hook: { type: ['string', 'null'] },
      intro_path: { type: ['string', 'null'] },
      watch_outs: { type: ['string', 'null'] },
      background: { type: ['string', 'null'] },
    },
    required: ['detected_language', 'is_english'],
  },
};

async function translate(row) {
  const payload = Object.fromEntries(FIELDS.map((f) => [f, row[f] ?? null]));
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      system:
        'You translate research notes about venture-capital investors into English. Translate ONLY — never add a fact, never remove one, never soften or embellish. Keep proper nouns, company names, fund names, currency amounts, dates and quoted speech exactly as they are; a quotation stays a quotation of the same words, translated, not paraphrased. If a field is null, return null for it. If the notes are already in English, set is_english true and return nothing else.',
      messages: [{
        role: 'user',
        content: `Research notes for ${row.full_name}:\n\n${JSON.stringify(payload, null, 2)}`,
      }],
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'rewrite_in_english' },
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  const block = body.content?.find((c) => c.type === 'tool_use');
  if (!block) throw new Error('no tool_use block');
  return { input: block.input, usage: body.usage };
}

const { data: rows, error } = await supabase
  .from('catalog_people_research')
  .select('person_id, hook, intro_path, watch_outs, background, catalog_people(full_name)')
  .not('hook', 'is', null);
if (error) throw new Error(error.message);

const candidates = rows
  .map((r) => ({ ...r, full_name: r.catalog_people?.full_name ?? '(unknown)' }))
  .filter((r) => (r.hook ?? '').trim() !== '');

console.log(`${candidates.length} rows with a hook. ${APPLY ? 'APPLYING' : 'DRY RUN — no writes'}.\n`);

let inTok = 0, outTok = 0, translated = 0, alreadyEnglish = 0;
for (const row of candidates) {
  const { input, usage } = await translate(row);
  inTok += usage?.input_tokens ?? 0;
  outTok += usage?.output_tokens ?? 0;

  if (input.is_english) {
    alreadyEnglish += 1;
    console.log(`  = ${row.full_name}: already English — untouched`);
    continue;
  }

  const patch = {};
  for (const f of FIELDS) {
    // Never blank a field that had content: a translation that came back
    // null is a failed translation, not an instruction to delete the fact.
    if (row[f] && input[f]) patch[f] = input[f];
  }
  if (Object.keys(patch).length === 0) {
    console.log(`  ! ${row.full_name}: ${input.detected_language}, but nothing usable came back — skipped`);
    continue;
  }
  translated += 1;
  console.log(`  → ${row.full_name}: ${input.detected_language} → English (${Object.keys(patch).join(', ')})`);
  console.log(`      was: ${String(row.hook).slice(0, 100)}`);
  console.log(`      now: ${String(patch.hook ?? row.hook).slice(0, 100)}`);

  if (APPLY) {
    // updated_at deliberately left alone: this is a presentation fix, not new
    // research, and bumping it would restart the 90-day staleness clock on
    // work that is exactly as old as it was.
    const { error: upErr } = await supabase
      .from('catalog_people_research').update(patch).eq('person_id', row.person_id);
    if (upErr) console.log(`      WRITE FAILED: ${upErr.message}`);
  }
}

// claude-haiku-4-5, $1.00 / MTok in, $5.00 / MTok out (the worker's own table).
const usd = (inTok / 1e6) * 1.0 + (outTok / 1e6) * 5.0;
console.log(`\n${translated} translated, ${alreadyEnglish} already English.`);
console.log(`tokens: ${inTok} in / ${outTok} out — about $${usd.toFixed(4)}`);
if (!APPLY) console.log('\nDry run. Re-run with --apply to write.');

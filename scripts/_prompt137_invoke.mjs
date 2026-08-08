// Prompt 137 — invoca a Edge Function enrichment-worker manualmente (piloto).
// Autentica com a service role key (Bearer), o mesmo caminho que o pg_cron
// usaria. Uso: node scripts/_prompt137_invoke.mjs [--dryRun] [--layer=1|2] [--maxJobs=N]
import { readFileSync } from 'fs';

const envText = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dryRun');
const layerArg = args.find((a) => a.startsWith('--layer='));
const maxJobsArg = args.find((a) => a.startsWith('--maxJobs='));
const body = { dryRun };
if (layerArg) body.layer = Number(layerArg.split('=')[1]);
if (maxJobsArg) body.maxJobs = Number(maxJobsArg.split('=')[1]);

const url = `${env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/enrichment-worker`;
console.log(`POST ${url}`, JSON.stringify(body));

const res = await fetch(url, {
  method: 'POST',
  headers: { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
const text = await res.text();
console.log(`Status: ${res.status}`);
try {
  console.log(JSON.stringify(JSON.parse(text), null, 2));
} catch {
  console.log(text);
}

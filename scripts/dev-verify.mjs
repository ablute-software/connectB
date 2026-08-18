#!/usr/bin/env node
// Prompt 250 — Layer 1.1. `npm run dev:verify` forces the Next dev server
// into demo mode REGARDLESS of what .env.local contains on disk, so a
// verification session can never write through a live Supabase connection
// just because someone forgot the manual "disable .env.local, remember to
// restore it after" ritual — that has already failed once, in a different
// session, purely from being memory-dependent instead of enforced. `npm
// run dev` (real Supabase, for actual feature work) is untouched.
//
// How: the three Supabase env vars are overridden to '' in the CHILD
// process's own env, before `next dev` ever starts. @next/env (Next's
// .env loader, same rule dotenv itself follows) never overwrites a key
// that's already present in process.env when it reads .env.local — so
// these three empty values win over whatever's on disk without touching
// the file at all. An empty string is treated exactly like unset by every
// gate that matters: `authEnabled` (src/lib/supabase.ts) is
// `!!SUPABASE_URL && !!SUPABASE_ANON`, and every server route checks
// `if (!url || !serviceKey)` — both are false for ''. Confirmed by reading
// both before relying on this, and empirically by starting the server this
// way and checking /api/me returns authEnabled: false even with real
// credentials present in .env.local.
import { spawn } from 'node:child_process';

const FORCED_DEMO_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: '',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
  SUPABASE_SERVICE_ROLE_KEY: '',
};

console.log('[dev:verify] Demo mode forced — Supabase env vars overridden regardless of .env.local. Ctrl+C to stop.');

// shell: true is required on Windows to resolve npx's .cmd shim (spawning
// it directly throws EINVAL on this Node version) — but shell:true PLUS an
// args array trips Node's DEP0190 warning (ambiguous escaping if those args
// were ever untrusted). Ours never are (`next dev`, a fixed literal), so
// the args are pre-joined into the single command string below instead of
// passed as an array, which sidesteps the warning entirely.
const child = spawn('npx next dev', {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, ...FORCED_DEMO_ENV },
});

child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (err) => { console.error('[dev:verify] failed to start next dev:', err); process.exit(1); });

#!/usr/bin/env node
// `npm run build` = `next build` with a ceiling on the Node heap (Prompt 917, 16/10/2026).
//
// Why: the "Linting and checking validity of types" step of `next build` sits close to the memory of an 8 GB build container. On Vercel the heap has no low
// ceiling, so V8 does not collect until the container is full and the kernel kills the worker (SIGKILL, "Out of Memory" in the build report) — that is what
// stopped the deploy of 3e70e0ac for 20 minutes while the same tree built fine locally. With a ceiling V8 collects before that point. Locally the build passes at
// 2.5 GB and fails at the default; 4 GB leaves headroom on a 8 GB machine. An explicit --max-old-space-size already in NODE_OPTIONS wins (someone tuning it by hand).
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const nextBin = require.resolve('next/dist/bin/next');
const existing = process.env.NODE_OPTIONS ?? '';
const NODE_OPTIONS = /--max-old-space-size/.test(existing) ? existing : `${existing} --max-old-space-size=4096`.trim();

// Prompt 926 (30/10/2026): before anything compiles, say which company logos the landing's strip leaves out and why. A logo without a recorded authorization is only a
// warning (the page never draws it); a row the page cannot trust, or an authorized logo whose image is missing, stops the build — see scripts/check-landing-logos.mjs.
const logos = spawnSync(process.execPath, [fileURLToPath(new URL('./check-landing-logos.mjs', import.meta.url))], { stdio: 'inherit' });
if (logos.status !== 0) { console.error('[build] the landing logo check failed: see the lines above'); process.exit(1); }

const child = spawn(process.execPath, [nextBin, 'build', ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, NODE_OPTIONS } });
child.on('exit', (code, signal) => { if (signal) { console.error(`[build] next build was killed by ${signal}`); process.exit(1); } process.exit(code ?? 1); });

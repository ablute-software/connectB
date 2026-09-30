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
//
// Port + identity (added after two independent verification sessions on
// the same day silently tested the WRONG checkout's code, see CLAUDE.md's
// "Verifying a change in the browser" §1): with no explicit port, `next
// dev` silently falls back to 3001+ whenever 3000 is already taken —
// almost always by a stale `dev:verify` server left running in a DIFFERENT
// worktree/checkout that nobody Ctrl+C'd — while a browser-driving session
// keeps clicking against `localhost:3000` out of habit, believing it's
// exercising its own code when it's actually exercising someone else's. So:
// (1) actually probe for a free port instead of trusting Next's fallback to
// go unnoticed, (2) print one unmistakable identity line naming the real
// URL/cwd/HEAD before a human could plausibly start clicking, and (3) pass
// that same identity into the child process via DEV_VERIFY_IDENTITY so
// /api/me can echo it back — letting a verification session confirm, via
// the app itself, that the tab it's driving is really this checkout.
import { spawn, execSync } from 'node:child_process';
import net from 'node:net';

const FORCED_DEMO_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: '',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
  SUPABASE_SERVICE_ROLE_KEY: '',
};

// Real bind-and-release probe — never trust an env var or a hardcoded
// assumption that a port is free. Starts at 3000 and increments.
function findFreePort(startPort) {
  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      const server = net.createServer();
      server.once('error', (err) => {
        if (err && err.code === 'EADDRINUSE') {
          tryPort(port + 1);
        } else {
          reject(err);
        }
      });
      server.once('listening', () => {
        server.close(() => resolve(port));
      });
      // No explicit host: this must bind the exact same way `next dev`
      // itself will (Next's own default, wildcard/all-interfaces), not a
      // narrower address. Binding this probe to '127.0.0.1' specifically
      // was tried first and is WRONG on Windows: a process already holding
      // the port via a wildcard bind (0.0.0.0 / ::, which is what `next
      // dev` uses) does not make a *subsequent* bind to the literal
      // loopback address fail there the way it does on Linux/macOS — so the
      // probe reported the port "free" while `next dev` then immediately
      // hit EADDRINUSE. Confirmed empirically while building this script:
      // two `dev:verify` runs both announced port 3000 and the second
      // crashed. Binding with no host at all reproduces next dev's own
      // wildcard bind and correctly collides.
      server.listen(port);
    };
    tryPort(startPort);
  });
}

function gitShortShaOrNoGit(cwd) {
  try {
    return execSync('git rev-parse --short HEAD', { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim() || 'no-git';
  } catch {
    return 'no-git';
  }
}

async function main() {
  console.log('[dev:verify] Demo mode forced — Supabase env vars overridden regardless of .env.local. Ctrl+C to stop.');

  const port = await findFreePort(3000);
  const cwd = process.cwd();
  const sha = gitShortShaOrNoGit(cwd);

  // Printed BEFORE the child spawns, so this is on screen well before `next
  // dev` finishes compiling and long before a human (or another session)
  // could plausibly start clicking. Format is fixed — CLAUDE.md tells
  // verification sessions to read the URL from THIS line, never assume
  // :3000 out of habit.
  console.log(`[dev:verify] URL http://localhost:${port} · cwd ${cwd} · HEAD ${sha}`);

  const identity = JSON.stringify({ cwd, sha, port });

  // shell: true is required on Windows to resolve npx's .cmd shim (spawning
  // it directly throws EINVAL on this Node version) — but shell:true PLUS an
  // args array trips Node's DEP0190 warning (ambiguous escaping if those args
  // were ever untrusted). Ours never are (`next dev -p <port>`, a fixed
  // literal plus a number we just computed ourselves), so the args are
  // pre-joined into the single command string below instead of passed as an
  // array, which sidesteps the warning entirely.
  const child = spawn(`npx next dev -p ${port}`, {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ...FORCED_DEMO_ENV, DEV_VERIFY_IDENTITY: identity },
  });

  child.on('exit', (code) => process.exit(code ?? 0));
  child.on('error', (err) => { console.error('[dev:verify] failed to start next dev:', err); process.exit(1); });
}

main().catch((err) => {
  console.error('[dev:verify] failed to start:', err);
  process.exit(1);
});

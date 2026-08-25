// Item #15 — added solely to alias the 'server-only' package (see
// src/test/server-only-stub.ts for why it's otherwise unresolvable under
// vitest). No other vitest defaults are touched or overridden here.
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      'server-only': path.resolve(__dirname, 'src/test/server-only-stub.ts'),
    },
  },
  test: {
    // 25/08/2026 — Claude Code's isolated-worktree agent runs check out
    // full repo copies under .claude/worktrees/*, INSIDE this project
    // directory. Without this exclude, vitest's default glob picks those
    // up too and silently runs every test file 2-3x over (once per stray
    // worktree, on top of the real one) — confirmed live: 208 "test files"
    // reported here for what a clean checkout of the same commit runs as
    // 117. Test counts reported before this fix are unreliable; the real
    // number is whatever a clean checkout (or this exclude) reports.
    exclude: ['**/node_modules/**', '**/.claude/worktrees/**'],
  },
});

// Prompt 918 (Adenda 1) — found by running the real page in a browser (the unit tests did not see it): a client component imported src/lib/calls/branding.ts, which imports upload-security
// (server-only) — the page would not have built. This keeps it from happening again: no file with 'use client' may import a module that pulls in server-only code. The shared constants live in
// media-limits.ts, which anything may import.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = `${process.cwd()}/src`;
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(dir, e.name)] : []));

// Modules that import server-only code, directly or through a chain, and must never reach the browser.
const SERVER_ONLY = [
  '@/lib/calls/branding', '@/lib/calls/branding-profile', '@/lib/calls/applicant/public-media', '@/lib/calls/state', '@/lib/calls/access', '@/lib/calls/store', '@/lib/upload-security',
];

describe('client components do not reach server-only code', () => {
  const clientFiles = walk(`${ROOT}/components`).concat(walk(`${ROOT}/app`).filter((f) => /\.tsx$/.test(f)))
    .filter((f) => /^\s*['"]use client['"]/.test(fs.readFileSync(f, 'utf8').replace(/^(?:\s*\/\/[^\n]*\n)*/, '')) || /^['"]use client['"]/m.test(fs.readFileSync(f, 'utf8').slice(0, 200)));

  it('there are client components to check', () => { expect(clientFiles.length).toBeGreaterThan(50); });

  it('none of them imports the server-only modules of the calls area', () => {
    const offenders: string[] = [];
    for (const f of clientFiles) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of SERVER_ONLY) if (new RegExp(`from ['"]${m.replace(/[/.]/g, (c) => `\\${c}`)}['"]`).test(src)) offenders.push(`${path.relative(ROOT, f)} imports ${m}`);
    }
    expect(offenders).toEqual([]);
  });

  it('the pure modules the General step shares with the server import nothing server-only', () => {
    for (const f of ['lib/calls/media-limits.ts', 'lib/rich-text.ts', 'lib/calls/editor-nav.ts']) {
      const src = fs.readFileSync(`${ROOT}/${f}`, 'utf8');
      const imports = [...src.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
      expect(imports.filter((i) => /server-only|supabase|upload-security|\/store$|\/state$|\/access$/.test(i)), f).toEqual([]);
    }
  });
});

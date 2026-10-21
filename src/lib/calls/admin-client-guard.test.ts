// Prompt 918 (Adenda 2, A) — no file of the Calls code builds its own Supabase client. A client made with a bare createClient(url, key) lets Next's fetch cache answer for it in any route that reads
// no cookie (the public link's pictures, its header, the regulation): the 60-second Storage address was served from the cache after it had expired and every picture of the INNOV-ID page broke
// (20/10/2026). `callsAdminClient` (admin-client.ts) is the one place that forbids the cache, so this fails when a new route goes around it.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = `${process.cwd()}/src`;
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []));

describe('the Calls code builds its Supabase clients in one place', () => {
  const files = [...walk(`${SRC}/lib/calls`), ...walk(`${SRC}/app/api/calls`), ...walk(`${SRC}/app/call`)];
  it('there is Calls code to check', () => { expect(files.length).toBeGreaterThan(60); });

  it('none of it calls createClient( itself — only admin-client.ts does', () => {
    const offenders = files.filter((f) => !f.endsWith(`${path.sep}admin-client.ts`)).filter((f) => /\bcreateClient\s*\(/.test(fs.readFileSync(f, 'utf8').replace(/^\s*\/\/.*$/gm, '')));
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  it('admin-client.ts forces cache: no-store on every request', () => {
    const src = fs.readFileSync(`${SRC}/lib/calls/admin-client.ts`, 'utf8');
    expect(src).toMatch(/cache:\s*'no-store'/);
    expect(src).toMatch(/global:\s*\{\s*fetch:\s*noStoreFetch\s*\}/);
  });
});

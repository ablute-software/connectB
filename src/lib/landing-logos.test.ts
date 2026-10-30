// Prompt 926 (30/10/2026) — the rule that decides which company logos the landing's strip may draw, and the build's warning about the ones it leaves out.
//
// The point of the rule is that a logo on the public landing is a public statement ("this company uses Sherlock Deal"), so it needs the company's authorization on
// record, and that a strip with two or three names does not read as proof. The page enforces it (src/lib/landing-logos.ts, fails closed); the build explains it
// (scripts/check-landing-logos.mjs, plain JavaScript because the build runs on whatever Node Vercel gives it). The two are separate files saying the same thing, so
// every case below goes through both, and the numbers they share are compared. All the logos in this file are invented (zz-test-*): no company is named in a test.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import data from '@/content/site/landing-logos.json';
import * as buildCheck from '../../scripts/check-landing-logos.mjs';
import {
  AUTHORIZATION_FORMS, LOGO_FILE_PATTERN, LOGO_PAGES, LOGO_STRIP_MIN, LOGO_STRIP_WINDOW, authorizationProblem, drawnWidth, isAuthorized, loopCopies, logosForPage,
  parseLogos, stripVisible, type LandingLogo, type LogoStripSizes,
} from './landing-logos';

const ROOT = process.cwd();
const TODAY = new Date('2026-10-30T12:00:00Z');
const granted = (date = '2026-10-29', form: 'email' | 'terms' = 'email') => ({ date, form });
const logo = (n: number, over: Partial<LandingLogo> = {}): LandingLogo => ({
  name: `zz-test-${n}`, file: `zz-test-${n}.svg`, width: 120, height: 40, pages: 'both', order: n, authorization: granted(), ...over,
});
const many = (k: number, over: Partial<LandingLogo> = {}) => Array.from({ length: k }, (_, i) => logo(i + 1, over));

describe('the authorization rule: a logo is shown only with a complete record, and nothing short of one counts', () => {
  const NO_DATE = 'authorization date missing or not a real yyyy-mm-dd date';
  const CASES: Array<[string, unknown, string | null]> = [
    ['"pending"', 'pending', 'authorization pending'],
    ['nothing recorded (undefined)', undefined, 'no authorization recorded'],
    ['null', null, 'no authorization recorded'],
    ['the Portuguese word is not a record either', 'pendente', 'no authorization recorded'],
    ['a number', 1, 'no authorization recorded'],
    ['an empty object', {}, NO_DATE],
    ['an email, yesterday', { date: '2026-10-29', form: 'email' }, null],
    ['accepted terms, today', { date: '2026-10-30', form: 'terms' }, null],
    ['a note saying where the proof is kept is allowed', { date: '2026-10-29', form: 'email', note: 'label of the mailbox folder' }, null],
    ['a day that does not exist', { date: '2026-02-30', form: 'email' }, NO_DATE],
    ['a month that does not exist', { date: '2026-13-01', form: 'email' }, NO_DATE],
    ['a date written the Portuguese way', { date: '29/10/2026', form: 'email' }, NO_DATE],
    ['a date with a time', { date: '2026-10-29T10:00:00Z', form: 'email' }, NO_DATE],
    ['a date that is not a string', { date: 20261029, form: 'email' }, NO_DATE],
    ['tomorrow (an authorization cannot have been given yet)', { date: '2026-10-31', form: 'email' }, 'authorization date is in the future'],
    ['no form', { date: '2026-10-29' }, 'authorization form missing or not one of: email, terms'],
    ['a form that is not allowed', { date: '2026-10-29', form: 'phone' }, 'authorization form missing or not one of: email, terms'],
  ];

  it.each(CASES)('%s', (_name, input, expected) => {
    expect(authorizationProblem(input, TODAY)).toBe(expected);
    expect(isAuthorized({ authorization: input as never }, TODAY)).toBe(expected === null);
    // the build's copy of the rule gives the same answer in the same words
    expect(buildCheck.authorizationProblem(input, TODAY)).toBe(expected);
  });

  it('the allowed forms, the pages and the minimum are the same numbers in the page and in the build\'s check', () => {
    expect([...buildCheck.FORMS]).toEqual([...AUTHORIZATION_FORMS]);
    expect([...buildCheck.PAGES]).toEqual([...LOGO_PAGES]);
    expect(buildCheck.LOGO_STRIP_MIN).toBe(LOGO_STRIP_MIN);
    expect(LOGO_STRIP_MIN).toBe(6); // Prompt 926 §C.3
    expect(buildCheck.FILE_PATTERN.source).toBe(LOGO_FILE_PATTERN.source);
    expect(buildCheck.FILE_PATTERN.flags).toBe(LOGO_FILE_PATTERN.flags);
  });

  it('the authorization is judged by the day it is asked, so one dated tomorrow starts to count tomorrow and not before', () => {
    const a = { authorization: granted('2026-10-31') };
    expect(isAuthorized(a, new Date('2026-10-30T23:59:59Z'))).toBe(false);
    expect(isAuthorized(a, new Date('2026-10-31T00:00:00Z'))).toBe(true);
  });
});

describe('which logos a page may draw', () => {
  it('takes only the authorized ones that are meant for the page, in the order of the file (a tie falls back to the name)', () => {
    const all: LandingLogo[] = [
      logo(1, { name: 'zz-test-b', order: 20 }), logo(2, { name: 'zz-test-a', order: 20 }), logo(3, { order: 10 }),
      logo(4, { pages: 'startups' }), logo(5, { pages: 'investors' }),
      logo(6, { authorization: 'pending' }), logo(7, { authorization: { date: '2026-02-30', form: 'email' } }), logo(8, { authorization: { date: '2026-10-29', form: 'fax' as never } }),
    ];
    // order 4 (startups only), 10, then the two with order 20 by name (a before b); the investors page swaps the startups-only logo for the investors-only one (order 5)
    expect(logosForPage('startups', all, TODAY).map((l) => l.file)).toEqual(['zz-test-4.svg', 'zz-test-3.svg', 'zz-test-2.svg', 'zz-test-1.svg']);
    expect(logosForPage('investors', all, TODAY).map((l) => l.file)).toEqual(['zz-test-5.svg', 'zz-test-3.svg', 'zz-test-2.svg', 'zz-test-1.svg']);
  });

  it('does not reorder or change what it is given', () => {
    const all = [logo(2, { order: 2 }), logo(1, { order: 1 })];
    const copy = JSON.parse(JSON.stringify(all));
    logosForPage('startups', all, TODAY);
    expect(all).toEqual(copy);
  });

  it('a logo without a recorded authorization is not among them, whatever else is true of it', () => {
    for (const authorization of ['pending', undefined, null, {}, { date: '2026-10-29' }, { form: 'email' }] as unknown[]) {
      expect(logosForPage('startups', [logo(1, { authorization: authorization as never })], TODAY)).toEqual([]);
    }
  });
});

describe('the strip needs at least six authorized logos', () => {
  it('five are not enough, six are', () => {
    expect(stripVisible(many(5))).toBe(false);
    expect(stripVisible(many(6))).toBe(true);
    expect(stripVisible(many(7))).toBe(true);
    expect(stripVisible([])).toBe(false);
  });

  it('counts the AUTHORIZED ones: six listed with one still pending is five, and the strip stays away', () => {
    const six = [...many(5), logo(6, { authorization: 'pending' })];
    expect(stripVisible(logosForPage('startups', six, TODAY))).toBe(false);
    expect(stripVisible(logosForPage('startups', [...six, logo(7)], TODAY))).toBe(true);
  });

  it('counts per page: six that are all for the startups page do not light up the investors page', () => {
    const six = many(6, { pages: 'startups' });
    expect(stripVisible(logosForPage('startups', six, TODAY))).toBe(true);
    expect(stripVisible(logosForPage('investors', six, TODAY))).toBe(false);
    expect(stripVisible(logosForPage('investors', [...six, ...many(6).map((l) => ({ ...l, file: `x-${l.file}`, pages: 'both' as const }))], TODAY))).toBe(true);
  });
});

describe('what the file may hold', () => {
  const good = { name: 'zz-test-1', file: 'zz-test-1.svg', width: 120, height: 40, pages: 'both', order: 10, authorization: 'pending' };

  it('keeps a well-formed row, whatever its authorization says (the authorization is judged later, by the rule above)', () => {
    expect(parseLogos([good])).toEqual([good]);
    expect(parseLogos([{ ...good, authorization: granted() }])).toHaveLength(1);
  });

  it.each([
    ['not a list', { ...good }],
    ['a string', 'zz-test'],
  ])('%s -> nothing', (_n, raw) => { expect(parseLogos(raw)).toEqual([]); });

  it.each([
    ['no name', { ...good, name: '' }],
    ['a name that is only spaces', { ...good, name: '   ' }],
    ['a file with a folder in it (it would climb out of /landing/logos/)', { ...good, file: '../secret.svg' }],
    ['a file with a slash', { ...good, file: 'a/b.svg' }],
    ['a file that is not an image type', { ...good, file: 'logo.html' }],
    ['a file starting with a dot', { ...good, file: '.logo.svg' }],
    ['a file with a space', { ...good, file: 'my logo.svg' }],
    ['a width of zero', { ...good, width: 0 }],
    ['a fractional height', { ...good, height: 40.5 }],
    ['a size given as text', { ...good, width: '120' }],
    ['a page that does not exist', { ...good, pages: 'everyone' }],
    ['an order that is not a number', { ...good, order: 'first' }],
    ['null', null],
  ])('drops a row with %s', (_n, row) => {
    expect(parseLogos([row, good])).toEqual([good]);
  });
});

describe('how many copies of the list the loop needs (so it never shows an empty end)', () => {
  const SIZES: LogoStripSizes = { height: 64, gap: 56, maxWidth: 150, heightPhone: 44, gapPhone: 32, maxWidthPhone: 110 };

  it('a logo is drawn at the box height times its own shape, never wider than the largest width', () => {
    expect(drawnWidth({ width: 512, height: 512 }, 64, 150)).toBe(64);
    expect(drawnWidth({ width: 200, height: 40 }, 36, 150)).toBe(150); // 5:1 would be 180: shrunk to the largest width
    expect(drawnWidth({ width: 100, height: 50 }, 36, 150)).toBe(72);
  });

  it('whatever the number and shape of the logos, K-1 copies are wider than the widest window, so the end of the track is never empty', () => {
    const shapes = [{ width: 512, height: 512 }, { width: 200, height: 40 }, { width: 60, height: 60 }, { width: 400, height: 200 }];
    for (const n of [6, 7, 8, 10, 14, 20, 40]) {
      const logos = Array.from({ length: n }, (_, i) => shapes[i % shapes.length]);
      const k = loopCopies(logos, SIZES);
      expect(k).toBeGreaterThanOrEqual(2);
      for (const [h, gap, max] of [[SIZES.height, SIZES.gap, SIZES.maxWidth], [SIZES.heightPhone, SIZES.gapPhone, SIZES.maxWidthPhone]] as const) {
        const list = logos.reduce((sum, l) => sum + drawnWidth(l, h, max) + gap, 0);
        expect((k - 1) * list).toBeGreaterThanOrEqual(LOGO_STRIP_WINDOW);
      }
    }
  });

  it('a short list gets more copies than a long one, and never fewer than two (the second is what scrolls in)', () => {
    const six = many(6);
    const forty = many(40);
    expect(loopCopies(six, SIZES)).toBeGreaterThan(loopCopies(forty, SIZES));
    expect(loopCopies(forty, SIZES)).toBe(2);
  });
});

describe('scripts/check-landing-logos.mjs says the same as the page, in words a person can act on', () => {
  const FOLDER_FILES = (rows: LandingLogo[]) => rows.map((r) => r.file);

  it('a logo with no authorization is a WARNING that names it and the reason, not an error; and it is not counted', () => {
    const rows = [logo(1), logo(2, { authorization: 'pending' }), logo(3, { authorization: { date: '2026-10-31', form: 'email' } })];
    const r = buildCheck.checkLogos(rows, { folderFiles: FOLDER_FILES(rows), today: TODAY });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([
      '"zz-test-2" (zz-test-2.svg) is NOT shown on the landing: authorization pending',
      '"zz-test-3" (zz-test-3.svg) is NOT shown on the landing: authorization date is in the future',
    ]);
    expect(r.authorized).toEqual({ startups: 1, investors: 1 });
  });

  it('counts a logo for the page(s) it is meant for, and says whether each strip is shown, at the same threshold as the page', () => {
    for (const n of [5, 6]) {
      const rows = many(n);
      const r = buildCheck.checkLogos(rows, { folderFiles: FOLDER_FILES(rows), today: TODAY });
      expect(r.summary[0]).toContain(`startups page: ${n} authorized logo(s), 6 needed: the strip is ${n >= LOGO_STRIP_MIN ? 'SHOWN' : 'hidden'}`);
      expect(stripVisible(logosForPage('startups', rows, TODAY))).toBe(n >= LOGO_STRIP_MIN);
    }
    const mixed = [...many(3, { pages: 'startups' }), ...many(3, { pages: 'investors' }).map((l) => ({ ...l, file: `i-${l.file}` })), ...many(2, { pages: 'both' }).map((l) => ({ ...l, file: `b-${l.file}` }))];
    const r = buildCheck.checkLogos(mixed, { folderFiles: FOLDER_FILES(mixed), today: TODAY });
    expect(r.authorized).toEqual({ startups: 5, investors: 5 });
  });

  it('an authorized logo whose image is not in the folder is an ERROR (the page would show a broken picture); a pending one is only one more warning', () => {
    const r = buildCheck.checkLogos([logo(1), logo(2, { authorization: 'pending' })], { folderFiles: [], today: TODAY });
    expect(r.errors).toEqual(['"zz-test-1" (zz-test-1.svg) is authorized but its image is not in public/landing/logos/: the page would show a broken picture']);
    expect(r.warnings).toEqual([
      '"zz-test-2" (zz-test-2.svg) is NOT shown on the landing: authorization pending',
      '"zz-test-2" (zz-test-2.svg): the image is not in public/landing/logos/ either',
    ]);
  });

  it('a row the page cannot trust is an ERROR, and so is the same file listed twice', () => {
    const r = buildCheck.checkLogos([{ ...logo(1), file: '../x.svg' }, { ...logo(2), width: 0 }, { ...logo(3), pages: 'all' }, logo(4), logo(4), 'nonsense'], { folderFiles: ['zz-test-4.svg'], today: TODAY });
    expect(r.errors).toHaveLength(5);
    expect(r.errors[0]).toContain('"zz-test-1" (../x.svg): file must be a plain name');
    expect(r.errors[1]).toContain('width and height must be whole numbers above zero');
    expect(r.errors[2]).toContain('pages must be one of: startups, investors, both');
    expect(r.errors[3]).toContain('the file is listed twice');
    expect(r.errors[4]).toBe('row 6: not an object');
    expect(buildCheck.checkLogos({ not: 'a list' }, { folderFiles: [] }).errors).toEqual(['the file must hold a list of logos ([...])']);
  });

  it('an image in the folder that no row lists is a WARNING: it is not shown', () => {
    const r = buildCheck.checkLogos([logo(1)], { folderFiles: ['zz-test-1.svg', 'zz-test-orphan.png'], today: TODAY });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual(['zz-test-orphan.png is in public/landing/logos/ but no row of the file lists it: it is not shown']);
  });
});

describe('npm run build: the check runs first, as its own process, and its exit code decides', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'landing-logos-'));
  afterAll(() => { rmSync(tmp, { recursive: true, force: true }); });

  const run = (rows: unknown, files: string[]) => {
    const dir = mkdtempSync(join(tmp, 'case-'));
    const folder = join(dir, 'logos');
    mkdirSync(folder);
    for (const f of files) writeFileSync(join(folder, f), '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
    const config = join(dir, 'landing-logos.json');
    writeFileSync(config, typeof rows === 'string' ? rows : JSON.stringify(rows));
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'check-landing-logos.mjs'), '--config', config, '--folder', folder], { encoding: 'utf8' });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };

  it('every logo pending: exit 0, a WARNING line for each, and the strip reported as hidden', () => {
    const rows = many(8).map((l) => ({ ...l, authorization: 'pending' }));
    const r = run(rows, rows.map((l) => l.file));
    expect(r.status).toBe(0);
    expect(r.out.match(/\[landing-logos\] WARNING: .* is NOT shown on the landing: authorization pending/g)).toHaveLength(8);
    expect(r.out).toContain('startups page: 0 authorized logo(s), 6 needed: the strip is hidden');
    expect(r.out).toContain('investors page: 0 authorized logo(s), 6 needed: the strip is hidden');
  });

  it('six authorized logos with their images: exit 0, no warning, both strips SHOWN', () => {
    const rows = many(6);
    const r = run(rows, rows.map((l) => l.file));
    expect(r.status).toBe(0);
    expect(r.out).not.toContain('WARNING');
    expect(r.out).toContain('startups page: 6 authorized logo(s), 6 needed: the strip is SHOWN');
    expect(r.out).toContain('investors page: 6 authorized logo(s), 6 needed: the strip is SHOWN');
  });

  it('an authorized logo without its image: exit 1 and an ERROR line', () => {
    const r = run(many(6), []);
    expect(r.status).toBe(1);
    expect(r.out).toContain('[landing-logos] ERROR: "zz-test-1" (zz-test-1.svg) is authorized but its image is not in public/landing/logos/');
  });

  it('a file that is not JSON: exit 1', () => {
    const r = run('{ not json', []);
    expect(r.status).toBe(1);
    expect(r.out).toContain('[landing-logos] ERROR: cannot read');
  });

  it('has no hashbang line: this test imports the script, and Vite strips a hashbang only when a bare LF follows it, so on a Windows checkout (CRLF) it would not even parse', () => {
    const source = readFileSync(join(ROOT, 'scripts', 'check-landing-logos.mjs'), 'utf8');
    expect(source.startsWith('#!')).toBe(false);
  });

  it('scripts/build.mjs runs it before `next build` starts, stops on its failure, and package.json can run it alone', () => {
    const build = readFileSync(join(ROOT, 'scripts', 'build.mjs'), 'utf8');
    const check = build.indexOf("check-landing-logos.mjs");
    const next = build.indexOf("spawn(process.execPath, [nextBin, 'build'");
    expect(check).toBeGreaterThan(-1);
    expect(next).toBeGreaterThan(check);
    expect(build.slice(check, next)).toMatch(/process\.exit\(1\)/);
    expect(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts['verify:landing-logos']).toBe('node scripts/check-landing-logos.mjs');
  });
});

// The size of an image file, read from the file itself — the same three formats the folder accepts.
function imageSize(name: string, buf: Buffer): { width: number; height: number } {
  if (name.endsWith('.png')) {
    if (buf.subarray(1, 4).toString('latin1') !== 'PNG') throw new Error(`${name} is not a PNG`);
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (name.endsWith('.svg')) {
    const text = buf.toString('utf8');
    const box = /viewBox\s*=\s*"\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/.exec(text);
    if (box) return { width: Math.round(Number(box[1])), height: Math.round(Number(box[2])) };
    const w = /<svg[^>]*\swidth\s*=\s*"([\d.]+)(?:px)?"/.exec(text);
    const h = /<svg[^>]*\sheight\s*=\s*"([\d.]+)(?:px)?"/.exec(text);
    if (w && h) return { width: Math.round(Number(w[1])), height: Math.round(Number(h[1])) };
    throw new Error(`${name} has neither a viewBox nor a width and height`);
  }
  if (name.endsWith('.webp')) {
    if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') throw new Error(`${name} is not a WebP`);
    const kind = buf.toString('latin1', 12, 16);
    if (kind === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8L') { const bits = buf.readUInt32LE(21); return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }; }
    if (kind === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    throw new Error(`${name}: unknown WebP kind ${kind}`);
  }
  throw new Error(`${name}: not a png, svg or webp`);
}

describe('the helper that reads an image\'s size (so the width and height in the file can be checked against the real thing)', () => {
  const png = (w: number, h: number) => { const b = Buffer.alloc(33); Buffer.from('89504e470d0a1a0a', 'hex').copy(b); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
  const webp = (kind: 'VP8 ' | 'VP8L' | 'VP8X', w: number, h: number) => {
    const b = Buffer.alloc(40); b.write('RIFF', 0, 'latin1'); b.write('WEBP', 8, 'latin1'); b.write(kind, 12, 'latin1');
    if (kind === 'VP8 ') { b.writeUInt16LE(w, 26); b.writeUInt16LE(h, 28); }
    if (kind === 'VP8L') b.writeUInt32LE(((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14), 21);
    if (kind === 'VP8X') { b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3); }
    return b;
  };

  it('PNG, WebP (lossy, lossless, extended) and SVG (viewBox first, then width and height)', () => {
    expect(imageSize('a.png', png(512, 300))).toEqual({ width: 512, height: 300 });
    expect(imageSize('a.webp', webp('VP8 ', 200, 80))).toEqual({ width: 200, height: 80 });
    expect(imageSize('a.webp', webp('VP8L', 321, 123))).toEqual({ width: 321, height: 123 });
    expect(imageSize('a.webp', webp('VP8X', 640, 480))).toEqual({ width: 640, height: 480 });
    expect(imageSize('a.svg', Buffer.from('<svg xmlns="x" viewBox="0 0 190 48" width="999" height="999"/>'))).toEqual({ width: 190, height: 48 });
    expect(imageSize('a.svg', Buffer.from('<svg xmlns="x" width="150px" height="44"/>'))).toEqual({ width: 150, height: 44 });
    expect(() => imageSize('a.svg', Buffer.from('<svg xmlns="x"/>'))).toThrow();
    expect(() => imageSize('a.png', Buffer.from('not a png at all, definitely not'))).toThrow();
  });
});

describe('the logos in the repository (src/content/site/landing-logos.json and public/landing/logos/)', () => {
  const folder = join(ROOT, 'public', 'landing', 'logos');
  const rows = data as unknown[];
  const files = readdirSync(folder);

  it('every row is well-formed: none is dropped on the way to the page (the build would have stopped on it too)', () => {
    expect(parseLogos(rows)).toHaveLength(rows.length);
  });

  it('every file and every name appears once', () => {
    const parsed = parseLogos(rows);
    expect(new Set(parsed.map((l) => l.file)).size).toBe(parsed.length);
    expect(new Set(parsed.map((l) => l.name.toLowerCase())).size).toBe(parsed.length);
  });

  it('every row has its image in the folder, with the width and height written in the file', () => {
    for (const l of parseLogos(rows)) {
      expect(files, `${l.file} is not in public/landing/logos/`).toContain(l.file);
      expect(imageSize(l.file, readFileSync(join(folder, l.file))), `${l.file}: width and height in the file are not the image's own`).toEqual({ width: l.width, height: l.height });
    }
  });

  it('every image in the folder has a row (a file nobody lists would be deployed and never shown), and nothing else is in there but the README', () => {
    const listed = new Set(parseLogos(rows).map((l) => l.file));
    for (const f of files) {
      if (f === 'README.md') continue;
      expect(LOGO_FILE_PATTERN.test(f), `${f} is not a logo file (only .svg, .png and .webp with a plain name)`).toBe(true);
      expect(listed.has(f), `${f} is in the folder but no row lists it`).toBe(true);
    }
    expect(files).toContain('README.md');
  });

  it('an authorization is either "pending" or a complete record: no half-written one, none dated in the future', () => {
    for (const l of parseLogos(rows)) {
      if (l.authorization === 'pending') continue;
      expect(authorizationProblem(l.authorization), `${l.file}`).toBeNull();
    }
  });

  it('a note says where the proof is kept, never an address: the repository is public', () => {
    for (const l of parseLogos(rows)) {
      const note = typeof l.authorization === 'object' ? l.authorization.note : undefined;
      if (note === undefined) continue;
      expect(note, `${l.file}`).not.toMatch(/@|https?:\/\/|www\./i);
      expect(note.length, `${l.file}`).toBeLessThanOrEqual(160);
    }
  });

  it('the README says how a logo is taken down', () => {
    const readme = readFileSync(join(folder, 'README.md'), 'utf8');
    expect(readme).toContain('## Retirar um logo');
    expect(readme).toMatch(/apagar a linha/i);
    expect(readme).toContain('fazer deploy');
    expect(readme).toContain('6 ou mais');
  });
});

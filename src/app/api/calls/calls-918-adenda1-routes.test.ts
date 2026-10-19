// Prompt 918, Adenda 1 (C and D) — the cover image and the logo of a call, the entry page's data, a formatted description, and what may change after the call is validated. The real handlers over
// the stateful fake database and a fake storage: what is accepted (PNG, JPG, WebP, by content, up to 5 MB, hash-scanned — never SVG), who may do it, which logo a page shows, what the public
// link serves, that a duplicate copies the cover, and that a description with a script in it is rebuilt from the closed list.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { callsDb, fakeCallsAdmin, type CallsDb, type FakeStorage } from '@/test/fake-calls-db';

let db: CallsDb;
let storage: FakeStorage;
let currentUser: { id: string; email: string; email_confirmed_at?: string | null } | null;

vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeCallsAdmin(db, storage) }));
vi.mock('@/lib/supabase-server', () => ({
  authEnabled: true,
  serverClient: async () => ({ auth: { getUser: async () => ({ data: { user: currentUser } }) }, from: (t: string) => fakeCallsAdmin(db, storage).from(t) }),
}));
vi.mock('@/lib/incubator-access-core', () => ({ resolveIncubatorMember: async () => null }));
// The hash lookup of every upload: a file containing the word EVIL is "known malicious".
vi.mock('@/lib/upload-security', async (orig) => ({
  ...(await orig<typeof import('@/lib/upload-security')>()),
  scanWithVirusTotal: async (b: Buffer) => (b.includes(Buffer.from('EVIL')) ? { status: 'flagged', provider: 'virustotal', detail: 'known malicious file' } : { status: 'local_only', provider: null, detail: 'checked locally' }),
}));

import { GET as mediaGet, POST as mediaPost, DELETE as mediaDelete } from './[id]/media/route';
import { GET as oneGet, PATCH as generalPatch } from './[id]/route';
import { POST as duplicatePost } from './[id]/duplicate/route';
import { GET as publicGet } from './public/[token]/route';
import { GET as publicCover } from './public/[token]/cover/route';
import { GET as publicLogo } from './public/[token]/logo/route';
import { brandingOf, profileLogos } from '@/lib/calls/branding';
import { rowToCall } from '@/lib/calls/mappers';

const FIRM = '11111111-1111-4111-8111-111111111111';
const CALL = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'tok-918-a1-0123456789abcdef';
const DAY = 86_400_000;
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

const PNG = (extra = ''): Buffer => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`png-body-${extra}`)]);
const JPG = (): Buffer => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('jpg-body')]);
const WEBP = (): Buffer => Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBPVP8 body')]);
const SVG = (): Buffer => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>');
const GIF = (): Buffer => Buffer.concat([Buffer.from('GIF89a'), Buffer.from('gif-body')]);

const json = (method: string, body?: unknown) => new NextRequest('http://localhost/api/calls', { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const params = (id: string) => ({ params: { id } });
const read = async (res: Response) => ({ status: res.status, body: await res.json().catch(() => ({})), res });
const as = (id: string | null) => { currentUser = id ? { id, email: `${id}@example.com`, email_confirmed_at: '2026-10-01T00:00:00Z' } : null; };
const upload = (kind: string, bytes: Buffer, name: string, extra: Record<string, string> = {}, id = CALL) => {
  const form = new FormData();
  form.append('kind', kind); form.append('file', new File([new Uint8Array(bytes)], name)); for (const [k, v] of Object.entries(extra)) form.append(k, v);
  return mediaPost(new NextRequest(`http://localhost/api/calls/${id}/media`, { method: 'POST', body: form }), params(id)).then(read);
};
const row = () => db.tables.calls.find((c) => c.id === CALL)!;
const events = (name: string) => db.tables.call_events.filter((e) => e.call_id === CALL && e.event === name);
const stored = () => [...storage.objects.keys()].filter((k) => k.startsWith(`calls/${CALL}/`));

function seed(callOver: Record<string, unknown> = {}) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-test';
  delete process.env.CALLS_MODE;
  db = callsDb(); storage = { objects: new Map() }; db.nowMs = undefined; db.clock = Date.now();
  db.tables.catalog_entities.push({ id: FIRM, name: 'zz-test-firm', is_test: false });
  db.tables.calls.push({
    id: CALL, promoter_kind: 'catalog_entity', catalog_entity_id: FIRM, incubator_id: null, name: 'Seed Call 2027', description: 'Summary', status: 'draft',
    opens_at: iso(-DAY), closes_at: iso(30 * DAY), timezone: 'Europe/Lisbon', visibility: 'listed', limit_unit: 'project', allow_multiple: false, content_language: 'en', currency: 'EUR',
    link_token: TOKEN, config_version: 3, created_by: 'owner', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', contact_email: null, ...callOver,
  });
  db.tables.call_form_fields.push({ id: 'f0000000-0000-4000-8000-000000000001', call_id: CALL, kind: 'short_text', label: 'Q', page: 1, position: 0, required: false });
  for (const u of ['ana', 'bob']) db.users.set(u, { id: u, email: `${u}@example.com` });
  db.tables.matchdeal_investor_members.push(
    { id: 'm-ana', user_id: 'ana', catalog_entity_id: FIRM, status: 'active', role: 'admin', created_at: '2026-01-01T00:00:00.000Z' },
    { id: 'm-bob', user_id: 'bob', catalog_entity_id: FIRM, status: 'active', role: 'member', created_at: '2026-01-01T00:00:00.000Z' },
  );
  as('ana');
}
beforeEach(() => {
  seed();
  // streamStorageObject mints an internal address and fetches it; here that address answers with the bytes held by the fake storage.
  vi.stubGlobal('fetch', async (url: string) => {
    const path = decodeURIComponent(String(url).replace('https://storage.test/signed/', '').replace(/\?.*$/, ''));
    const o = storage.objects.get(path);
    return o ? new Response(Buffer.from(o.bytes), { status: 200, headers: { 'content-type': o.contentType ?? 'application/octet-stream' } }) : new Response('nope', { status: 404 });
  });
});

describe('the cover image', () => {
  it('a PNG, a JPG and a WebP are accepted — kept as a file of THIS call, with the date it was set, and the history says so', async () => {
    for (const [name, bytes, ext] of [['cover.png', PNG(), 'png'], ['cover.jpg', JPG(), 'jpg'], ['cover.webp', WEBP(), 'webp']] as const) {
      const r = await upload('cover', bytes, name);
      expect(r.status, name + JSON.stringify(r.body)).toBe(200);
      expect(String(row().cover_path)).toMatch(new RegExp(`^calls/${CALL}/cover-[0-9a-f]{12}\\.${ext}$`));
      expect(storage.objects.has(row().cover_path as string)).toBe(true);
      expect(row().cover_updated_at).toBeTruthy();
      expect(r.body.branding.coverUrl).toMatch(new RegExp(`^/api/calls/${CALL}/media\\?kind=cover&v=\\d+$`));
    }
    expect(events('call_cover_set')).toHaveLength(3);
    expect(JSON.stringify(events('call_cover_set'))).not.toContain('cover.png');            // the event says the format and the size, not the file name
  });

  it('replacing the cover removes the old file; removing it clears the row and the file', async () => {
    await upload('cover', PNG('one'), 'one.png');
    const first = row().cover_path as string;
    await upload('cover', PNG('two'), 'two.png');
    const second = row().cover_path as string;
    expect(second).not.toBe(first);
    expect(storage.objects.has(first)).toBe(false);
    expect(storage.objects.has(second)).toBe(true);
    const gone = await mediaDelete(new NextRequest(`http://localhost/api/calls/${CALL}/media?kind=cover`, { method: 'DELETE' }), params(CALL)).then(read);
    expect(gone.status).toBe(200);
    expect(row().cover_path ?? null).toBeNull();
    expect(stored()).toEqual([]);
    expect(events('call_cover_removed')).toHaveLength(1);
  });

  it('SVG (it can carry code), GIF, a renamed program, an image whose name lies, an empty file and one over 5 MB are all refused — and nothing is stored', async () => {
    const tries: [string, Buffer, string][] = [
      ['an SVG', SVG(), 'logo.svg'], ['an SVG renamed to .png', SVG(), 'logo.png'], ['a GIF', GIF(), 'anim.gif'], ['a program renamed to .png', Buffer.from('MZ\u0090\u0000program'), 'cover.png'],
      ['a JPG named .png', JPG(), 'cover.png'], ['a PDF', Buffer.from('%PDF-1.7 body'), 'cover.pdf'], ['an empty file', Buffer.alloc(0), 'cover.png'],
      ['more than 5 MB', Buffer.concat([PNG(), Buffer.alloc(5 * 1024 * 1024)]), 'big.png'],
    ];
    for (const [what, bytes, name] of tries) {
      const r = await upload('cover', bytes, name);
      expect(r.status, what).toBe(400);
      expect(r.body.error, what).toMatch(/PNG, JPG or WebP|empty|too large/);
    }
    expect(stored()).toEqual([]);
    expect(row().cover_path ?? null).toBeNull();
  });

  it('a known malicious file is blocked by the hash lookup, like every upload', async () => {
    const r = await upload('cover', Buffer.concat([PNG(), Buffer.from('EVIL')]), 'cover.png');
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('Upload blocked');
    expect(stored()).toEqual([]);
  });

  it('only whoever may "Configure call"; an archived call cannot be changed; an unknown kind is refused', async () => {
    as('bob');
    expect((await upload('cover', PNG(), 'c.png')).status).toBe(403);
    expect(row().cover_path ?? null).toBeNull();
    as('ana');
    expect((await upload('banner', PNG(), 'c.png')).status).toBe(400);
    Object.assign(row(), { status: 'archived' });
    expect((await upload('cover', PNG(), 'c.png')).status).toBe(409);
  });

  it('it can be set at ANY stage — validated, open, closed — because it is the page\'s face, not its configuration (the version does not move)', async () => {
    for (const status of ['validated', 'open', 'closed']) {
      Object.assign(row(), { status, closes_at: status === 'closed' ? iso(-DAY) : iso(30 * DAY) });
      const version = row().config_version;
      const r = await upload('cover', PNG(status), `${status}.png`);
      expect(r.status, status).toBe(200);
      expect(row().config_version).toBe(version);
    }
  });

  it('the editor\'s preview route sends the signed-in team to a short-lived address; nobody else', async () => {
    await upload('cover', PNG(), 'c.png');
    const r = await mediaGet(new NextRequest(`http://localhost/api/calls/${CALL}/media?kind=cover`), params(CALL));
    expect(r.status).toBe(200);
    expect(r.headers.get('location')).toBeNull();
    expect(r.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await r.arrayBuffer()).subarray(0, 4).equals(PNG().subarray(0, 4))).toBe(true);
    as(null);
    expect((await mediaGet(new NextRequest(`http://localhost/api/calls/${CALL}/media?kind=cover`), params(CALL))).status).toBeGreaterThanOrEqual(401);
  });
});

describe('the logo', () => {
  const profileLogo = (url: string | null) => db.tables.matchdeal_profiles.push({ membership_id: 'm-ana', entity_logo_url: url });

  it('uploaded for the call, it wins; otherwise the entity\'s own profile logo is used; with neither there is none', async () => {
    const none = (await read(await oneGet(json('GET'), params(CALL)))).body.branding;
    expect(none).toMatchObject({ logoUrl: null, logoSource: null, profileLogoUrl: null });
    profileLogo('https://cdn.example/firm-logo.png');
    const fromProfile = (await read(await oneGet(json('GET'), params(CALL)))).body.branding;
    expect(fromProfile).toMatchObject({ logoUrl: 'https://cdn.example/firm-logo.png', logoSource: 'profile', profileLogoUrl: 'https://cdn.example/firm-logo.png' });
    await upload('logo', PNG('logo'), 'logo.png');
    const own = (await read(await oneGet(json('GET'), params(CALL)))).body.branding;
    expect(own.logoSource).toBe('call');
    expect(own.logoUrl).toMatch(/^\/api\/calls\/.+\/media\?kind=logo&v=\d+$/);
    expect(own.profileLogoUrl).toBe('https://cdn.example/firm-logo.png');
  });

  it('a profile logo that is not an https address is not used', async () => {
    for (const bad of ['http://cdn.example/x.png', 'javascript:alert(1)', 'data:image/png;base64,AAAA', '//cdn.example/x.png', '']) {
      db.tables.matchdeal_profiles.length = 0; profileLogo(bad);
      expect((await read(await oneGet(json('GET'), params(CALL)))).body.branding.logoUrl, bad).toBeNull();
    }
  });

  it('an incubator\'s call uses the incubator\'s logo', async () => {
    db.tables.incubators.push({ id: 'inc-1', name: 'zz-test-hub', logo_url: 'https://cdn.example/hub.png' });
    const call = rowToCall({ ...row(), promoter_kind: 'incubator', catalog_entity_id: null, incubator_id: 'inc-1' });
    const logos = await profileLogos(fakeCallsAdmin(db, storage), [call]);
    expect(logos.get('incubator:inc-1')).toBe('https://cdn.example/hub.png');
    expect((await brandingOf(fakeCallsAdmin(db, storage), [call], 'public')).get(call.id)).toMatchObject({ logoUrl: 'https://cdn.example/hub.png', logoSource: 'profile' });
  });

  it('"keep it in the profile too" — only when the person confirmed, and only when the profile has none: it never overwrites a logo', async () => {
    profileLogo(null);
    await upload('logo', PNG('a'), 'logo.png');                                              // not confirmed: nothing is written to the profile
    expect(db.tables.matchdeal_profiles[0].entity_logo_url ?? null).toBeNull();
    const confirmed = await upload('logo', PNG('b'), 'logo.png', { saveToProfile: 'true' });
    expect(confirmed.body.profile).toBe('saved');
    expect(String(db.tables.matchdeal_profiles[0].entity_logo_url)).toMatch(/^https:\/\/storage\.test\/signed\/calls\//);
    expect(events('call_logo_saved_to_profile')).toHaveLength(1);
    const keep = db.tables.matchdeal_profiles[0].entity_logo_url;
    const again = await upload('logo', PNG('c'), 'logo.png', { saveToProfile: 'true' });
    expect(again.body.profile).toBe('already_has_one');
    expect(db.tables.matchdeal_profiles[0].entity_logo_url).toBe(keep);
  });

  it('the cover and the logo are separate files; removing the logo leaves the cover', async () => {
    await upload('cover', PNG('c'), 'c.png'); await upload('logo', PNG('l'), 'l.png');
    expect(stored()).toHaveLength(2);
    await mediaDelete(new NextRequest(`http://localhost/api/calls/${CALL}/media?kind=logo`, { method: 'DELETE' }), params(CALL));
    expect(row().logo_path ?? null).toBeNull();
    expect(row().cover_path).toBeTruthy();
    expect(stored()).toHaveLength(1);
  });
});

describe('what the link of a published call serves', () => {
  it('the cover and the logo go to a short-lived address; the call info carries their addresses; a call with none says so', async () => {
    Object.assign(row(), { status: 'open' });
    await upload('cover', PNG('c'), 'c.png'); await upload('logo', PNG('l'), 'l.png');
    const info = await read(await publicGet(json('GET'), { params: { token: TOKEN } }));
    expect(info.body).toMatchObject({ ok: true, coverUrl: expect.stringMatching(/^\/api\/calls\/public\/tok-918[^/]+\/cover\?v=\d+$/), logoUrl: expect.stringMatching(/^\/api\/calls\/public\/tok-918[^/]+\/logo\?v=\d+$/) });
    for (const route of [publicCover, publicLogo]) {
      const r = await route(json('GET'), { params: { token: TOKEN } });
      expect(r.status).toBe(200);
      expect(r.headers.get('location')).toBeNull();
      expect(r.headers.get('content-type')).toBe('image/png');
      expect(Buffer.from(await r.arrayBuffer()).subarray(0, 4).equals(PNG().subarray(0, 4))).toBe(true);
    }
    await mediaDelete(new NextRequest(`http://localhost/api/calls/${CALL}/media?kind=cover`, { method: 'DELETE' }), params(CALL));
    expect((await publicCover(json('GET'), { params: { token: TOKEN } })).status).toBe(404);
    expect((await read(await publicGet(json('GET'), { params: { token: TOKEN } }))).body.coverUrl).toBeNull();
  });

  it('a call that is not published (a draft), or a wrong token, reveals nothing — not even an image', async () => {
    await upload('cover', PNG('c'), 'c.png');                                                 // the call is still a draft
    expect((await publicCover(json('GET'), { params: { token: TOKEN } })).status).toBe(404);
    expect((await publicLogo(json('GET'), { params: { token: 'not-a-token' } })).status).toBe(404);
    Object.assign(row(), { status: 'archived' });
    expect((await publicCover(json('GET'), { params: { token: TOKEN } })).status).toBe(404);
  });

  it('the profile logo of the entity is what the entry page shows when the call has none of its own', async () => {
    Object.assign(row(), { status: 'open' });
    db.tables.matchdeal_profiles.push({ membership_id: 'm-bob', entity_logo_url: 'https://cdn.example/firm.png' });
    const info = (await read(await publicGet(json('GET'), { params: { token: TOKEN } }))).body;
    expect(info.logoUrl).toBe('https://cdn.example/firm.png');
    expect(info.coverUrl).toBeNull();
  });
});

describe('duplicating a call copies its cover (and a logo uploaded for it) as files of the copy', () => {
  it('the copy has its own files: removing the original\'s cover does not take the copy\'s away', async () => {
    await upload('cover', PNG('c'), 'c.png'); await upload('logo', PNG('l'), 'l.png');
    const copy = (await read(await duplicatePost(json('POST'), params(CALL)))).body.call as { id: string; coverPath: string; logoPath: string };
    expect(copy.coverPath).toMatch(new RegExp(`^calls/${copy.id}/cover-`));
    expect(copy.coverPath).not.toBe(row().cover_path);
    expect(storage.objects.has(copy.coverPath)).toBe(true);
    expect(storage.objects.has(copy.logoPath)).toBe(true);
    await mediaDelete(new NextRequest(`http://localhost/api/calls/${CALL}/media?kind=cover`, { method: 'DELETE' }), params(CALL));
    expect(storage.objects.has(copy.coverPath)).toBe(true);
  });
});

describe('the description: formatted, sanitised on the server, and editable after validation', () => {
  const patch = (body: Record<string, unknown>) => generalPatch(json('PATCH', { baseVersion: row().config_version, ...body }), params(CALL)).then(read);

  it('a formatted description is stored as the sanitised HTML — a script, a handler and a javascript: link never reach the database', async () => {
    const evil = '<h2 onclick="x()">Who can apply</h2><script>alert(1)</script><ul><li>Startups</li></ul><p style="position:fixed">See <a href="javascript:alert(1)">this</a> and <a href="https://sherlockdeal.com" onclick="y()">that</a>.</p><img src=x onerror=alert(1)>';
    const r = await patch({ description: evil });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const stored = String(row().description);
    expect(stored).toBe('<h2>Who can apply</h2><ul><li>Startups</li></ul><p>See this and <a href="https://sherlockdeal.com" rel="noopener noreferrer" target="_blank">that</a>.</p>');
    expect(stored).not.toMatch(/script|onclick|onerror|javascript|<img|style=/i);
  });

  it('an old plain-text description keeps its text', async () => {
    expect((await patch({ description: 'Plain text.\n\nSecond paragraph.' })).status).toBe(200);
    expect(row().description).toBe('Plain text.\n\nSecond paragraph.');
  });

  it('after the call is validated, open or closed, the DESCRIPTION can still be changed — nothing else — and the configuration version does not move', async () => {
    for (const status of ['validated', 'open', 'closed']) {
      Object.assign(row(), { status, closes_at: status === 'closed' ? iso(-DAY) : iso(30 * DAY) });
      const version = row().config_version;
      const ok = await patch({ description: `<p>Edition <strong>${status}</strong></p>` });
      expect(ok.status, status).toBe(200);
      expect(row().description).toBe(`<p>Edition <strong>${status}</strong></p>`);
      expect(row().config_version).toBe(version);
      const locked = await patch({ name: 'Another name' });
      expect(locked.status, status).toBe(409);
      expect(locked.body.code).toBe('locked');
      expect(row().name).toBe('Seed Call 2027');
      expect((await patch({ description: '<p>x</p>', closesAt: iso(60 * DAY) })).status, status).toBe(409);         // a description together with anything else stays locked
    }
  });

  it('an archived call\'s description is locked; someone without "Configure call" cannot change it', async () => {
    Object.assign(row(), { status: 'archived' });
    expect((await patch({ description: '<p>x</p>' })).status).toBe(409);
    Object.assign(row(), { status: 'open' });
    as('bob');
    expect((await patch({ description: '<p>x</p>' })).status).toBe(403);
    expect(row().description).toBe('Summary');
  });
});

// /api/version: the build the server is on, never cached, nothing else.
import { afterEach, describe, expect, it } from 'vitest';
import { GET, dynamic } from './route';

const saved = process.env.NEXT_PUBLIC_BUILD_ID;
afterEach(() => { if (saved === undefined) delete process.env.NEXT_PUBLIC_BUILD_ID; else process.env.NEXT_PUBLIC_BUILD_ID = saved; });

describe('/api/version', () => {
  it('answers the build id, and only that, with no caching anywhere', async () => {
    process.env.NEXT_PUBLIC_BUILD_ID = 'abc123';
    const res = await GET();
    expect(dynamic).toBe('force-dynamic');
    expect(await res.json()).toEqual({ buildId: 'abc123' });
    expect(res.headers.get('cache-control')).toBe('no-store, max-age=0');
  });
  it('without a build id it says null (the banner reads that as "unknown", never as a change)', async () => {
    delete process.env.NEXT_PUBLIC_BUILD_ID;
    expect(await (await GET()).json()).toEqual({ buildId: null });
  });
});

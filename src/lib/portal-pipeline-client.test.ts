import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetForTests, fetchPipelineShared } from './portal-pipeline-client';

function mockFetch() {
  let calls = 0;
  const fn = vi.fn(async () => {
    calls++;
    return { json: async () => ({ call: calls }) };
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('fetchPipelineShared', () => {
  beforeEach(() => __resetForTests());
  afterEach(() => vi.unstubAllGlobals());

  it('two near-simultaneous callers (the shell and the Pipeline tab mounting together) share ONE real request', async () => {
    const fetchMock = mockFetch();
    const [a, b] = await Promise.all([fetchPipelineShared(), fetchPipelineShared()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  it('a later call within the dedupe window still reuses the same in-flight/just-resolved request', async () => {
    const fetchMock = mockFetch();
    await fetchPipelineShared();
    await fetchPipelineShared();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('force:true always fires a real request, even immediately after a shared one — a post-action refresh must never show stale data', async () => {
    const fetchMock = mockFetch();
    const first = await fetchPipelineShared<{ call: number }>();
    const second = await fetchPipelineShared<{ call: number }>({ force: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(second.call).not.toBe(first.call);
  });

  it('a forced call also refreshes what a later, non-forced call within the window sees', async () => {
    const fetchMock = mockFetch();
    await fetchPipelineShared();
    const forced = await fetchPipelineShared<{ call: number }>({ force: true });
    const after = await fetchPipelineShared<{ call: number }>();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(after).toEqual(forced);
  });
});

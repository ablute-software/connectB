// "A new version is available": the rules that decide when the banner is offered, the server's answer, the build id both sides share, and that nothing ever reloads by itself.
import fs from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { VERSION_CHECK_EVERY_MS, VERSION_CHECK_MIN_GAP_MS, buildIdFromResponse, isNewVersion, shouldCheckNow } from './build-version';
import { NewVersionBanner } from '@/components/NewVersionBanner';

describe('when a version counts as new', () => {
  it('only when both ids are real and different', () => {
    expect(isNewVersion('abc', 'def')).toBe(true);
    expect(isNewVersion('abc', 'abc')).toBe(false);
    expect(isNewVersion(' abc ', 'abc')).toBe(false);
  });
  it('an empty, missing or unusable answer is NEVER a change (a failed fetch must not look like a deploy)', () => {
    for (const bad of ['', '   ', null, undefined, 0, {}, []]) expect(isNewVersion('abc', bad)).toBe(false);
    for (const bad of ['', null, undefined]) expect(isNewVersion(bad, 'def')).toBe(false);          // a page that does not know its own build never claims it is old
  });
  it('reads the server\'s answer defensively', () => {
    expect(buildIdFromResponse({ buildId: 'xyz ' })).toBe('xyz');
    for (const bad of [null, undefined, 'x', 5, {}, { buildId: '' }, { buildId: null }, { buildId: 7 }, []]) expect(buildIdFromResponse(bad)).toBeNull();
  });
});

describe('when it asks', () => {
  it('every ten minutes, and when the tab comes back — but never twice within a minute', () => {
    expect(VERSION_CHECK_EVERY_MS).toBe(600_000);
    expect(shouldCheckNow(null, 1000)).toBe(true);
    expect(shouldCheckNow(0, VERSION_CHECK_MIN_GAP_MS - 1)).toBe(false);
    expect(shouldCheckNow(0, VERSION_CHECK_MIN_GAP_MS)).toBe(true);
  });
});

describe('the banner', () => {
  it('shows nothing until the server has said the build changed', () => {
    expect(renderToStaticMarkup(createElement(NewVersionBanner))).toBe('');
  });
  const src = fs.readFileSync(`${process.cwd()}/src/components/NewVersionBanner.tsx`, 'utf8');
  it('NEVER reloads by itself: the only reload is the button\'s click, so what someone is typing is never lost', () => {
    const calls = src.match(/location\.reload\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(src).toMatch(/onClick=\{\(\) => window\.location\.reload\(\)\}/);
    expect(src).not.toMatch(/location\.(assign|replace|href\s*=)/);
  });
  it('says what the person asked for, is announced politely, and stays quiet in development', () => {
    expect(src).toContain('A new version of {BRAND_NAME} is available');
    expect(src).toContain('>Reload</button>');
    expect(src).toContain('role="status"');
    expect(src).toContain("process.env.NODE_ENV !== 'production'");
  });
  it('is mounted once, at the root, so every page has it — and /api/version is reachable without a session (the login page too)', () => {
    expect(fs.readFileSync(`${process.cwd()}/src/app/layout.tsx`, 'utf8')).toContain('<NewVersionBanner />');
    expect(fs.readFileSync(`${process.cwd()}/src/middleware.ts`, 'utf8')).toMatch(/const PUBLIC = \[[^\]]*'\/api\/version'/);
  });
});

describe('one build id for the page and the server', () => {
  it('next.config makes ONE id: Next\'s buildId and the id inlined into the page are the same', async () => {
    const cfg = (await import('../../next.config.mjs')).default as { generateBuildId: () => Promise<string>; env: { NEXT_PUBLIC_BUILD_ID: string } };
    const id = await cfg.generateBuildId();
    expect(id).toBeTruthy();
    expect(cfg.env.NEXT_PUBLIC_BUILD_ID).toBe(id);
  });
});

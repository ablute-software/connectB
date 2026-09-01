// Prompt 526 Part B — guards the two things about the guest previews that
// can silently rot: the contextual copy (which the approved email's own CTAs
// promise, so a reword here breaks a promise made in someone's inbox) and the
// pairing between the sidebar's three links and the route files that serve
// them (a renamed folder would turn the free navigation between previews into
// three 404s, with nothing else failing).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PREVIEWS, PREVIEW_COPY, previewSignupHref, type PreviewKey } from '@/lib/guest-previews';

const REPO = path.resolve(__dirname, '../..');

describe('guest preview copy', () => {
  it('carries the approved contextual messages verbatim', () => {
    expect(PREVIEW_COPY.pipeline.message).toBe(
      'Sign up to access a pipeline curated for your investment thesis.',
    );
    expect(PREVIEW_COPY.watson.message).toBe(
      'Create an investor account to use Watson and get a private AI second opinion on your deals.',
    );
    expect(PREVIEW_COPY.bars.message).toBe(
      'Create an investor account to assess opportunities with BARS.',
    );
  });

  it('sends every CTA to the existing investor signup flow, keeping the origin', () => {
    expect(previewSignupHref('pipeline')).toBe('/signup?as=investor&source=pipeline_preview');
    expect(previewSignupHref('watson')).toBe('/signup?as=investor&source=watson_preview');
    expect(previewSignupHref('bars')).toBe('/signup?as=investor&source=bars_preview');
  });
});

describe('guest preview routes', () => {
  it('has a page file behind every sidebar link', () => {
    for (const p of PREVIEWS) {
      const file = path.join(REPO, 'src/app', p.href, 'page.tsx');
      expect(fs.existsSync(file), `${p.href} has no page.tsx`).toBe(true);
    }
  });

  it('covers every PREVIEWS key with copy, and nothing more', () => {
    const navKeys = PREVIEWS.map((p) => p.key as PreviewKey).sort();
    expect(Object.keys(PREVIEW_COPY).sort()).toEqual(navKeys);
  });

  it('never fetches — a guest preview must reach no API and carry no orgId', () => {
    for (const p of PREVIEWS) {
      const src = fs.readFileSync(path.join(REPO, 'src/app', p.href, 'page.tsx'), 'utf8');
      // Comments in these files legitimately mention the routes they do NOT
      // call, so strip them before looking for real calls.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code, `${p.href} fetches`).not.toMatch(/\bfetch\s*\(/);
      expect(code, `${p.href} references an orgId`).not.toMatch(/orgId/);
    }
  });
});

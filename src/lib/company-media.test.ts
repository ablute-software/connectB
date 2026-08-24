import { describe, it, expect } from 'vitest';
import { isAllowedVideoLink, toEmbedUrl, validateCaption, CAPTION_MAX_LEN } from './company-media';

describe('isAllowedVideoLink', () => {
  it('accepts real YouTube and Vimeo URLs', () => {
    expect(isAllowedVideoLink('https://www.youtube.com/watch?v=abc123')).toBe(true);
    expect(isAllowedVideoLink('https://youtu.be/abc123')).toBe(true);
    expect(isAllowedVideoLink('https://vimeo.com/123456789')).toBe(true);
  });

  it('rejects a lookalike host — hostname must match exactly, never a substring', () => {
    expect(isAllowedVideoLink('https://youtube.com.evil.example/watch?v=abc')).toBe(false);
    expect(isAllowedVideoLink('https://evil.example/?u=youtube.com')).toBe(false);
  });

  it('rejects non-https and any other video host entirely', () => {
    expect(isAllowedVideoLink('http://www.youtube.com/watch?v=abc123')).toBe(false);
    expect(isAllowedVideoLink('https://www.dailymotion.com/video/x123')).toBe(false);
    expect(isAllowedVideoLink('https://vimeo.evil.com/123')).toBe(false);
  });

  it('rejects a malformed URL without throwing', () => {
    expect(isAllowedVideoLink('not a url')).toBe(false);
  });
});

describe('toEmbedUrl', () => {
  it('builds a clean YouTube embed URL from a watch link', () => {
    expect(toEmbedUrl('https://www.youtube.com/watch?v=abc123&list=xyz')).toBe('https://www.youtube.com/embed/abc123');
  });

  it('builds a clean YouTube embed URL from a youtu.be short link', () => {
    expect(toEmbedUrl('https://youtu.be/abc123')).toBe('https://www.youtube.com/embed/abc123');
  });

  it('builds a clean YouTube embed URL from a shorts link', () => {
    expect(toEmbedUrl('https://www.youtube.com/shorts/abc123')).toBe('https://www.youtube.com/embed/abc123');
  });

  it('builds a clean Vimeo embed URL from a plain video link', () => {
    expect(toEmbedUrl('https://vimeo.com/123456789')).toBe('https://player.vimeo.com/video/123456789');
  });

  it('returns null for a link that passes the host check but is not a single-video URL', () => {
    expect(toEmbedUrl('https://www.youtube.com/channel/UC123')).toBeNull();
    expect(toEmbedUrl('https://vimeo.com/user/12345')).toBeNull();
  });

  it('returns null outright for a disallowed host — never falls back to the raw URL', () => {
    expect(toEmbedUrl('https://www.dailymotion.com/video/x123')).toBeNull();
  });
});

describe('validateCaption', () => {
  it('requires a non-empty caption', () => {
    expect(validateCaption('')).toMatch(/required/);
    expect(validateCaption('   ')).toMatch(/required/);
  });

  it('accepts a normal caption', () => {
    expect(validateCaption('Our Porto office')).toBeNull();
  });

  it('rejects a caption over the max length', () => {
    expect(validateCaption('x'.repeat(CAPTION_MAX_LEN + 1))).toMatch(/too long/);
  });
});

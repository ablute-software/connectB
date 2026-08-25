// Prompt 301 §3 — detectAllowedKind is the mechanical, no-network half of
// upload security (the VirusTotal calls need a real network mock to test
// meaningfully and are exercised via the route's own manual verification
// instead). One test per real-world shape: correct file, spoofed extension,
// disallowed type entirely, and the zip/office distinction.
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectAllowedKind, scanWithVirusTotal, checkVirusTotalKeyHealth } from './upload-security';

function bytes(...b: number[]): Buffer { return Buffer.from(b); }

describe('detectAllowedKind', () => {
  it('aceita um PDF real com extensão .pdf', () => {
    const pdf = Buffer.concat([bytes(0x25, 0x50, 0x44, 0x46), Buffer.from('-1.4 rest of file')]);
    expect(detectAllowedKind(pdf, 'deck.pdf')).toBe('pdf');
  });

  it('rejeita um .exe disfarçado de .pdf pela extensão (MZ header)', () => {
    const exe = bytes(0x4d, 0x5a, 0x90, 0x00);
    expect(detectAllowedKind(exe, 'deck.pdf')).toBeNull();
  });

  it('rejeita um PDF real cuja extensão diz .exe — o conteúdo manda, mas tem de bater com o esperado', () => {
    const pdf = bytes(0x25, 0x50, 0x44, 0x46);
    expect(detectAllowedKind(pdf, 'malware.exe')).toBeNull();
  });

  it('rejeita uma extensão fora do allowlist mesmo com conteúdo "inofensivo"', () => {
    expect(detectAllowedKind(bytes(0x25, 0x50, 0x44, 0x46), 'script.sh')).toBeNull();
  });

  it('aceita .docx com assinatura ZIP', () => {
    const zip = bytes(0x50, 0x4b, 0x03, 0x04);
    expect(detectAllowedKind(zip, 'plan.docx')).toBe('docx');
  });

  it('NUNCA aceita um .zip puro, mesmo com a mesma assinatura de um docx real', () => {
    const zip = bytes(0x50, 0x4b, 0x03, 0x04);
    expect(detectAllowedKind(zip, 'archive.zip')).toBeNull();
  });

  it('aceita um .doc legado (OLE compound file)', () => {
    const ole = bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
    expect(detectAllowedKind(ole, 'plan.doc')).toBe('doc');
  });

  it('aceita JPEG e PNG pelos seus próprios magic bytes', () => {
    expect(detectAllowedKind(bytes(0xff, 0xd8, 0xff), 'photo.jpg')).toBe('jpg');
    expect(detectAllowedKind(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), 'photo.png')).toBe('png');
  });

  it('aceita .csv/.txt por sniff de conteúdo (sem byte nulo)', () => {
    const text = Buffer.from('name,amount\nAcme,1000\n');
    expect(detectAllowedKind(text, 'data.csv')).toBe('csv');
  });

  it('rejeita .csv/.txt cujo conteúdo tem bytes nulos (parece binário)', () => {
    const binaryish = Buffer.concat([Buffer.from('name,amount\n'), bytes(0x00, 0x01, 0x02)]);
    expect(detectAllowedKind(binaryish, 'data.csv')).toBeNull();
  });

  it('rejeita um ficheiro sem extensão nenhuma', () => {
    expect(detectAllowedKind(bytes(0x25, 0x50, 0x44, 0x46), 'deck')).toBeNull();
  });

  // Prompt 305 §A — gif/webp added for support-attachment/matchdeal-photo,
  // which previously accepted any client-supplied image/* MIME type.
  it('aceita GIF pela assinatura GIF8', () => {
    expect(detectAllowedKind(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61), 'photo.gif')).toBe('gif');
  });

  it('aceita WEBP pela assinatura RIFF....WEBP', () => {
    const webp = bytes(0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50);
    expect(detectAllowedKind(webp, 'photo.webp')).toBe('webp');
  });

  it('rejeita um RIFF que não é WEBP (ex. um .wav renomeado)', () => {
    const wav = bytes(0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45); // RIFF....WAVE
    expect(detectAllowedKind(wav, 'sound.webp')).toBeNull();
  });

  // Prompt 305 §A — SVG is deliberately absent from the allowlist entirely
  // (can embed <script>; see upload-security.ts's own header for why this
  // is the chosen mitigation over building a sanitizer). No magic-byte
  // check exists for it, so any .svg extension is rejected outright.
  it('NUNCA aceita .svg — não está no allowlist, seja qual for o conteúdo', () => {
    const svgXml = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(detectAllowedKind(svgXml, 'photo.svg')).toBeNull();
  });

  // Prompt 353 — mp4/webm added for the company media gallery's video
  // upload path.
  it('aceita MP4 pela assinatura ftyp no offset 4', () => {
    const mp4 = bytes(0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d);
    expect(detectAllowedKind(mp4, 'clip.mp4')).toBe('mp4');
  });

  it('aceita WEBM pela assinatura EBML', () => {
    expect(detectAllowedKind(bytes(0x1a, 0x45, 0xdf, 0xa3), 'clip.webm')).toBe('webm');
  });

  it('rejeita um mp4/webm cujo conteúdo não bate com a extensão', () => {
    expect(detectAllowedKind(bytes(0x1a, 0x45, 0xdf, 0xa3), 'clip.mp4')).toBeNull();
    expect(detectAllowedKind(bytes(0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70), 'clip.webm')).toBeNull();
  });
});

describe('scanWithVirusTotal — Prompt 375: hash-only, never submits content', () => {
  const OLD_KEY = process.env.VIRUSTOTAL_API_KEY;
  afterEach(() => {
    vi.unstubAllGlobals();
    if (OLD_KEY === undefined) delete process.env.VIRUSTOTAL_API_KEY; else process.env.VIRUSTOTAL_API_KEY = OLD_KEY;
  });

  // The static guard the prompt explicitly asks for: fails the moment a
  // FormData/POST-to-/files submission path is reintroduced, however it's
  // written — this is a dated, deliberate product decision (see the
  // function's own header comment), not something to "helpfully" restore.
  it('contains no file-submission code path at all', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, 'upload-security.ts'), 'utf8');
    expect(src).not.toContain('FormData');
    expect(src).not.toMatch(/method:\s*['"]POST['"][^}]*\/files/s);
  });

  it('with no API key configured, degrades to local_only without any network call', async () => {
    delete process.env.VIRUSTOTAL_API_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const verdict = await scanWithVirusTotal(Buffer.from('hello'));
    expect(verdict).toMatchObject({ status: 'local_only', provider: null });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // Prompt 372 follow-up — a 401/403 resolves to 'local_only', NOT
  // 'not_scanned': local validation (magic bytes etc.) already passed by
  // the time this runs, and 'not_scanned' feeds prepareDocumentForAi's
  // gate, which refuses it. Marking an auth failure 'not_scanned' would
  // mean an expired/revoked key silently stops the whole knowledge engine
  // platform-wide for every new upload — the auth failure itself must
  // stay loud (console.error, asserted below), but the document's own
  // status reflects what actually happened to IT.
  it('a 401 is a configuration error, never "pending" — but the document still ends up local_only, never blocked', async () => {
    process.env.VIRUSTOTAL_API_KEY = 'invalid-short-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const verdict = await scanWithVirusTotal(Buffer.from('hello'));
    expect(verdict.status).toBe('local_only');
    expect(verdict.provider).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('a 403 is treated the same as a 401', async () => {
    process.env.VIRUSTOTAL_API_KEY = 'invalid-short-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    const verdict = await scanWithVirusTotal(Buffer.from('hello'));
    expect(verdict.status).toBe('local_only');
    expect(verdict.provider).toBeNull();
  });

  it('a 404 (hash unknown — the normal case for a private document) resolves to local_only, never a submission', async () => {
    process.env.VIRUSTOTAL_API_KEY = 'a-real-looking-key';
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    vi.stubGlobal('fetch', fetchSpy);
    const verdict = await scanWithVirusTotal(Buffer.from('hello'));
    expect(verdict.status).toBe('local_only');
    expect(fetchSpy).toHaveBeenCalledTimes(1); // one lookup, nothing else
  });

  it('a 429 rate limit is a legitimate pending, worth the daily cron retry', async () => {
    process.env.VIRUSTOTAL_API_KEY = 'a-real-looking-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));
    const verdict = await scanWithVirusTotal(Buffer.from('hello'));
    expect(verdict.status).toBe('pending');
    expect(verdict.provider).toBe('virustotal');
  });

  it('a known hash with malicious detections is flagged, from the lookup alone', async () => {
    process.env.VIRUSTOTAL_API_KEY = 'a-real-looking-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ data: { attributes: { last_analysis_stats: { malicious: 3, suspicious: 0 } } } }),
    }));
    const verdict = await scanWithVirusTotal(Buffer.from('hello'));
    expect(verdict.status).toBe('flagged');
  });

  it('a known, clean hash resolves to clean', async () => {
    process.env.VIRUSTOTAL_API_KEY = 'a-real-looking-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ data: { attributes: { last_analysis_stats: { malicious: 0, suspicious: 0 } } } }),
    }));
    const verdict = await scanWithVirusTotal(Buffer.from('hello'));
    expect(verdict.status).toBe('clean');
  });
});

describe('checkVirusTotalKeyHealth', () => {
  const OLD_KEY = process.env.VIRUSTOTAL_API_KEY;
  afterEach(() => {
    vi.unstubAllGlobals();
    if (OLD_KEY === undefined) delete process.env.VIRUSTOTAL_API_KEY; else process.env.VIRUSTOTAL_API_KEY = OLD_KEY;
  });

  it('reports not configured when no key is set', async () => {
    delete process.env.VIRUSTOTAL_API_KEY;
    const result = await checkVirusTotalKeyHealth();
    expect(result).toMatchObject({ configured: false, ok: false });
  });

  it('reports a bad key as configured but not ok', async () => {
    process.env.VIRUSTOTAL_API_KEY = 'bad';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 401 }));
    const result = await checkVirusTotalKeyHealth();
    expect(result).toMatchObject({ configured: true, ok: false });
  });

  it('reports a working key as ok', async () => {
    process.env.VIRUSTOTAL_API_KEY = 'good';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    const result = await checkVirusTotalKeyHealth();
    expect(result).toMatchObject({ configured: true, ok: true });
  });
});

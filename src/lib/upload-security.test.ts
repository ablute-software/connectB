// Prompt 301 §3 — detectAllowedKind is the mechanical, no-network half of
// upload security (the VirusTotal calls need a real network mock to test
// meaningfully and are exercised via the route's own manual verification
// instead). One test per real-world shape: correct file, spoofed extension,
// disallowed type entirely, and the zip/office distinction.
import { describe, expect, it } from 'vitest';
import { detectAllowedKind } from './upload-security';

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
});

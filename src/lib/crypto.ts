// AES-256-GCM at-rest encryption for OAuth tokens (IRM_SPEC §8d — "no
// credentials in plain text, only encrypted tokens"). TOKEN_ENCRYPTION_KEY
// must be a base64-encoded 32-byte key (`openssl rand -base64 32`). Server-
// only — never import this from a client component.
import 'server-only';
import crypto from 'crypto';

export function tokenEncryptionConfigured(): boolean {
  return !!process.env.TOKEN_ENCRYPTION_KEY;
}

function key(): Buffer {
  const b64 = process.env.TOKEN_ENCRYPTION_KEY;
  if (!b64) throw new Error('TOKEN_ENCRYPTION_KEY is not set.');
  const buf = Buffer.from(b64, 'base64');
  if (buf.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes.');
  return buf;
}

// Output: base64(iv || authTag || ciphertext) — self-contained, no separate storage needed.
export function encryptToken(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

export function decryptToken(encoded: string): string {
  const raw = Buffer.from(encoded, 'base64');
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

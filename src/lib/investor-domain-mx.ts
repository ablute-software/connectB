// Prompt 573 §C — one extra, independent fact for the Investor identity
// panel: does the claimed/entity domain even have mail servers configured?
// This is NOT a decision input — domainsMatch() (investor-entity-claims.ts)
// is and stays the real signal, exact eTLD+1 equality. A domain can fail
// this check and still be a perfectly legitimate match (mail hosted on a
// parent/subdomain outside DNS the admin can see), and can pass it while
// still being the wrong domain entirely. It exists only so a reviewer can
// see "this domain doesn't even accept mail" as one more data point,
// same spirit as domain_match itself: evidence, never an automated gate.
import 'server-only';
import { resolveMx } from 'node:dns/promises';

export type MxLookupResult = { checked: true; hasMx: boolean } | { checked: false; reason: string };

// Prompt 573 §C — "uma resolução DNS no servidor com cache e timeout
// curto": a serverless function has no long-lived process to keep a real
// cache warm across requests, but within the lifetime of one warm instance
// this still avoids re-querying the same domain on every panel open in a
// session, and the timeout keeps a slow/unresponsive DNS server from
// hanging the request the fact is attached to.
const CACHE_TTL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 2000;
const cache = new Map<string, { result: MxLookupResult; at: number }>();

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

export async function checkMxRecords(domain: string | null): Promise<MxLookupResult> {
  if (!domain) return { checked: false, reason: 'no domain to check' };

  const cached = cache.get(domain);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.result;

  let result: MxLookupResult;
  try {
    const records = await withTimeout(resolveMx(domain), TIMEOUT_MS);
    result = { checked: true, hasMx: records.length > 0 };
  } catch (e) {
    // ENOTFOUND/ENODATA — no MX record, a real and common answer, not a
    // failure of the lookup itself.
    const code = (e as NodeJS.ErrnoException).code;
    result = code === 'ENOTFOUND' || code === 'ENODATA'
      ? { checked: true, hasMx: false }
      : { checked: false, reason: code ?? (e as Error).message ?? 'lookup failed' };
  }
  cache.set(domain, { result, at: Date.now() });
  return result;
}

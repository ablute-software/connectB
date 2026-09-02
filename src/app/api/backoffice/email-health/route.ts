// Prompt 537 §2 — self-diagnosis, so Vercel logs are never needed again.
//
// For three weeks the answer to "why doesn't the invite arrive?" lived in a
// console.error nobody in the loop can read. The result was re-diagnosis by
// guesswork: an unverified sender domain, a missing key and a sandbox
// recipient refusal all look identical from the product side. One call to
// Resend's own /domains endpoint settles it permanently, and this route is
// where that call lives.
//
// It reports; it never repairs. Verifying a domain is a DNS change at the
// registrar and an env var on Vercel (§3) — this route's whole job is to
// say, in the back-office, which of the two possible states production is
// actually in, so nobody has to guess again.
//
// SECURITY: platform admins only, and the API key is reported as a BOOLEAN.
// The key's value never leaves the server, is never logged, and is never
// part of a response — only whether one is set.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { resolvedFromAddress, resolvedReplyTo, domainOfSender, isSandboxSender } from '@/lib/email-sender-identity';

export interface ResendDomainRow {
  id?: string;
  name?: string;
  status?: string;
  region?: string;
  created_at?: string;
}

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;

  const apiKey = process.env.RESEND_API_KEY;
  // Resolved by the SAME helpers sendTransactionalEmail uses, so this card
  // cannot report a sender other than the one in effect.
  const from = resolvedFromAddress();
  const fromDomain = domainOfSender(from);
  const replyTo = resolvedReplyTo() ?? null;

  const base = {
    apiKeyPresent: !!apiKey,
    fromInEffect: from,
    fromDomain,
    replyToInEffect: replyTo,
    fromEnvSet: !!process.env.RESEND_FROM_EMAIL,
  };

  if (!apiKey) {
    return NextResponse.json({
      ok: true, ...base, domains: [], fromDomainVerified: false,
      // Named plainly rather than as a status code: this is the first of the
      // exactly two states §3 says production can be in.
      diagnosis: 'No RESEND_API_KEY is set in this environment — nothing can be sent at all.',
    });
  }

  let domains: ResendDomainRow[] = [];
  let domainsError: string | null = null;
  try {
    const res = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${apiKey}` }, cache: 'no-store',
    });
    if (!res.ok) {
      domainsError = `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`;
    } else {
      const body = await res.json();
      domains = (Array.isArray(body?.data) ? body.data : []) as ResendDomainRow[];
    }
  } catch (e) {
    domainsError = `threw: ${(e as Error).message}`;
  }

  // Resend's sandbox sender works without any domain of ours being verified,
  // but ONLY to the account owner's own address — which is precisely why a
  // founder's invite to a third party fails while a test to yourself
  // succeeds. Calling that out here is the difference between "it works for
  // me" and understanding why it doesn't work for anyone else.
  const isSandbox = isSandboxSender(from);
  const match = domains.find((d) => (d.name ?? '').toLowerCase() === fromDomain);
  const fromDomainVerified = !!match && (match.status ?? '').toLowerCase() === 'verified';

  const diagnosis = domainsError
    ? `Could not read the provider's domain list: ${domainsError}`
    : isSandbox
      ? 'Sending from the Resend sandbox domain (resend.dev). The provider accepts these only for the account owner’s own address, so invites to anyone else are refused. Verify a real domain and set RESEND_FROM_EMAIL.'
      : fromDomainVerified
        ? `Sending from ${fromDomain}, which the provider reports as verified.`
        : match
          ? `The sender domain ${fromDomain} exists at the provider but its status is "${match.status}", not "verified" — third-party recipients will be refused until the DNS records are in place.`
          : `The sender domain ${fromDomain ?? '(unparseable)'} is not registered at the provider at all — every send will be refused. Add it under Domains and verify it.`;

  return NextResponse.json({
    ok: true, ...base,
    domains: domains.map((d) => ({ name: d.name ?? null, status: d.status ?? null, region: d.region ?? null })),
    fromDomainVerified, isSandbox, domainsError, diagnosis,
  });
}

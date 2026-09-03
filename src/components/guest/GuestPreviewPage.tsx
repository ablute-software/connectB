// Prompt 548 Part 2 — one body for both route families.
//
// /guest/preview/<key>          (no token — the email's own CTAs)
// /guest/<token>/preview/<key>  (with a token — the way back to the share)
//
// They render the same thing. The token buys exactly two things and nothing
// else: the "Data room" entry in the sidebar, and a `guest=` parameter on
// the signup link so the grant can be resolved to the new account later. It
// is NOT validated here and nothing is fetched with it — this page shows the
// generic tool preview to anyone, which is what the token-less routes have
// always done. Validating it would imply the content depended on it; it
// does not.
import { notFound } from 'next/navigation';
import { FrostedOverlay } from '@/components/guest/FrostedOverlay';
import { GuestPreviewShell } from '@/components/guest/GuestPreviewShell';
import { PREVIEW_BODIES } from '@/components/guest/previews';
import { GuestPlansPreview } from '@/components/guest/GuestPlansPreview';
import { PREVIEW_COPY, activeNavKeyFor, isPreviewableKey, previewSignupHref } from '@/lib/guest-previews';
import { INVESTOR_NAV } from '@/lib/investor-nav';

export function GuestPreviewPage({ previewKey, token }: { previewKey: string; token?: string }) {
  if (!isPreviewableKey(previewKey)) notFound();

  const activeKey = activeNavKeyFor(previewKey);
  const nav = INVESTOR_NAV.find((n) => n.key === activeKey)!;
  const copy = PREVIEW_COPY[previewKey];

  // Prompt 548 Part 4 — Plans is the one entry that is NOT frosted. A guest
  // deciding whether this is worth an account should be able to read the
  // real prices; everything up to actually buying works.
  if (previewKey === 'plans') {
    return (
      <GuestPreviewShell active="plans" token={token} title={nav.label} subtitle={copy.message}>
        <GuestPlansPreview token={token} />
      </GuestPreviewShell>
    );
  }

  const Body = PREVIEW_BODIES[previewKey];
  return (
    <GuestPreviewShell active={activeKey} token={token} title={copy.title} subtitle={nav.label}>
      <FrostedOverlay message={copy.message} signupHref={previewSignupHref(previewKey, token)}>
        <Body />
      </FrostedOverlay>
    </GuestPreviewShell>
  );
}

export const previewMetadata = { robots: { index: false, follow: false } };

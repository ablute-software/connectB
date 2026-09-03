// Prompt 526 Part B / Prompt 548 Part 2 — the token-less previews, the URLs
// the approved investor email's own three CTAs point at
// (/guest/preview/pipeline | watson | bars). Prompt 526 shipped these as
// three hand-written pages; they are one dynamic route now, for a reason
// that is the whole point of Prompt 548: the sidebar renders every
// INVESTOR_NAV entry, so every entry must resolve. Three fixed pages would
// have meant eight 404s hanging off a sidebar built to be clicked.
//
// The three original URLs are unchanged, which is what the email depends on.
//
// A static `preview` segment sits beside the dynamic `[token]` one; Next
// resolves static before dynamic, so /guest/preview/pipeline lands here and
// /guest/<token>/preview/pipeline lands in the sibling route. The one URL
// that would collide is a token literally equal to "preview" — tokens are
// random hex, so it cannot occur.
import { GuestPreviewPage, previewMetadata } from '@/components/guest/GuestPreviewPage';

export const metadata = previewMetadata;

export default async function Page({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return <GuestPreviewPage previewKey={key} />;
}

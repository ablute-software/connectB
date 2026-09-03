// Prompt 548 Part 2 — the token-bearing previews.
//
// The token stays in the PATH, exactly as /guest/[token] itself keeps it:
// never a query string (any link that rebuilds the URL would drop it) and
// never sessionStorage (a new tab would lose it, and a guest opening one is
// ordinary). It is not validated here and nothing is fetched with it — the
// content is the same generic tool preview the token-less route serves to
// anyone. What the token buys is the "Data room" entry that leads back to
// the share, and a `guest=` parameter on the signup link.
import { GuestPreviewPage, previewMetadata } from '@/components/guest/GuestPreviewPage';

export const metadata = previewMetadata;

export default async function Page({ params }: { params: Promise<{ token: string; key: string }> }) {
  const { token, key } = await params;
  return <GuestPreviewPage previewKey={key} token={token} />;
}

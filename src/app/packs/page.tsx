// Packs page retired — the nav entry and Pipeline's "+ Add investor" link
// both moved off this route (suggest-an-investor is now a modal on
// Pipeline; pack browsing/unlocking was dropped, not migrated). No internal
// link or email points here anymore, but a bookmarked/typed URL shouldn't
// 404 — redirect straight to Pipeline instead.
import { redirect } from 'next/navigation';

export default function PacksPage() {
  redirect('/pipeline');
}

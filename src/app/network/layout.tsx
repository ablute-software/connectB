// Prompt 332 Pedido E — Material Symbols Outlined is a NEW icon-font
// dependency, the first use of any icon font in this app (confirmed by
// grep: globals.css/layout.tsx use no icon font today, shell.tsx's own NAV
// is plain unicode glyphs). Nuno's own approved mockup uses this vocabulary
// explicitly, so approving that design approved the font too — this is
// called out here rather than left as a silent choice.
//
// Scoped to /network only (this layout), not loaded app-wide: shell.tsx's
// own sidebar (unicode glyphs) is unchanged by this prompt, so there's no
// current reason to pay the font's load cost on every route. If another
// page wants this vocabulary later, promoting the <link> to the root
// layout is a one-line move — nothing here is /network-specific besides
// where it's mounted.
export default function NetworkLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Server Component <link> tags are hoisted into <head> automatically
          (Next.js App Router) — no next/head, no client-side DOM mutation. */}
      <link rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" />
      {children}
    </>
  );
}

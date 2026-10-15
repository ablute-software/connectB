// Prompt 918 E.1 — the line the copy icon puts on the clipboard for a row of the promo tree: "org · code · wave · date", the same four
// things the row shows, in the same order and with the same date format, so what lands in a message is what was on the screen.
export interface PromoLineNode { orgName: string; code: string; wave: number; redeemedAt: string }

/** "14 Oct 2026" — the date format of the promo tree (the page and the copied line must agree, so there is one function). */
export function promoTreeDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function promoNodeLine(node: PromoLineNode): string {
  return [node.orgName, node.code, `wave ${node.wave}`, promoTreeDate(node.redeemedAt)].join(' · ');
}

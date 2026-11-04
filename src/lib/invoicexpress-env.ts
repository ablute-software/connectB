// InvoiceXpress -- the env half (server-only), same all-or-nothing gate
// pattern as stripe-env.ts: half-configured would mean documents silently
// never get created, which is worse than the feature staying dark.
import 'server-only';

export function invoicexpressConfigured(): boolean {
  return !!(
    process.env.INVOICEXPRESS_ACCOUNT_NAME
    && process.env.INVOICEXPRESS_API_KEY
    && process.env.INVOICEXPRESS_SEQUENCE_ID
  );
}

export const invoicexpressAccountName = () => process.env.INVOICEXPRESS_ACCOUNT_NAME;
export const invoicexpressApiKey = () => process.env.INVOICEXPRESS_API_KEY;
// The numeric sequence_id of the SHLK26 series inside InvoiceXpress (NOT its
// name) -- find it in InvoiceXpress under Configurações > Séries/ATCUD >
// SHLK26 > Personalizar Série; the id is in that page's URL. Required so a
// document is always created in SHLK26, never in whatever series happens to
// be "pré-definida".
export const invoicexpressSequenceId = () => process.env.INVOICEXPRESS_SEQUENCE_ID;

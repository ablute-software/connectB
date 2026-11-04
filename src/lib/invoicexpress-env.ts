// InvoiceXpress -- the env half (server-only), same all-or-nothing gate
// pattern as stripe-env.ts: half-configured would mean documents silently
// never get created, which is worse than the feature staying dark.
import 'server-only';

export function invoicexpressConfigured(): boolean {
  return !!(
    process.env.INVOICEXPRESS_ACCOUNT_NAME
    && process.env.INVOICEXPRESS_API_KEY
    && process.env.INVOICEXPRESS_INVOICE_RECEIPT_SEQUENCE_ID
    && process.env.INVOICEXPRESS_CREDIT_NOTE_SEQUENCE_ID
  );
}

export const invoicexpressAccountName = () => process.env.INVOICEXPRESS_ACCOUNT_NAME;
export const invoicexpressApiKey = () => process.env.INVOICEXPRESS_API_KEY;
// InvoiceXpress does NOT have a single numeric id per series -- each series
// (SHLK26 here) has a different numeric sequence id PER DOCUMENT TYPE
// (current_invoice_receipt_sequence_id, current_credit_note_sequence_id,
// etc; see GET /sequences.json). Passing the wrong one silently issues the
// document on the wrong series/number, so the two document types used here
// each get their own env var -- never a single shared "sequence id".
// Confirmed 04/11/2026 via GET /sequences.json for series SHLK26 (id
// 6615694): current_invoice_receipt_sequence_id=6615696,
// current_credit_note_sequence_id=6615701.
export const invoicexpressInvoiceReceiptSequenceId = () => process.env.INVOICEXPRESS_INVOICE_RECEIPT_SEQUENCE_ID;
export const invoicexpressCreditNoteSequenceId = () => process.env.INVOICEXPRESS_CREDIT_NOTE_SEQUENCE_ID;

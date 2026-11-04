// InvoiceXpress -- client for the Sherlock Deal fiscal documents (Fatura-
// Recibo on payment, Nota de Credito on refund), all issued on the SHLK26
// series. Split the way billing.ts/stripe-env.ts already split Stripe: pure,
// testable payload builders here; the env reads live in invoicexpress-env.ts;
// the only I/O is the two fetch calls at the bottom.
//
// API v2 docs (invoicexpress.com/api-v2): auth is an api_key query-string
// param (no Bearer/OAuth), base URL is per-account
// (https://ACCOUNT.app.invoicexpress.com), and POST /invoice_receipts.json /
// POST /credit_notes.json share the same {"invoice": {...}} body shape.
// `proprietary_uid` makes creation idempotent -- a replayed request with the
// same uid gets the original document back (201) instead of creating a
// duplicate, which is exactly the Stripe-webhook-replay case this is built for.
export interface FiscalDetails {
  /** Org/company display name -- always required by InvoiceXpress. */
  name: string;
  /** NIF/NIPC. Null/blank -- by Nuno's decision (04/11/2026) -- is allowed:
   *  the document is then issued to "Consumidor Final" and the caller should
   *  have warned the founder about that before checkout, not here. */
  fiscalId?: string | null;
  email?: string | null;
  address?: string | null;
  postalCode?: string | null;
  city?: string | null;
  country?: string | null;
}

export interface InvoiceLineItem {
  name: string;
  description: string;
  unitPrice: number;
  quantity: number;
  /** e.g. "IVA23" -- omitted lets InvoiceXpress apply the account's default tax. */
  taxName?: string;
}

function ddmmyyyy(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

function clientPayload(client: FiscalDetails): Record<string, unknown> {
  const out: Record<string, unknown> = { name: client.name };
  if (client.fiscalId) out.fiscal_id = client.fiscalId;
  if (client.email) out.email = client.email;
  if (client.address) out.address = client.address;
  if (client.postalCode) out.postal_code = client.postalCode;
  if (client.city) out.city = client.city;
  if (client.country) out.country = client.country;
  return out;
}

export interface BuildDocumentOptions {
  date: Date;
  client: FiscalDetails;
  items: InvoiceLineItem[];
  sequenceId: string;
  /** Stripe invoice id (receipts) or charge/refund id (credit notes) -- the
   *  idempotency key so a Stripe webhook replay never creates a duplicate. */
  proprietaryUid: string;
  observations?: string;
  /** Credit notes only -- the InvoiceXpress id of the invoice being credited. */
  ownerInvoiceId?: string;
}

// Shared by both document types -- an invoice-receipt and a credit note send
// the exact same {"invoice": {...}} shape, only the owner_invoice_id differs.
export function buildDocumentPayload(opts: BuildDocumentOptions): { proprietary_uid: string; invoice: Record<string, unknown> } {
  const dateStr = ddmmyyyy(opts.date);
  const invoice: Record<string, unknown> = {
    date: dateStr,
    due_date: dateStr, // paid at creation (card charge) -- due date is the same day.
    client: clientPayload(opts.client),
    sequence_id: opts.sequenceId,
    items: opts.items.map((it) => ({
      name: it.name,
      description: it.description,
      unit_price: String(it.unitPrice),
      quantity: String(it.quantity),
      ...(it.taxName ? { tax: { name: it.taxName } } : {}),
    })),
  };
  if (opts.observations) invoice.observations = opts.observations;
  if (opts.ownerInvoiceId) invoice.owner_invoice_id = Number(opts.ownerInvoiceId); // an integer in the API
  return { proprietary_uid: opts.proprietaryUid, invoice };
}

export interface InvoiceXpressDocument {
  id: number | string;
  sequence_number?: string;
  atcud?: string;
  permalink?: string;
  status?: string;
}

export interface InvoiceXpressResult {
  ok: boolean;
  document?: InvoiceXpressDocument;
  error?: string;
}

type DocumentType = 'invoice_receipts' | 'credit_notes';
// The response's wrapper key is the singular of the path (docs.invoicexpress.com/v2,
// "Response wrapper key"), never a fixed `invoice`. The REQUEST body of a create
// or a change-state, on the other hand, is `invoice` for every type.
const RESPONSE_KEY: Record<DocumentType, string> = { invoice_receipts: 'invoice_receipt', credit_notes: 'credit_note' };

async function callApi(url: string, method: 'POST' | 'PUT', body: unknown, documentType: DocumentType): Promise<InvoiceXpressResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json; charset=utf-8', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, error: `InvoiceXpress request failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, error: `InvoiceXpress ${res.status}: ${text.slice(0, 300)}` };
  }
  const json = await res.json().catch(() => null) as Record<string, InvoiceXpressDocument> | null;
  const document = json?.[RESPONSE_KEY[documentType]];
  if (!document) return { ok: false, error: 'InvoiceXpress: unexpected response shape.' };
  return { ok: true, document };
}

// A created document is a DRAFT: it has no fiscal number, no ATCUD and is not
// communicated to the AT until it is finalized (docs: draft -> settled for an
// invoice_receipt, draft -> final for a credit_note, both with state
// "finalized"). So creating is two calls, and "ok" means both landed.
//
// Replays are safe at both steps: the same proprietary_uid answers 201 with
// the ORIGINAL document (not a 409), and a document that is already past draft
// is not finalized again (that would be a 422). A finalize that failed leaves
// a draft in InvoiceXpress and ok:false here; the next replay finds that same
// draft through the uid and finalizes it.
async function postDocument(
  accountName: string,
  apiKey: string,
  documentType: DocumentType,
  body: { proprietary_uid: string; invoice: Record<string, unknown> },
): Promise<InvoiceXpressResult> {
  const base = `https://${accountName}.app.invoicexpress.com/${documentType}`;
  const key = `api_key=${encodeURIComponent(apiKey)}`;
  const created = await callApi(`${base}.json?${key}`, 'POST', body, documentType);
  if (!created.ok || !created.document) return created;
  if (created.document.status && created.document.status !== 'draft') return created;
  const finalized = await callApi(`${base}/${created.document.id}/change-state.json?${key}`, 'PUT', { invoice: { state: 'finalized' } }, documentType);
  if (!finalized.ok) return { ok: false, error: `Created draft ${created.document.id} but could not finalize it: ${finalized.error}` };
  return finalized;
}

export function createInvoiceReceipt(accountName: string, apiKey: string, opts: BuildDocumentOptions) {
  return postDocument(accountName, apiKey, 'invoice_receipts', buildDocumentPayload(opts));
}

export function createCreditNote(accountName: string, apiKey: string, opts: BuildDocumentOptions) {
  return postDocument(accountName, apiKey, 'credit_notes', buildDocumentPayload(opts));
}

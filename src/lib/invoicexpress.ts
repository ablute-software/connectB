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
// `proprietary_uid` makes creation idempotent -- a concurrent/replayed
// request with the same uid 409s instead of creating a duplicate, which is
// exactly the Stripe-webhook-replay case this is built for.
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
  if (opts.ownerInvoiceId) invoice.owner_invoice_id = opts.ownerInvoiceId;
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
  /** 409 -- the same proprietary_uid already created a document; not an
   *  error, the caller should treat this the same as a fresh success and
   *  just skip (it has no id to report back, so the caller keeps whatever
   *  it already stored). */
  duplicate?: boolean;
  error?: string;
}

async function postDocument(
  accountName: string,
  apiKey: string,
  documentType: 'invoice_receipts' | 'credit_notes',
  body: { proprietary_uid: string; invoice: Record<string, unknown> },
): Promise<InvoiceXpressResult> {
  const url = `https://${accountName}.app.invoicexpress.com/${documentType}.json?api_key=${encodeURIComponent(apiKey)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, error: `InvoiceXpress request failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (res.status === 409) return { ok: false, duplicate: true, error: 'Already created (duplicate proprietary_uid).' };
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, error: `InvoiceXpress ${res.status}: ${text.slice(0, 300)}` };
  }
  const json = await res.json().catch(() => null) as { invoice?: InvoiceXpressDocument } | null;
  if (!json?.invoice) return { ok: false, error: 'InvoiceXpress: unexpected response shape.' };
  return { ok: true, document: json.invoice };
}

export function createInvoiceReceipt(accountName: string, apiKey: string, opts: BuildDocumentOptions) {
  return postDocument(accountName, apiKey, 'invoice_receipts', buildDocumentPayload(opts));
}

export function createCreditNote(accountName: string, apiKey: string, opts: BuildDocumentOptions) {
  return postDocument(accountName, apiKey, 'credit_notes', buildDocumentPayload(opts));
}

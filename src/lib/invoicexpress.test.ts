// The shapes below are the ones in docs.invoicexpress.com/v2 (read 04/11/2026): no live InvoiceXpress call has been made yet.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDocumentPayload, createCreditNote, createInvoiceReceipt, netAmountAndTaxFor, taxExemptionCodeFor, invoiceXpressTaxNameForPercent } from './invoicexpress';

const opts = {
  date: new Date(2026, 10, 4), client: { name: 'Acme', fiscalId: '500000000' }, sequenceId: '42', proprietaryUid: 'stripe-invoice-in_1',
  items: [{ name: 'Sub', description: 'd', unitPrice: 85, quantity: 1 }],
};
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

afterEach(() => vi.unstubAllGlobals());

describe('InvoiceXpress documents', () => {
  it('a new invoice-receipt is created and then finalized, and the finalized document is what comes back', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(reply(201, { invoice_receipt: { id: 7, status: 'draft' } }))
      .mockResolvedValueOnce(reply(200, { invoice_receipt: { id: 7, status: 'settled', permalink: 'p' } }));
    vi.stubGlobal('fetch', f);
    const r = await createInvoiceReceipt('acct', 'k', opts);
    expect(r).toEqual({ ok: true, document: { id: 7, status: 'settled', permalink: 'p' } });
    expect(f.mock.calls[0][0]).toBe('https://acct.app.invoicexpress.com/invoice_receipts.json?api_key=k');
    expect(f.mock.calls[1][0]).toBe('https://acct.app.invoicexpress.com/invoice_receipts/7/change-state.json?api_key=k');
    expect(JSON.parse(f.mock.calls[1][1].body)).toEqual({ invoice: { state: 'finalized' } });
  });

  it('a replay gets the original document back and does not finalize it twice', async () => {
    const f = vi.fn().mockResolvedValueOnce(reply(201, { invoice_receipt: { id: 7, status: 'settled' } }));
    vi.stubGlobal('fetch', f);
    expect((await createInvoiceReceipt('acct', 'k', opts)).ok).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('a draft that could not be finalized is a failure, never a document to stamp', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(reply(201, { invoice_receipt: { id: 7, status: 'draft' } }))
      .mockResolvedValueOnce(reply(422, { errors: [{ error: 'no' }] })));
    const r = await createInvoiceReceipt('acct', 'k', opts);
    expect(r.ok).toBe(false);
    expect(r.document).toBeUndefined();
  });

  it('a credit note reads its own wrapper key and credits the original by a numeric id', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(reply(201, { credit_note: { id: 8, status: 'draft' } }))
      .mockResolvedValueOnce(reply(200, { credit_note: { id: 8, status: 'final' } }));
    vi.stubGlobal('fetch', f);
    const r = await createCreditNote('acct', 'k', { ...opts, ownerInvoiceId: '7' });
    expect(r.document?.id).toBe(8);
    expect(JSON.parse(f.mock.calls[0][1].body).invoice.owner_invoice_id).toBe(7);
  });

  it('the body carries the series and the uid; dates are dd/mm/yyyy', () => {
    const b = buildDocumentPayload(opts);
    expect(b.proprietary_uid).toBe('stripe-invoice-in_1');
    expect(b.invoice.sequence_id).toBe('42');
    expect(b.invoice.date).toBe('04/11/2026');
  });
});


describe('IVA (Nuno, 04/11/2026): gross-to-net split and exemption codes', () => {
  it('a normal (non-exempt) charge splits into the net amount and the matching IVA name', () => {
    // 8000 net + 1840 tax (23% of 8000) = 9840 gross -> PT mainland rate.
    expect(netAmountAndTaxFor(9840, 1840, 'none')).toEqual({ netAmount: 80, taxName: 'IVA23' });
    // 8000 net + 1280 tax (16% of 8000) = 9280 gross -> Açores rate.
    expect(netAmountAndTaxFor(9280, 1280, 'none')).toEqual({ netAmount: 80, taxName: 'IVA16' });
  });

  it('refuses, rather than letting the account default apply, when no rate can be stated', () => {
    expect(netAmountAndTaxFor(8500, 0, 'none')).toBeNull();
    expect(netAmountAndTaxFor(10115, 1615, 'none')).toBeNull(); // 19%: a rate this account does not list
  });

  it('an EU B2B reverse-charge or a non-EU export names IVA0: with no tax name InvoiceXpress would add its default', () => {
    expect(netAmountAndTaxFor(8500, 0, 'reverse')).toEqual({ netAmount: 85, taxName: 'IVA0' });
    expect(netAmountAndTaxFor(8500, 0, 'exempt')).toEqual({ netAmount: 85, taxName: 'IVA0' });
  });

  it('with no NIF the client is Consumidor final, as the checkout step says', () => {
    const b = buildDocumentPayload({ ...opts, client: { name: 'Acme', fiscalId: null, address: 'x' } });
    expect(b.invoice.client).toEqual({ name: 'Consumidor final' });
  });

  it('picks the AT exemption code per Stripe\'s own classification, and none for a normally-taxed charge', () => {
    expect(taxExemptionCodeFor('none')).toBeUndefined();
    expect(taxExemptionCodeFor('exempt')).toBe('M19');
    expect(taxExemptionCodeFor('reverse')).toBe('M40');
  });

  it('names a tax by its rounded percentage', () => {
    expect(invoiceXpressTaxNameForPercent(23)).toBe('IVA23');
    expect(invoiceXpressTaxNameForPercent(22.6)).toBe('IVA23');
  });
});

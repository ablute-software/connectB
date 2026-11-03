// Prompt 927 (D) — the currencies of a call: the list, the decimals each one really has (checked against what Intl itself says), formatting in the language of the call, the search by code and by name,
// and the server refusing a currency that is not on the list.
import { describe, expect, it } from 'vitest';
const sp = (s: string) => s.replace(/\s/g, ' ');
import { CURRENCY_CODES, CURRENCY_LIST, currencyDecimals, formatMoney, isSupportedCurrency, localeOf, searchCurrencies } from './currencies';
import { formatNumberDisplay } from './form-logic';
import { CURRENCIES } from './types';
import { parseGeneralPatch } from './mappers';

describe('the list', () => {
  it('has the five that existed, the new ones and the MENA region — by ISO 4217 code, each once', () => {
    for (const c of ['EUR', 'USD', 'GBP', 'CHF', 'BRL', 'CNY', 'JPY', 'KRW', 'INR', 'SGD', 'HKD', 'AUD', 'CAD', 'AED', 'SAR', 'QAR', 'KWD', 'BHD', 'OMR', 'JOD', 'EGP', 'MAD', 'TND', 'DZD', 'TRY', 'ILS']) expect(CURRENCY_CODES, c).toContain(c);
    expect(new Set(CURRENCY_CODES).size).toBe(CURRENCY_CODES.length);
    expect(CURRENCIES).toEqual(CURRENCY_CODES);                                             // the one list the server validates against
    expect(CURRENCY_LIST.every((c) => /^[A-Z]{3}$/.test(c.code) && c.name.length > 2)).toBe(true);
  });
  it('the decimals are the right ones: none for JPY and KRW, three for KWD, BHD, OMR, JOD and TND, two for the rest — and they agree with Intl', () => {
    for (const c of ['JPY', 'KRW']) expect(currencyDecimals(c), c).toBe(0);
    for (const c of ['KWD', 'BHD', 'OMR', 'JOD', 'TND']) expect(currencyDecimals(c), c).toBe(3);
    for (const c of ['EUR', 'USD', 'GBP', 'AED', 'EGP', 'MAD', 'DZD', 'TRY', 'ILS', 'CNY', 'INR']) expect(currencyDecimals(c), c).toBe(2);
    for (const c of CURRENCY_LIST) expect(new Intl.NumberFormat('en', { style: 'currency', currency: c.code }).resolvedOptions().maximumFractionDigits, c.code).toBe(c.decimals);
  });
});

describe('formatting, in the language of the call', () => {
  it('whole amounts show no decimals; a fraction shows up to the currency\'s own decimals and never more', () => {
    expect(formatMoney(500000, 'EUR', 'en')).toBe('€500,000');
    expect(formatMoney('500000', 'EUR', 'pt').replace(/\s/g, ' ')).toBe('500 000 €');
    expect(sp(formatMoney(150000, 'JPY', 'en'))).toBe('JP¥150,000');
    expect(sp(formatMoney(1234.5678, 'JPY', 'en'))).toBe('JP¥1,235');                              // yen has no decimals
    expect(sp(formatMoney(1500, 'KWD', 'en'))).toBe('KWD 1,500');
    expect(sp(formatMoney(1500.1234, 'KWD', 'en'))).toBe('KWD 1,500.123');                       // three decimals
    expect(formatMoney(10.456, 'EUR', 'en')).toBe('€10.46');
    expect(formatMoney('abc', 'EUR', 'en')).toBe('');
  });
  it('the language of the call picks the locale; an unknown one falls back to English', () => {
    expect(localeOf('pt')).toBe('pt-PT'); expect(localeOf('de')).toBe('de-DE'); expect(localeOf('xx')).toBe('en-GB'); expect(localeOf(null)).toBe('en-GB');
    expect(formatMoney(2500, 'USD', 'de').replace(/\s/g, ' ')).toBe('2.500 $');
  });
  it('a Number question keeps its plain layout without a language, and uses Intl with one', () => {
    expect(formatNumberDisplay('500000', 'EUR').replace(/\s/g, ' ')).toBe('500 000 €');
    expect(formatNumberDisplay('500000', 'EUR', 'en')).toBe('€500,000');
    expect(sp(formatNumberDisplay('500000', 'KWD', 'en'))).toBe('KWD 500,000');
    expect(formatNumberDisplay('', 'EUR', 'en')).toBe('');
    expect(formatNumberDisplay('500000', null, 'en')).toBe('500 000'.replace(' ', ' '));
  });
});

describe('the search', () => {
  it('by code or by name, without accents or case; the most used first when nothing is typed', () => {
    expect(searchCurrencies('').slice(0, 3).map((c) => c.code)).toEqual(['EUR', 'USD', 'GBP']);
    expect(searchCurrencies('jpy').map((c) => c.code)).toEqual(['JPY']);
    expect(searchCurrencies('DINAR').map((c) => c.code)).toEqual(['BHD', 'DZD', 'JOD', 'KWD', 'TND']);
    expect(searchCurrencies('yuan').map((c) => c.code)).toEqual(['CNY']);
    expect(searchCurrencies('euro')[0].code).toBe('EUR');
    expect(searchCurrencies('us')[0].code).toBe('USD');                                       // the code that starts with it, before the names that contain it
    expect(searchCurrencies('zzzz')).toEqual([]);
  });
});

describe('the server', () => {
  const current = { opensAt: null, closesAt: null };
  it('accepts every currency on the list and refuses one that is not', () => {
    for (const c of ['JPY', 'KWD', 'TND', 'ILS', 'AED']) expect(parseGeneralPatch({ currency: c }, current), c).toMatchObject({ ok: true });
    expect(parseGeneralPatch({ currency: 'XXX' }, current)).toMatchObject({ ok: false, error: 'Unsupported currency.' });
    expect(parseGeneralPatch({ currency: 'jpy' }, current)).toMatchObject({ ok: false });
    expect(isSupportedCurrency('KRW')).toBe(true); expect(isSupportedCurrency('krw')).toBe(false); expect(isSupportedCurrency(5)).toBe(false);
  });
});

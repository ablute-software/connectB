// Prompt 927 (D) — the currencies a call can use, in ONE place (docs/ops/CONFIG_REGISTRY.md lists them too): the ISO 4217 code, the name (what the selector searches), and the decimals the currency really has
// (JPY and KRW none; KWD, BHD, OMR, JOD and TND three; the rest two). Amounts are formatted with Intl.NumberFormat in the language of the call, so the symbol, the grouping and the position of the symbol are
// the ones that language's readers expect. Pure: no React, no server.

export interface Currency { code: string; name: string; decimals: 0 | 2 | 3 }

/** Shown first in the selector, in this order. */
export const POPULAR_CURRENCIES = ['EUR', 'USD', 'GBP'] as const;

const L = (code: string, name: string, decimals: 0 | 2 | 3 = 2): Currency => ({ code, name, decimals });

/** The three most used first, then the rest by code. The five that existed before (EUR, USD, GBP, CHF, BRL) are all here. */
export const CURRENCY_LIST: readonly Currency[] = [
  L('EUR', 'Euro'), L('USD', 'US dollar'), L('GBP', 'Pound sterling'),
  L('AED', 'UAE dirham'), L('AUD', 'Australian dollar'), L('BHD', 'Bahraini dinar', 3), L('BRL', 'Brazilian real'), L('CAD', 'Canadian dollar'), L('CHF', 'Swiss franc'),
  L('CNY', 'Chinese yuan'), L('DZD', 'Algerian dinar'), L('EGP', 'Egyptian pound'), L('HKD', 'Hong Kong dollar'), L('ILS', 'Israeli new shekel'), L('INR', 'Indian rupee'),
  L('JOD', 'Jordanian dinar', 3), L('JPY', 'Japanese yen', 0), L('KRW', 'South Korean won', 0), L('KWD', 'Kuwaiti dinar', 3), L('MAD', 'Moroccan dirham'), L('OMR', 'Omani rial', 3),
  L('QAR', 'Qatari riyal'), L('SAR', 'Saudi riyal'), L('SGD', 'Singapore dollar'), L('TND', 'Tunisian dinar', 3), L('TRY', 'Turkish lira'),
];

export const CURRENCY_CODES = CURRENCY_LIST.map((c) => c.code) as readonly string[];

export const isSupportedCurrency = (code: unknown): code is string => typeof code === 'string' && CURRENCY_CODES.includes(code);

/** Decimals of a currency (2 when it is not on the list). */
export const currencyDecimals = (code: string): 0 | 2 | 3 => CURRENCY_LIST.find((c) => c.code === code)?.decimals ?? 2;

export const currencyName = (code: string): string => CURRENCY_LIST.find((c) => c.code === code)?.name ?? code;

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** The currencies that match what was typed, by code or by name (no accents, any case); the most used first. Nothing typed: the whole list. */
export function searchCurrencies(query: string): Currency[] {
  const q = fold(query.trim());
  if (!q) return [...CURRENCY_LIST];
  const hit = CURRENCY_LIST.filter((c) => fold(c.code).includes(q) || fold(c.name).includes(q));
  const rank = (c: Currency) => (fold(c.code) === q ? 0 : fold(c.code).startsWith(q) ? 1 : 2);
  const pop = (c: Currency) => { const i = (POPULAR_CURRENCIES as readonly string[]).indexOf(c.code); return i < 0 ? 99 : i; };
  return hit.sort((a, b) => rank(a) - rank(b) || pop(a) - pop(b) || a.code.localeCompare(b.code));
}

/** The language of the call as an Intl locale (the call's languages are the six it can be written in). */
const LOCALES: Record<string, string> = { en: 'en-GB', pt: 'pt-PT', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', it: 'it-IT' };
export const localeOf = (language?: string | null): string => LOCALES[language ?? ''] ?? 'en-GB';

/**
 * An amount in the language of the call: "€500,000" (en), "500 000 €" (pt), "KWD 1,500" … Whole amounts show no decimals; one with a fraction shows up to the currency's own decimals (never more: yen has none,
 * the Kuwaiti dinar has three). `amount` may be a number or the digits the field holds.
 */
export function formatMoney(amount: number | string, currency: string, language?: string | null): string {
  const n = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(n)) return '';
  const code = currency;
  try {
    return new Intl.NumberFormat(localeOf(language), { style: 'currency', currency: code, minimumFractionDigits: 0, maximumFractionDigits: currencyDecimals(code) }).format(n);
  } catch {
    return `${n} ${currency}`;
  }
}

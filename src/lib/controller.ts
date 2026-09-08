// Prompt 624 §B — WHO the data controller is, in one place.
//
// The question "is it Sherlock Deal, Lda or Exotictarget, Lda?" blocked three
// parts of the Article 14 work for a day, and it should never have been a
// question: the answer was already in the Terms, in the billing settings, and
// in ablute_'s own `orgs.legal_name`. What it was NOT in was anywhere a
// session reading the schema could find it — and `orgs.legal_name` actively
// misleads, because it is the legal name of a TENANT: ablute_'s says
// "Exotictarget, Lda" and the Sherlock Deal test org's says "Sherlock Deal,
// Lda". Two rows saying different things, neither of them naming the entity
// that operates the platform.
//
// So this is a constant, not a column. It is a fact about the COMPANY, not
// about an org; it does not vary per tenant and it must not be discoverable
// only by reading prose. When Sherlock Deal becomes its own company, this
// changes here and nowhere else.
//
// Nuno, 2026-09-08: "tudo para já refere a representação legal como
// Exotictarget, Lda — até que ganhe maturidade para ser spinoff e possa abrir
// a própria empresa."

/** The entity that operates the platform and is the controller for its own processing. */
export const CONTROLLER_LEGAL_NAME = 'Exotictarget, Lda';

/** Portuguese company and tax number, as stated in the Terms (v1, Provider clause). */
export const CONTROLLER_NIPC = '515206415';

/** Registered office, as stated in the Terms. */
export const CONTROLLER_ADDRESS = 'Rua Salvato Feijó, Torre Active Centre, Y, 4900-415 Viana do Castelo, Portugal';

/**
 * Prompt 616 §C — how long a catalogue entry with no activity is kept.
 * Article 14(2)(a) requires a period or the criteria for one; "forever" is
 * neither defensible nor true. Nuno's number, ratified 2026-09-08.
 */
export const CATALOG_RETENTION_MONTHS = 24;

/**
 * Where a data-rights request or a privacy question goes. Deliberately NOT
 * defaulted to a support address: Article 14(1)(b) asks for the controller's
 * contact details, and pointing that at a general helpdesk is the kind of
 * answer that is technically true and practically useless.
 *
 * Null until Nuno sets it — the surfaces that need it must say so rather than
 * invent one, which is why this is `string | null` and not a placeholder.
 */
export const PRIVACY_CONTACT_EMAIL: string | null = process.env.NEXT_PUBLIC_PRIVACY_EMAIL || null;

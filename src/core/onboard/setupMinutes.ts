/**
 * Block 4.4 — shared view contracts and deterministic fixtures.
 * No parsing, persistence, credential exchange, sending or clock reads live here.
 * Contacts import is owner-only; matching never overwrites an existing customer
 * and importing grants no consent. These types do not replace the five Setup steps.
 */

export const CONTACT_IMPORT_COLUMNS = ['name', 'phone', 'language', 'notes'] as const;
export type ContactImportColumn = typeof CONTACT_IMPORT_COLUMNS[number];

/** Zero-based source column indexes; null means unmapped. Phone must be mapped before Check. */
export type ContactImportMapping = Readonly<Record<ContactImportColumn, number | null>>;
export type ContactImportFields = Readonly<Record<ContactImportColumn, string>>;

/** The kept table as shown on Columns, before row validation. */
export type ContactImportColumns = {
  readonly importId: string;
  readonly hasHeader: boolean;
  readonly headers: readonly string[];
  /** Source records, excluding the header when hasHeader is true. */
  readonly rows: readonly (readonly string[])[];
  readonly mapping: ContactImportMapping;
};

export type ContactImportFileRefusal =
  | 'not_a_table'
  | 'empty'
  | 'too_large'
  | 'too_many'
  | 'encoding'
  | 'no_phone_column';

export type ContactImportRowRefusal =
  | 'no_phone'
  | 'not_international'
  | 'bad_phone'
  | 'language_not_recognised'
  | 'long_name'
  | 'long_notes'
  | 'ambiguous_existing';

/** Validated values. Blank optional fields become null; nothing is truncated. */
export type ImportedContact = {
  readonly name: string | null;
  /** Canonical digits only, as normalizePhone returns; input must explicitly use + or 00. */
  readonly phone: string;
  /** Recognised two-letter code; an unrecognised nonempty language refuses the row. */
  readonly language: string | null;
  readonly notes: string | null;
};

export type ContactImportVerdict =
  /** Eligible, not yet written. Only these rows have selection controls. */
  | { readonly kind: 'to_add'; readonly contact: ImportedContact; readonly selected: boolean }
  | {
    readonly kind: 'existing';
    readonly contact: ImportedContact;
    readonly customer: { readonly id: string; readonly name: string | null };
  }
  /** First occurrence owns the number, even when that earlier row is refused or unticked. */
  | { readonly kind: 'duplicate_in_file'; readonly firstRow: number }
  | { readonly kind: 'refused'; readonly reason: ContactImportRowRefusal };

export type ContactImportPreviewRow = {
  /** One-based source record number, including the header if present; never renumber after filtering. */
  readonly row: number;
  /** Mapped cells exactly as supplied, for the refusal and existing-customer comparisons. */
  readonly raw: ContactImportFields;
  readonly verdict: ContactImportVerdict;
};

export type ContactImportCounts = {
  /** total = toAdd + existing + duplicateInFile + refused. Blank records are excluded. */
  readonly total: number;
  readonly toAdd: number;
  readonly existing: number;
  readonly duplicateInFile: number;
  /** Other refused rows; the Can't be added group is refused + duplicateInFile. */
  readonly refused: number;
  /** Selected subset of toAdd, used in the final button. */
  readonly selected: number;
};

export type ContactImportPreview = {
  readonly importId: string;
  readonly rows: readonly ContactImportPreviewRow[];
  readonly counts: ContactImportCounts;
};

/** Counts after the transaction rechecks phones. No retained customer rows or credentials. */
export type ContactImportConfirmResult = {
  /** total = added + existing + notSelected + duplicateInFile + refused. */
  readonly total: number;
  readonly added: number;
  readonly existing: number;
  /** Subset of existing: selected rows that became customers after the preview. */
  readonly newlyMatched: number;
  readonly notSelected: number;
  readonly duplicateInFile: number;
  readonly refused: number;
};

/**
 * Request-only fields: a token OR a complete client ID/secret pair, used once.
 * Never persist, log or pass this type to a renderer. The reader offers only
 * ACTIVE products and checks the shop currency against the workspace's currency.
 */
export type ShopifyFormFields = {
  readonly address: string;
  readonly token: string;
  readonly client_id: string;
  readonly client_secret: string;
};

export type ShopifyRefusal =
  | 'password_protected'
  | 'shop_not_permitted'
  | 'application_cannot_be_found'
  | 'exchange_401'
  | 'token_401'
  | 'scope_missing_read_products'
  | 'not_found'
  | 'rate_limited'
  | 'timeout'
  | 'redirect'
  | 'currency_mismatch'
  | 'neither_way'
  | 'both_ways'
  | 'half_pair'
  | 'not_myshopify'
  // Other refusals named by the form specification; never raw provider messages.
  | 'spaces'
  | 'unavailable'
  | 'no_products';

/** Safe state for initial and refused forms. Credential inputs are always empty. */
export type ShopifyForm = {
  /** Validated store address only (no userinfo, query or fragment), or empty if invalid. */
  readonly address: string;
  readonly token: '';
  readonly client_id: '';
  readonly client_secret: '';
  readonly refusal: ShopifyRefusal | null;
};

/** Historical first-reached times, independent of the current five-step readiness count. */
export type SetupMilestones = {
  /** null for an operator-created workspace: show dates, with no stopwatch. */
  readonly signedUpAt: Date | null;
  readonly productsIn: Date | null;
  readonly contactsIn: Date | null;
  readonly channelConnected: Date | null;
  readonly firstReply: Date | null;
};

export const SETUP_MILESTONE_KEYS = ['productsIn', 'contactsIn', 'channelConnected', 'firstReply'] as const;
export type SetupMilestoneKey = typeof SETUP_MILESTONE_KEYS[number];


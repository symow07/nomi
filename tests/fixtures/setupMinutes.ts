import type { ContactImportColumns, ContactImportPreview, ContactImportConfirmResult, ShopifyForm, ShopifyRefusal, SetupMilestones } from '../../src/core/onboard/setupMinutes.js';

// Synthetic customers and reserved fictional phone numbers; fixed dates, never Date.now().
export const FIXTURE_CONTACT_IMPORT_COLUMNS: ContactImportColumns = {
  importId: '00000000-0000-4000-8000-000000000044',
  hasHeader: true,
  headers: ['Full name', 'Phone', 'Language', 'Notes'],
  rows: [
    ['Avery Example', '+1 (202) 555-0101', 'English', 'Ask about blue.'],
    ['Blair Example', '0012025550102', '', ''],
    ['Casey from file', '+1 202 555 0103', 'fr', 'Keep the existing record.'],
    ['Avery again', '+12025550101', '', ''],
    ['No number', '', '', ''],
    ['Local number', '2025550104', '', ''],
    ['Invalid number', '+1-CALL-ME', '', ''],
    ['Unknown language', '+12025550105', 'unrecognised language', ''],
    ['N'.repeat(121), '+12025550106', '', ''],
    ['Long notes', '+12025550107', '', 'N'.repeat(1001)],
    ['Ambiguous match', '+12025550108', '', ''],
  ],
  mapping: { name: 0, phone: 1, language: 2, notes: 3 },
};

export const FIXTURE_CONTACT_IMPORT_PREVIEW: ContactImportPreview = {
  importId: FIXTURE_CONTACT_IMPORT_COLUMNS.importId,
  rows: [
    {
      row: 2,
      raw: { name: 'Avery Example', phone: '+1 (202) 555-0101', language: 'English', notes: 'Ask about blue.' },
      verdict: { kind: 'to_add', selected: true, contact: { name: 'Avery Example', phone: '12025550101', language: 'en', notes: 'Ask about blue.' } },
    },
    {
      row: 3,
      raw: { name: 'Blair Example', phone: '0012025550102', language: '', notes: '' },
      verdict: { kind: 'to_add', selected: true, contact: { name: 'Blair Example', phone: '12025550102', language: null, notes: null } },
    },
    {
      row: 4,
      raw: { name: 'Casey from file', phone: '+1 202 555 0103', language: 'fr', notes: 'Keep the existing record.' },
      verdict: {
        kind: 'existing',
        contact: { name: 'Casey from file', phone: '12025550103', language: 'fr', notes: 'Keep the existing record.' },
        customer: { id: '00000000-0000-4000-8000-000000000103', name: 'Casey on record' },
      },
    },
    {
      row: 5,
      raw: { name: 'Avery again', phone: '+12025550101', language: '', notes: '' },
      verdict: { kind: 'duplicate_in_file', firstRow: 2 },
    },
    {
      row: 6,
      raw: { name: 'No number', phone: '', language: '', notes: '' },
      verdict: { kind: 'refused', reason: 'no_phone' },
    },
    {
      row: 7,
      raw: { name: 'Local number', phone: '2025550104', language: '', notes: '' },
      verdict: { kind: 'refused', reason: 'not_international' },
    },
    {
      row: 8,
      raw: { name: 'Invalid number', phone: '+1-CALL-ME', language: '', notes: '' },
      verdict: { kind: 'refused', reason: 'bad_phone' },
    },
    {
      row: 9,
      raw: { name: 'Unknown language', phone: '+12025550105', language: 'unrecognised language', notes: '' },
      verdict: { kind: 'refused', reason: 'language_not_recognised' },
    },
    {
      row: 10,
      raw: { name: 'N'.repeat(121), phone: '+12025550106', language: '', notes: '' },
      verdict: { kind: 'refused', reason: 'long_name' },
    },
    {
      row: 11,
      raw: { name: 'Long notes', phone: '+12025550107', language: '', notes: 'N'.repeat(1001) },
      verdict: { kind: 'refused', reason: 'long_notes' },
    },
    {
      row: 12,
      raw: { name: 'Ambiguous match', phone: '+12025550108', language: '', notes: '' },
      verdict: { kind: 'refused', reason: 'ambiguous_existing' },
    },
  ],
  counts: { total: 11, toAdd: 2, existing: 1, duplicateInFile: 1, refused: 7, selected: 2 },
};

/** The second selected customer arrived meanwhile: one added, one newly matched, no overwrite. */
export const FIXTURE_CONTACT_IMPORT_CONFIRM: ContactImportConfirmResult = {
  total: 11, added: 1, existing: 2, newlyMatched: 1, notSelected: 0, duplicateInFile: 1, refused: 7,
};

export const FIXTURE_SHOPIFY_FORM: ShopifyForm = {
  address: 'https://example.myshopify.com', token: '', client_id: '', client_secret: '', refusal: null,
};

export const FIXTURE_SHOPIFY_REFUSALS: Readonly<Record<ShopifyRefusal, ShopifyForm>> = {
  password_protected: { ...FIXTURE_SHOPIFY_FORM, refusal: 'password_protected' },
  shop_not_permitted: { ...FIXTURE_SHOPIFY_FORM, refusal: 'shop_not_permitted' },
  application_cannot_be_found: { ...FIXTURE_SHOPIFY_FORM, refusal: 'application_cannot_be_found' },
  exchange_401: { ...FIXTURE_SHOPIFY_FORM, refusal: 'exchange_401' },
  token_401: { ...FIXTURE_SHOPIFY_FORM, refusal: 'token_401' },
  scope_missing_read_products: { ...FIXTURE_SHOPIFY_FORM, refusal: 'scope_missing_read_products' },
  not_found: { ...FIXTURE_SHOPIFY_FORM, refusal: 'not_found' },
  rate_limited: { ...FIXTURE_SHOPIFY_FORM, refusal: 'rate_limited' },
  timeout: { ...FIXTURE_SHOPIFY_FORM, refusal: 'timeout' },
  redirect: { ...FIXTURE_SHOPIFY_FORM, refusal: 'redirect' },
  currency_mismatch: { ...FIXTURE_SHOPIFY_FORM, refusal: 'currency_mismatch' },
  neither_way: { ...FIXTURE_SHOPIFY_FORM, refusal: 'neither_way' },
  both_ways: { ...FIXTURE_SHOPIFY_FORM, refusal: 'both_ways' },
  half_pair: { ...FIXTURE_SHOPIFY_FORM, refusal: 'half_pair' },
  not_myshopify: { ...FIXTURE_SHOPIFY_FORM, address: '', refusal: 'not_myshopify' },
  spaces: { ...FIXTURE_SHOPIFY_FORM, refusal: 'spaces' },
  unavailable: { ...FIXTURE_SHOPIFY_FORM, refusal: 'unavailable' },
  no_products: { ...FIXTURE_SHOPIFY_FORM, refusal: 'no_products' },
};

/** Draw the running fixture at this supplied instant: 20 minutes since sign-up. */
export const FIXTURE_SETUP_NOW = new Date('2026-11-07T10:20:00.000Z');

export const FIXTURE_SETUP_MILESTONES: SetupMilestones = {
  signedUpAt: new Date('2026-11-07T10:00:00.000Z'),
  productsIn: new Date('2026-11-07T10:04:00.000Z'),
  contactsIn: null,
  channelConnected: new Date('2026-11-07T10:12:00.000Z'),
  firstReply: null,
};

export const FIXTURE_SETUP_MILESTONES_PENDING: SetupMilestones = {
  signedUpAt: new Date('2026-11-07T10:00:00.000Z'),
  productsIn: null, contactsIn: null, channelConnected: null, firstReply: null,
};

export const FIXTURE_SETUP_MILESTONES_DONE: SetupMilestones = {
  ...FIXTURE_SETUP_MILESTONES,
  contactsIn: new Date('2026-11-07T10:08:00.000Z'),
  firstReply: new Date('2026-11-07T10:18:00.000Z'),
};

export const FIXTURE_SETUP_MILESTONES_OPERATOR: SetupMilestones = {
  ...FIXTURE_SETUP_MILESTONES, signedUpAt: null,
};

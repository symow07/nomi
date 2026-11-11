import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { inflateRawSync, inflateSync } from 'node:zlib';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import Fastify from 'fastify';
import pg from 'pg';
import { demoSeedSql } from '../../src/demo/factory.js';
import { ensureQueueSchema } from './tenant.js';
import { purgeBusinesses } from './books-db.js';
import { heldBy, type Held } from './authzHeld.js';
import { FLASH_REFUSALS } from '../../src/core/owner/flashTone.js';

/**
 * The authorization audit (Block 7) — WORKSPACE A'S OWNER, EVERY ROUTE, WORKSPACE B'S IDS. STATE, NOT STATUS.
 *
 * Signed in as A's owner (the most a session can do), the web app's routes are called with B's ids, and what is
 * judged is what the DATABASE holds afterwards, never what a route answered. Six passes:
 *
 *   1. every route, each of B's ids in every path parameter, every id field and the query (urlencoded; GET by query);
 *   2. the same as JSON, for every route that takes a body;
 *   3. multipart, for every route whose handler reads a file, with a small file and the fields it reads;
 *   4. ONE OF B'S IDS AMONG A'S OWN: for each id field a handler reads (by its own source), that field is one of B's
 *      ids of the matching table and every other id is A's own, with plain values in the words a form wants first —
 *      a route that needs A's own account beside B's journal line now reaches the line (the bank match, finding 1);
 *   5. A'S REAL FORMS: A's pages are crawled while A is intact, every form found is submitted as drawn, with one
 *      id-holding field (or an id in its address) swapped for each of B's ids of the same table;
 *   6. B'S OWN REQUESTS UNDER A'S SESSION (fix round 3, F1): every form B's own pages draw, as drawn, and every route as
 *      B's owner would call it — B's ids TOGETHER (a conversation and its proposal, a sequence and its enrolment).
 *
 * In every pass B's ids go in the QUERY of a POST as they go in its body (F3), B's workspace id among them.
 *
 * An id field is any field the audit's list names, any name ending in `Id`/`_id` that src/api spells, `reading`, and
 * any form field that holds a UUID. Then, over the database:
 *
 *   a. B is untouched — every row of every table that holds B's workspace, and every row of a table that hangs off
 *      one of them by a key (messages, price tiers …), reads byte for byte as before;
 *   b. no A row holds any of B's ids — anywhere in the row, key or text or JSON (`assigned_to`, an event's payload);
 *   c. no single-column key between two workspace tables points from A to B or back;
 *   d. nothing of B is shown — B's rows carry a marker in their words and B's files in their bytes, and no answer or
 *      redirect contains it: not a page, not a picture, not an entry of a zip or workbook once opened, not a PDF's
 *      streams. An answer that is not words must be bytes A keeps or this walk sent, or it fails (F2);
 *   e. no route answered 5xx.
 *
 * What it still cannot see: a value no form of A draws and no handler names (a typed confirmation of a name it does not
 * know), the public token pages and the web chat, the signed provider webhooks, and providers this composition does
 * not configure. Those are named in the audit's report.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;
const RUN = randomUUID().replace(/-/g, '').slice(0, 7);
const NS_A = `a${RUN}`;
const NS_B = `b${RUN}`;
const A = `${NS_A}-0000-4000-8000-0000000000b1`;
const B = `${NS_B}-0000-4000-8000-0000000000b1`;
const A_CONV = `${NS_A}-0000-4000-8000-000000000301`;
const MARK = `zqb${RUN}`;
const A_MARK = `zqa${RUN}`;
/** C: A's twin, in a session of its own. The walk asks C, with C's own ids, whether each route gets past its words. */
const NS_C = `c${RUN}`;
const C = `${NS_C}-0000-4000-8000-0000000000b1`;
const C_MARK = `zqc${RUN}`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const CODE = `authz-walk-${RUN}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_IN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Every form field name src/api reads that can carry an id (the audit's field list, 2026-11-11), and `reading`. */
const LISTED_ID_FIELDS = ['account', 'account_id', 'assistant', 'back', 'category', 'clientId', 'conversationId', 'draftId', 'entry', 'entryId',
  'id', 'ids', 'import', 'importId', 'invoice', 'invoiceId', 'item', 'itemId', 'journal', 'journalLine', 'label', 'labelId', 'line',
  'match', 'messageId', 'number_id', 'orderId', 'page_id', 'party', 'partyId', 'payFrom', 'pay_from', 'person', 'personId', 'photo',
  'product', 'productId', 'proposal', 'proposalId', 'quoteId', 'realmId', 'recurring', 'request', 'requestId', 'run', 'runId',
  'scenarioId', 'saved', 'sequence', 'source', 'sourceId', 'subscription', 'supplier', 'supplierId', 'tax', 'taxCode', 'tax_code', 'thread',
  'to', 'waba_id', 'year', 'result', 'category_id', 'party_id', 'tax_code_id', 'substitute', 'substituteId', 'procedure', 'case', 'check', 'reading',
  ...['businessId', 'business_id', 'business', 'workspace', 'workspaceId', 'workspace_id', 'tenant', 'tenantId']];
/** The fields that name a WORKSPACE (R3): B's own id goes there wherever the walk offers B's ids, and A's among A's own. */
const BUSINESS_FIELDS = new Set(['businessId', 'business_id', 'business', 'workspace', 'workspaceId', 'workspace_id', 'tenant', 'tenantId']);
/** Plain values, so a route that wants words before it reads an id gets as far as the id (a name, a floor, a rate …). */
const WORDS: Record<string, string> = {
  confirm: 'yes', note: 'authz', text: 'authz', content: 'authz', reply: 'authz', title: 'authz', kind: 'faq', body: 'authz', amount: '1',
  date: '2026-04-20', name: 'Authz Walk', price: '3', floor: '0.5', maxDiscountPct: '10', askAbovePct: '5', rate: '7', level: 'sells',
  phone: '+971500009999', domain: 'example.com', selector: 's1', which: 'owner_ready', channel: 'whatsapp', enabled: 'true',
  locale: 'en', tone: 'plain', length: 'short', emoji: 'never', gross: '100', label_text: 'authz', quantity: '1', minQty: '10',
  // What the reach check found a route refused for, without them (R1, 2026-11-12): a schedule's first day and how often.
  firstOn: '2026-05-01', every: 'month',
  // … a word to forbid, a number to ask about, a volume discount, a fact's text (R1, the reach list).
  term: 'authzterm', number: '+971500009998', discountPct: '5', fact: 'authz', email: 'authz@example.com',
};
/**
 * Words one route needs and another reads differently (R1): the live line's mark, whose shape is the page's kind; a
 * calendar entry's times against a closure's days (both are `from` / `to`). Sent with that route's own calls and B's.
 */
const ROUTE_WORDS: Record<string, Record<string, string>> = {
  '/app/live/home': { since: '0.0.0.0.0.0' }, '/app/live/today': { since: '0.0.0.0.0.0' }, '/app/live/buyers': { since: '0.0000000000000000' },
  '/app/live/channels': { since: '0.0000000000000000' }, '/app/live/billing': { since: '0.none' }, '/app/live/rail': { since: '0' },
  '/app/live/conversation/:conversationId': { since: '0.0.00000000' }, '/app/live/practice': { since: '0.0.00000000' },
  '/app/calendar/entries': { day: '2026-12-01', from: '', to: '' },
  // `@key`: the workspace's own seeded row (never put in B's calls: there, the field holds B's id).
  '/app/books/invoices/:id/payments': { paidOn: '2026-04-25', arrived: '' }, '/app/books/invoices/:id/refunds': { paidOn: '2026-04-25', arrived: '' },
  '/app/inbox/:conversationId/act': { draftId: '@draft4', command: '不回' },
  '/app/inbox/:conversationId/invoice/send': { invoice: '@invoiceIssued' },
  ...Object.fromEntries(['/app/contacts', '/app/contacts/consent', '/app/contacts/suppress', '/app/contacts/write', '/app/contacts/lookup'].map((u) =>
    [u, { channel: 'email', identity: 'lead@example.com', name: 'Authz lead', company: '', note: 'authz' }])),
  '/app/sequences/:id/steps': { delayDays: '1', subject: 'Hi', body: 'Step authz' },
  '/app/prospects/add': { sourceId: 'authz-1', name: 'Authz prospect', title: '', organization: '', back: '' },
  '/app/sandbox/message': { text: 'authz', expected: '' }, '/app/advisor/consent': { choice: 'allow' }, '/app/customers/import/:id/select': { selection: 'all' },
  '/app/settings/business': { kind: 'manufacturer', country: 'MA', website: '' }, '/app/inbox/:conversationId/order/step-in': { proposalId: '@orderProposal2' }, '/app/channels/approval': { page: 'https://www.instagram.com/authzshop' },
  '/app/books/fields': { key: 'authz_g', label: 'Authz field', kind: 'text', appliesTo: 'entry', choices: '', required: '' },
  '/app/books/parties': { code: 'AUTHZ2', name: 'Authz party', country: '', ice: '', taxNumber: '', address: '' },
  '/app/settings/alerts/channel': { channel: 'email' }, '/app/help/write': { words: 'authz' },
  '/app/books/spending/bills': { ref: 'B-2', date: '2026-04-21', gross: '12', noref: '', label: 'Bill authz', category: '@category', account: '', payFrom: '@bank', tax: '', supplier: '', newSupplier: 'Authz supplier', ads: '' },
  '/app/books/closing/start': { day: '2026-04-01', length: 'month' }, '/app/books/closing/reopen': { reason: 'authz', day: '' }, '/app/books/closing/lock': { day: '2026-10-31' }, '/app/inbox/:conversationId/maybe-yes/order': { quantity: '10' },
  // Two balanced lines of an entry; one line of an invoice; one line given back on a credit note (the other lines
  // of a drawn form left empty, as a person leaves them).
  ...Object.fromEntries(['/app/books/entries', '/app/books/entries/:id/edit'].map((u) => [u, { journal: '@journal', date: '2026-04-20', label: 'Entry authz', documentRef: 'D-1', documentDate: '2026-04-20',
    account0: '@bank', debit0: '10', credit0: '', account1: '@receivable', debit1: '', credit1: '10',
    ...Object.fromEntries([2, 3, 4, 5, 6, 7].flatMap((i) => [[`account${i}`, ''], [`debit${i}`, ''], [`credit${i}`, ''], [`party${i}`, ''], [`tax${i}`, ''], [`label${i}`, '']])) }])),
  ...Object.fromEntries(['/app/books/invoices', '/app/books/invoices/:id/edit'].map((u) => [u, { party: '@party', issueDate: '2026-04-20', dueDate: '', currency: 'MAD',
    account0: '@income', quantity0: '1', price0: '100', label0: 'Line authz', tax0: '',
    ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7].flatMap((i) => [[`account${i}`, ''], [`quantity${i}`, ''], [`price${i}`, ''], [`label${i}`, ''], [`tax${i}`, '']])) }])),
  ...Object.fromEntries(['/app/books/invoices/:id/credit-notes', '/app/books/credit-notes/:id/edit'].map((u) => [u, { reason: 'authz', issueDate: '2026-04-22', qty1: '1' }])), '/app/inbox/:conversationId/translate': { draftId: '@draft4' },
  '/app/settings/closures': { from: '2026-12-01', to: '2026-12-02' },
  // Fix round 3 (F4, F6): what each of these reads before it reads an id. A year's close names the account its result
  // goes to and the journal; a follow-up is confirmed at its position; a reading's lines are ticked by key; a request
  // is withdrawn by its id; a state's tax names the state; a statement's columns are chosen over its first rows.
  '/app/books/closing/year': { result: '@resultAccount', journal: '@journal_general' },
  '/app/sequences/:id/enrollments/:eid/confirm': { position: '1' },
  '/app/knowledge/from-page/:id/confirm': { 'line:k1': 'on' },
  '/app/settings/data/withdraw': { id: '@deletionRequest' },
  '/app/books/country/state-tax': { state: 'CA' },
  '/app/books/taxes/start': { system: 'odoo', code: 'T20', from: '2026-01-01' },
  // An answer the owner gave, taught or set aside by its question (no id: the question is the key).
  '/app/knowledge/answers/teach': { question: 'How long is delivery?', label: 'Delivery', content: 'Three days' },
  '/app/knowledge/answers/dismiss': { question: 'Do you ship abroad?' },
  '/app/books/bank/columns': { preview: '[["date","amount","label"],["2026-04-20","100","authz"]]', sep: ',', headerRow: '0', date: '0', dateFormat: 'YYYY-MM-DD',
    shape: 'single', amount: '1', decimal: '.', description: '2', currency: '', reference: '', out: '', in: '' },
};
/** A route a PERSON's session calls (F6): a phone is removed by the person it belongs to, never by the access-code owner. */
const AS_PERSON = /^\/app\/settings\/alerts\/phone\/[^/]+\/remove(\?|$)/;
/** A field drawn once per line (`account0`, `party3`) is its line's `account`, `party`. */
const baseOf = (f: string) => f.replace(/\d+$/, '');
/** The table an id field names, where the field's name says it. A field not here takes any of B's ids. */
const FIELD_TABLES: Record<string, readonly string[]> = {
  account: ['accounts'], account_id: ['accounts'], payFrom: ['accounts'], pay_from: ['accounts'],
  line: ['statement_lines'], journalLine: ['journal_lines'], match: ['statement_matches'],
  category: ['spending_categories'], category_id: ['spending_categories'],
  party: ['parties'], partyId: ['parties'], party_id: ['parties'], supplier: ['parties'], supplierId: ['parties'],
  tax: ['tax_codes'], taxCode: ['tax_codes'], tax_code: ['tax_codes'], tax_code_id: ['tax_codes'],
  journal: ['journals'], year: ['fiscal_years'], entry: ['journal_entries'], entryId: ['journal_entries'],
  invoice: ['invoices'], invoiceId: ['invoices'], recurring: ['recurring_costs'],
  clientId: ['clients'], conversationId: ['conversations'], draftId: ['drafts'], messageId: ['messages'], orderId: ['orders'],
  label: ['labels'], labelId: ['labels'], person: ['people'], personId: ['people'], to: ['people'], substitute: ['people'], substituteId: ['people'],
  assistant: ['assistants'], product: ['products'], productId: ['products'], quoteId: ['quotes'],
  proposal: ['knowledge_proposals', 'order_proposals', 'spending_proposals'], proposalId: ['knowledge_proposals', 'order_proposals', 'spending_proposals'],
  import: ['catalog_imports', 'contact_imports', 'statement_imports'], importId: ['catalog_imports', 'contact_imports'],
  saved: ['saved_replies'], sequence: ['sequences'], procedure: ['procedures'], case: ['case_checks'], check: ['case_checks'], subscription: ['push_subscriptions'],
  request: ['deletion_requests'], requestId: ['deletion_requests'], photo: ['product_images'], thread: ['advisor_threads'],
  result: ['accounts'], salesJournal: ['journals'], receivable: ['accounts'], sales: ['accounts'], fxLoss: ['accounts'], fxGain: ['accounts'],
  ...Object.fromEntries([...BUSINESS_FIELDS].map((f) => [f, ['businesses']])),
};
/**
 * For "one of B's among A's own": which of A's seeded rows an id field names by default. Where a harmless swap can
 * USE A's row (B's id in `account` only steers the bank match's redirect, so A's own line is matched), each swapped
 * field takes its own copy: the k-th swap of a route uses the k-th (the bank lines: three pairs).
 */
const FIELD_OWN: Record<string, string | readonly string[]> = {
  account: 'bank', account_id: 'bank', payFrom: 'bank', pay_from: 'bank',
  line: ['stmtLine', 'stmtLine2', 'stmtLine3'], journalLine: ['jline', 'jline_2', 'jline_3'], match: 'stmtMatch', request: 'deletionRequest', requestId: 'deletionRequest', result: 'resultAccount',
  category: 'category', category_id: 'category', party: 'party', partyId: 'party', party_id: 'party', supplier: 'party', supplierId: 'party',
  tax: 'tax', taxCode: 'tax', tax_code: 'tax', tax_code_id: 'tax', journal: 'journal', year: 'fy', entry: 'entry', entryId: 'entry',
  invoice: 'invoice', invoiceId: 'invoice', clientId: 'client', conversationId: 'conv', draftId: 'draft', orderId: 'order', label: 'label',
  labelId: 'label', person: 'person', personId: 'person', to: 'person', assistant: 'assistant', product: 'product', productId: 'product',
  quoteId: 'quote', saved: 'saved', sequence: 'sequence', procedure: 'procedure', subscription: 'phone', importId: 'catalogImport', import: 'catalogImport',
  thread: 'advisorThread', run: 'run', runId: 'run', recurring: 'recurring', proposal: 'spendingProposal', proposalId: 'orderProposal',
  case: 'caseCheck', check: 'caseCheck', ...Object.fromEntries([...BUSINESS_FIELDS].map((f) => [f, 'W'])),
};
/** A path parameter whose name and segment say nothing of its table: which seeded row of the workspace it is. */
const ROUTE_OWN: Record<string, Record<string, string>> = {
  // A value that is not a row (`=…`): a question of How you sell, a capability, a provider. `key+suffix`: a row's id and words after it.
  '/app/business/selling/:q': { q: '=returns' }, '/app/business/selling/:q/confirm': { q: '=returns' }, '/app/business/selling/:q/skip': { q: '=returns' },
  '/app/settings/business/selling/:q': { q: '=returns' }, '/app/settings/business/selling/:q/confirm': { q: '=returns' },
  '/app/settings/assistant/capability/:capability/promote': { capability: '=greet' },
  '/app/connect/:provider/start': { provider: '=gmail' }, '/app/connect/:provider/callback': { provider: '=gmail' },
  '/app/settings/alerts/phone/:id/remove': { id: 'phone' },
  '/app/books/spending/bills/:id/pay': { id: 'bill' }, '/app/books/spending/proposals/:id/post': { id: 'spendingProposal' },
  '/app/books/spending/proposals/:id/skip': { id: 'spendingProposal2' }, '/app/books/entries/:id/discard': { id: 'draftEntry2' }, '/app/business/prices/volume/:id/archive': { id: 'volume' },
  '/app/sequences/:id/enrollments/:eid/confirm': { id: 'sequenceLive', eid: 'enrollmentWaiting' }, '/app/sequences/:id/enrollments/:eid/stop': { id: 'sequenceLive', eid: 'enrollment' },
  '/app/inbox/:conversationId/follow-ups/:runId/skip': { runId: 'run' }, '/app/faces/:clientId': { clientId: 'face' },
  '/app/assistant/knowledge/checks/:id': { id: 'caseCheck' }, '/app/assistant/knowledge/checks/:id/keep': { id: 'caseCheck' },
  '/app/assistant/knowledge/checks/:id/revert': { id: 'caseCheck2' }, '/app/products/import/:importId/photo/:n': { importId: 'catalogImport', n: '=1' },
  '/app/assistant/knowledge/readings/:id': { id: 'proposal' }, '/app/assistant/knowledge/readings/:id/again': { id: 'proposal' },
  '/app/knowledge/from-page/:id': { id: 'proposal' }, '/app/knowledge/from-page/:id/again': { id: 'proposal' }, '/app/knowledge/from-page/:id/confirm': { id: 'proposal' },
  '/app/assistant/ask/:id': { id: 'advisorThread' },
  '/app/inbox/:conversationId/act': { conversationId: 'conv4' }, '/app/inbox/:conversationId/translate': { conversationId: 'conv4' },
  '/app/knowledge/:id/restore': { id: 'knowledgeArchived' },
  // What is done with an issued invoice (a credit note, a payment, a refund, sending it) is done with the issued one.
  ...Object.fromEntries(['/app/books/invoices/:id/credit-notes/new', '/app/books/invoices/:id/credit-notes', '/app/books/invoices/:id/payments',
    '/app/books/invoices/:id/refunds', '/app/books/invoices/:id/send'].map((u) => [u, { id: 'invoiceIssued' }])), '/app/calendar/entries/:id/restore': { id: 'calendarRemoved' },
  '/app/outbound/:outboundId/send-again': { outboundId: 'uncertain' }, '/app/outbound/:outboundId/leave': { outboundId: 'uncertain2' },
  '/app/books/orders/:id/draft': { id: 'orderBook' }, '/app/sequences/:id/steps': { id: 'sequence2' },
  '/app/customers/import/:id': { id: 'contactImport' }, '/app/customers/import/:id/columns': { id: 'contactImport' },
  '/app/customers/import/:id/select': { id: 'contactImport' }, '/app/customers/import/:id/confirm': { id: 'contactImport2' },
  '/app/customers/import/:id/discard': { id: 'contactImport3' }, '/app/books/invoices/:id/discard': { id: 'invoice2' }, '/app/books/credit-notes/:id/discard': { id: 'creditNote2' }, '/app/inbox/:conversationId/invoice/send': { conversationId: 'conv' },
  '/app/inbox/:conversationId/maybe-yes/order': { conversationId: 'conv3' },
  '/app/inbox/:conversationId/order/confirm': { conversationId: 'conv2' }, '/app/inbox/:conversationId/order/step-in': { conversationId: 'conv4' }, '/app/conversations/:conversationId/opt-out/lift': { conversationId: 'conv3' },
  // A draft entry is what is edited and posted (the seeded `entry` is posted).
  '/app/books/advanced/entries/:id/edit': { id: 'draftEntry' }, '/app/books/entries/:id/edit': { id: 'draftEntry' }, '/app/books/entries/:id/post': { id: 'draftEntry' },
  // A sequence waiting for approval to be approved and changed, the live one to enrol someone on.
  '/app/sequences/:id/enroll': { id: 'sequenceLive' }, '/app/customers/outreach/sequences/:id': { id: 'sequence' },
  '/app/books/papers/:id': { id: 'paper' }, '/app/books/papers/:id/file': { id: 'paper' }, '/app/books/papers/:id/read': { id: 'paper' },
  '/app/books/papers/:id/draft': { id: 'paper' }, '/app/books/spending/:id': { id: 'paper' }, '/app/books/spending/:id/draft': { id: 'paper' },
  '/app/books/spending/:id/preview': { id: 'paper' },
  // A file named by a row: the year's FEC (`<year>.txt`); a workspace export by its subject.
  '/app/books/fec/:file': { file: 'fy+.txt' }, '/app/settings/data/:file': { file: '=customers.csv' },
  '/app/advisor/c/:id': { id: 'advisorThread' }, '/app/advisor/c/:id/delete': { id: 'advisorThread' },
  '/app/settings/advisor-history/team/:id/delete': { id: 'person' },
};

/** Every name ending in `Id` / `_id` that src/api spells as a string: a form or query field it may read. */
const spelledIdFields = (): string[] => {
  const out = new Set<string>();
  const walkDir = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walkDir(p);
      else if (p.endsWith('.ts')) for (const m of readFileSync(p, 'utf8').matchAll(/['"`]([A-Za-z][A-Za-z0-9_]*(?:Id|_id))['"`]/g)) out.add(m[1]!);
    }
  };
  walkDir(join(process.cwd(), 'src', 'api'));
  return [...out];
};

const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? unescape(m[2] ?? m[3] ?? '') : null;
};
type Form = { action: string; fields: [string, string][] };
/** The POST forms of a page, as a browser would send them (urlencoded ones; a file form is the multipart pass's). */
const formsIn = (html: string): Form[] => {
  const out: Form[] = [];
  for (const m of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const head = m[1]!; const inner = m[2]!;
    if ((attr(head, 'method') ?? 'get').toLowerCase() !== 'post') continue;
    if (/multipart/i.test(attr(head, 'enctype') ?? '')) continue;
    const fields: [string, string][] = [];
    for (const i of inner.matchAll(/<input\b([^>]*)>/gi)) {
      const name = attr(i[1]!, 'name'); const type = (attr(i[1]!, 'type') ?? 'text').toLowerCase();
      if (!name || type === 'file' || type === 'submit') continue;
      if ((type === 'checkbox' || type === 'radio') && fields.some(([n]) => n === name)) continue;
      fields.push([name, attr(i[1]!, 'value') ?? (type === 'checkbox' ? 'on' : '')]);
    }
    for (const s of inner.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
      const name = attr(s[1]!, 'name'); if (!name) continue;
      const opts = [...s[2]!.matchAll(/<option\b([^>]*)>/gi)].map((o) => o[1]!);
      const pick = opts.find((o) => /\bselected\b/i.test(o) && attr(o, 'value')) ?? opts.find((o) => attr(o, 'value'));
      fields.push([name, pick ? attr(pick, 'value')! : '']);
    }
    for (const t of inner.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)) {
      const name = attr(t[1]!, 'name'); if (name) fields.push([name, unescape(t[2]!) || 'authz']);
    }
    const buttons = [...inner.matchAll(/<button\b([^>]*)>/gi)].map((b) => b[1]!);
    const named = buttons.find((b) => attr(b, 'name'));
    if (named) fields.push([attr(named, 'name')!, attr(named, 'value') ?? '']);
    const action = attr(head, 'action');
    if (action) out.push({ action, fields });
    for (const b of buttons) { const fa = attr(b, 'formaction'); if (fa) out.push({ action: fa, fields }); }
  }
  return out;
};

const multipart = (fields: Record<string, string>, file: { field: string; name: string; type: string; bytes: Buffer }) => {
  const boundary = `----authzwalk${RUN}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="${file.field}"; filename="${file.name}"\r\ncontent-type: ${file.type}\r\n\r\n`), file.bytes, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), type: `multipart/form-data; boundary=${boundary}` };
};
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const CSV = Buffer.from('date,amount,label\n2026-04-20,100,authz\n');
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
/** What a zip (a workbook, an export) holds once opened: each entry's name and bytes. `null` when it cannot be read. */
const unzipped = (buf: Buffer): Buffer[] | null => {
  const out: Buffer[] = [];
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) return null;
  try {
    const n = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16);
    for (let i = 0; i < n; i++) {
      if (buf.readUInt32LE(p) !== 0x02014b50) return null;
      const method = buf.readUInt16LE(p + 10); const size = buf.readUInt32LE(p + 20);
      const nameLen = buf.readUInt16LE(p + 28); const extraLen = buf.readUInt16LE(p + 30); const commentLen = buf.readUInt16LE(p + 32);
      const local = buf.readUInt32LE(p + 42);
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      if (method !== 0 && method !== 8) return null;
      out.push(buf.subarray(p + 46, p + 46 + nameLen), method === 8 ? inflateRawSync(data) : data);
      p += 46 + nameLen + extraLen + commentLen;
    }
  } catch { return null; }
  return out;
};
/** A PDF's streams, opened where they are deflated. `null` when one cannot be read. */
const pdfStreams = (buf: Buffer): Buffer[] | null => {
  const out: Buffer[] = [buf];
  if (!buf.includes('/FlateDecode')) return out;
  let at = 0;
  for (;;) {
    const s0 = buf.indexOf('stream', at); if (s0 < 0) break;
    const from = s0 + 6 + (buf[s0 + 6] === 0x0d ? 2 : 1); const end = buf.indexOf('endstream', from); if (end < 0) return null;
    try { out.push(inflateSync(buf.subarray(from, end))); } catch { /* a stream that is not deflated is read as it is, above */ }
    at = end + 9;
  }
  return out;
};

/** The notice a redirect carries, as message keys (the flash cookie's payload; this test's own server minted it). */
const flashKeys = (res: { headers: Record<string, unknown> }): string[] => {
  const raw = ([] as string[]).concat((res.headers['set-cookie'] as string | string[] | undefined) ?? [])
    .map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_flash=') && c.length > 'yf_flash='.length);
  if (!raw) return [];
  const token = raw.slice('yf_flash='.length); const dot = token.lastIndexOf('.');
  try {
    const parsed = JSON.parse(Buffer.from(token.slice(0, dot), 'base64url').toString('utf8')) as unknown[];
    return (parsed[0] as unknown[][]).map((p) => String(p[0]));
  } catch { return []; }
};

/** The reason a refusal's notice gives in words, where it gives one (`why`): part of the outcome NOT_REACHED pins. */
const flashReason = (res: { headers: Record<string, unknown> }): string => {
  const raw = ([] as string[]).concat((res.headers['set-cookie'] as string | string[] | undefined) ?? [])
    .map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_flash=') && c.length > 'yf_flash='.length);
  if (!raw) return '';
  const token = raw.slice('yf_flash='.length);
  try {
    const parsed = JSON.parse(Buffer.from(token.slice(0, token.lastIndexOf('.')), 'base64url').toString('utf8')) as unknown[];
    const why = ((parsed[0] as unknown[][])[0]?.[1] as { why?: unknown } | null)?.why;
    return typeof why === 'string' && why ? ` — ${why}` : '';
  } catch { return ''; }
};

/**
 * THE ROUTES A WORKSPACE'S OWN CALL DOES NOT GET PAST ITS FIRST CHECKS, and why (R1, 2026-11-12). Each was looked at:
 * a route here refuses or turns away C's own ids and words for a reason the walk cannot supply, so a swap of one of B's
 * ids into it proves only what the route says before it reads an id. A route not reached and not listed fails the walk:
 * send what it needs (WORDS, a seeded row, ROUTE_OWN), or list it here with the reason.
 *
 * Fix round 3 (F4): each entry is `[how, why]`. `how` is the route's OWN answer to C's call — its status, or the notice it
 * gave and the reason that notice words — and the walk fails when the route answers anything else, or is reached: a
 * reason in this list is checked against what the route says, every run. `why` says what that answer means here.
 */
const NOT_REACHED: Record<string, readonly [how: string, why: string]> = {
  "POST /app/inbox/:conversationId/copilot": ["200, nothing written", "the Copilot answers with JSON and writes nothing (read-only by design)"],
  "POST /app/help/ask": ["200, nothing written", "an answer page: it reads and writes nothing (no model in the walk)"],
  "POST /app/inbox/:conversationId/copilot/reply": ["200, nothing written", "the Copilot answers with JSON and writes nothing (read-only by design)"],
  "POST /app/conversations/:conversationId/deletion/erase": ["200, nothing written", "answers a confirmation page first (writes nothing until confirmed with the customer's name)"],
  "POST /app/products/add/store": ["400", "takes no id; the walk sends no store address (a store is read over the public internet, which the walk never touches): refused as not an address, before anything of the workspace is read"],
  "POST /app/products/add/shopify": ["400", "takes no id; the walk sends no store address (a store is read over the public internet, which the walk never touches): refused as not an address, before anything of the workspace is read"],
  "POST /app/settings/business/shopify/connect": ["400", "takes no id; the walk sends no store address (a store is read over the public internet, which the walk never touches): refused as not an address, before anything of the workspace is read"],
  "POST /app/products/add/photo": ["400", "a photo of a price list needs the page reader (no model in the walk)"],
  "POST /app/channels/instagram/comments/switch": ["400", "Instagram comments need a connected Instagram account and Meta's login (not configured)"],
  "POST /app/knowledge/from-page": ["400", "takes no id; reading a page needs the page reader, which the walk does not compose (no model): 'not configured', before anything is read"],
  "POST /app/knowledge/from-page/:id/again": ["400", "reading a page again needs the page reader, which the walk does not compose (no model): 'not configured', before the reading's id is read"],
  "GET /app/settings/components": ["404", "the components gallery is the installation's own workspace's alone"],
  "GET /app/books/spending/:id/draft": ["404", "a paper's draft page is drawn only after the paper was read (no reader in the walk)"],
  "GET /app/inbox/:conversationId/voice/:messageId": ["404", "needs a customer's voice note; the walk's conversations have none"],
  "GET /app/orders/:id/proforma.txt": ["404", "a proforma needs the order's payment terms and incoterm, which the seeded order does not carry"],
  "GET /app/live/practice": ["404", "Practice's live line answers only where Practice runs (no inbound queue in the walk)"],
  "GET /app/products/whatsapp/review/:batchId": ["no id of its own for :batchId", "a WhatsApp catalogue batch exists only after Meta's catalogue answered (not configured)"],
  "POST /app/products/whatsapp/review/:batchId": ["no id of its own for :batchId", "a WhatsApp catalogue batch exists only after Meta's catalogue answered (not configured)"],
  "POST /app/products/whatsapp/batches/:batchId/check": ["no id of its own for :batchId", "a WhatsApp catalogue batch exists only after Meta's catalogue answered (not configured)"],
  "GET /app/channels/instagram/comments/:id/delete": ["no id of its own for :id", "no comment exists without a connected Instagram account (Meta not configured)"],
  "POST /app/channels/instagram/comments/:id/delete": ["no id of its own for :id", "no comment exists without a connected Instagram account (Meta not configured)"],
  "POST /app/channels/instagram/comments/:id/reply": ["no id of its own for :id", "no comment exists without a connected Instagram account (Meta not configured)"],
  "POST /app/payments/stripe/attempts/:id/expire": ["no id of its own for :id", "a Stripe payment attempt or payout exists only after Stripe answered; payment links are not offered to the walk's country (MA)"],
  "POST /app/payments/stripe/payouts/:id/confirm": ["no id of its own for :id", "a Stripe payment attempt or payout exists only after Stripe answered; payment links are not offered to the walk's country (MA)"],
  "POST /app/payments/stripe/payouts/:id/receive": ["no id of its own for :id", "a Stripe payment attempt or payout exists only after Stripe answered; payment links are not offered to the walk's country (MA)"],
  "POST /app/sandbox/message": ["redirect to /app/assistant/practice, no notice, nothing written", "takes no id; Practice needs the inbound queue, which the walk does not compose: it turns back with no notice"],
  "POST /app/sandbox/media": ["redirect to /app/assistant/practice, no notice, nothing written", "takes no id; Practice needs the inbound queue, which the walk does not compose: it turns back with no notice"],
  "POST /app/sandbox/scenario": ["redirect to /app/assistant/practice, no notice, nothing written", "Practice needs the inbound queue, which the walk does not compose: it turns back with no notice"],
  "POST /app/business/selling/:q": ["redirect to /app/business/selling, no notice, nothing written", "a retired address: it moves to /app/settings/business/selling/…, which the walk reaches there"],
  "POST /app/business/selling/:q/confirm": ["redirect to /app/business/selling, no notice, nothing written", "a retired address: it moves to /app/settings/business/selling/…, which the walk reaches there"],
  "POST /app/business/selling/:q/skip": ["redirect to /app/business/selling, no notice, nothing written", "a retired address: it moves to /app/settings/business/selling/…, which the walk reaches there"],
  "POST /app/inbox/:conversationId/answer-now": ["redirect to /app/inbox/:id, no notice, nothing written", "the answer kicker is not composed in the walk: it turns back to the conversation before the message id is read"],
  "POST /app/inbox/:conversationId/heard": ["redirect to /app/inbox/:id, no notice, nothing written", "what was heard is corrected on a customer's voice note; the walk's conversations have none, so no message id of its own is sent and it turns back before any read"],
  "POST /app/products/import/:importId/columns": ["redirect to /app/products/add, no notice, nothing written", "the list is read and found; columns are chosen for a file, and the seeded list is a paste: 'not there'"],
  "POST /app/products/import/:importId/confirm": ["400", "the list is read and found (C's own id passes); none of its rows is ticked, so it answers the review again (400) and adds nothing"],
  "POST /app/channels/chat": ["redirect to /app/settings/channels/chat, no notice, nothing written", "a retired form address: it sends the owner to the channel's own settings page"],
  "POST /app/channels/telegram": ["redirect to /app/settings/channels/telegram, no notice, nothing written", "a retired form address: it sends the owner to the channel's own settings page"],
  "POST /app/settings/account/password": ["refused: account.flash.failed", "the walk signs in with a session of its own; C's owner has no password login to change"],
  "GET /app/connect/meta-ads/start": ["refused: adSpend.flash.notConfigured", "Meta's ads login is not configured in the walk's composition"],
  "GET /app/connect/meta-ads/callback": ["refused: adSpend.flash.notConfigured", "Meta's ads login is not configured in the walk's composition"],
  "POST /app/connect/meta-ads/choose": ["refused: adSpend.flash.notConfigured", "Meta's ads login is not configured in the walk's composition"],
  "POST /app/connect/meta-ads/disconnect": ["refused: adSpend.flash.notConfigured", "Meta's ads login is not configured in the walk's composition"],
  "POST /app/settings/alerts/phone": ["refused: alerts.flash.bad", "takes no id; a phone is added through the push service, which the walk does not compose"],
  "POST /app/settings/alerts/test": ["refused: alerts.flash.testNone", "takes no id; a test alert goes through the push service, which the walk does not compose"],
  "POST /app/settings/billing/card": ["refused: billing.flash.notConfigured", "Stripe billing is not configured in the walk's composition (no keys)"],
  "POST /app/settings/billing/portal": ["refused: billing.flash.notConfigured", "Stripe billing is not configured in the walk's composition (no keys)"],
  "POST /app/books/closing/lock": ["refused: books.flash.closeRefused — Not clear yet — Draft entries: 1.", "the close checklist is not clear (the walk keeps a draft entry on purpose)"],
  "POST /app/books/closing/journal": ["refused: books.flash.closeRefused — That could not be done as it is.", "takes no id; the chart the walk applied (the CGNC, an earlier call) already has its closing journal"],
  "POST /app/books/closing/opening-journal": ["refused: books.flash.closeRefused — That could not be done as it is.", "takes no id; the chart the walk applied (the CGNC, an earlier call) already has its opening journal"],
  "POST /app/books/closing/year": ["refused: books.flash.closeRefused — A year is closed once it has ended (2026-12-31).", "the year, the result account and the journal are read as the workspace's own; the close itself is refused because the year has not ended (the walk's year ends 2026-12-31)"],
  "POST /app/books/closing/reopen": ["refused: books.flash.closeRefused — The books begin on 2026-04-01: nothing before it reopens.", "Avis 24's floor: the year stays locked up to the current periods' start"],
  "POST /app/books/workbook": ["refused: books.flash.notWorkbook", "needs an Excel workbook of the books' own shape (the walk uploads a CSV)"],
  "POST /app/books/papers/:id/draft": ["refused: books.flash.paperNotDrafted — Nothing is drafted from a reading with problems.", "the paper is read and found; nothing is drafted from a paper that was not read (no document reader in the walk)"],
  "POST /app/books/papers/:id/read": ["refused: books.flash.paperNotRead — No reader is set up here: draft the entry by hand.", "the paper is read and found; reading it needs the document reader (no model in the walk)"],
  "GET /app/books/quickbooks/callback": ["refused: books.flash.quickbooksNotConnected", "QuickBooks is not offered in the walk's composition (no OAuth app configured): refused before any id is read"],
  "GET /app/books/quickbooks/start": ["refused: books.flash.quickbooksNotOffered", "QuickBooks is not offered in the walk's composition (no OAuth app configured): refused before any id is read"],
  "POST /app/books/quickbooks/read": ["refused: books.flash.quickbooksNotOffered", "QuickBooks is not offered in the walk's composition (no OAuth app configured): refused before any id is read"],
  "POST /app/books/quickbooks/write": ["refused: books.flash.quickbooksNotOffered", "QuickBooks is not offered in the walk's composition (no OAuth app configured): refused before any id is read"],
  "POST /app/books/quickbooks/disconnect": ["refused: books.flash.quickbooksNotOffered", "QuickBooks is not offered in the walk's composition (no OAuth app configured): refused before any id is read"],
  "POST /app/books/quickbooks/again": ["refused: books.flash.quickbooksNotOffered", "QuickBooks is not offered in the walk's composition (no OAuth app configured): refused before any id is read"],
  "POST /app/books/quickbooks/stale": ["refused: books.flash.quickbooksNotOffered", "QuickBooks is not offered in the walk's composition (no OAuth app configured): refused before any id is read"],
  "GET /app/books/sheets/callback": ["refused: books.flash.sheetsNotConnected", "the spreadsheet and Odoo connections are not offered in the walk's composition (no connector configured): refused before any id is read"],
  "GET /app/books/sheets/start": ["refused: books.flash.sheetsNotOffered", "the spreadsheet and Odoo connections are not offered in the walk's composition (no connector configured): refused before any id is read"],
  "POST /app/books/sheets/write": ["refused: books.flash.sheetsNotOffered", "the spreadsheet and Odoo connections are not offered in the walk's composition (no connector configured): refused before any id is read"],
  "POST /app/books/odoo/write": ["refused: books.flash.sheetsNotOffered", "the spreadsheet and Odoo connections are not offered in the walk's composition (no connector configured): refused before any id is read"],
  "POST /app/books/sheets/read": ["refused: books.flash.sheetsNotOffered", "the spreadsheet and Odoo connections are not offered in the walk's composition (no connector configured): refused before any id is read"],
  "POST /app/books/odoo/connect": ["refused: books.flash.sheetsNotOffered", "the spreadsheet and Odoo connections are not offered in the walk's composition (no connector configured): refused before any id is read"],
  "POST /app/books/odoo/read": ["refused: books.flash.sheetsNotOffered", "the spreadsheet and Odoo connections are not offered in the walk's composition (no connector configured): refused before any id is read"],
  "POST /app/books/sheets/disconnect": ["refused: books.flash.sheetsNotOffered", "the spreadsheet and Odoo connections are not offered in the walk's composition (no connector configured): refused before any id is read"],
  "POST /app/books/sheets/again": ["refused: books.flash.sheetsNotOffered", "the spreadsheet and Odoo connections are not offered in the walk's composition (no connector configured): refused before any id is read"],
  "POST /app/books/sheets/stale": ["refused: books.flash.sheetsNotOffered", "the spreadsheet and Odoo connections are not offered in the walk's composition (no connector configured): refused before any id is read"],
  "POST /app/books/country/state-tax": ["refused: books.flash.stateNoAccount", "the state and the rate are read; a state's sales tax is the United States pack's alone, and the walk's books are Moroccan: 'no account'. Takes no id"],
  "GET /app/books/xero/callback": ["refused: books.flash.xeroNotConnected", "Xero is not offered in the walk's composition (no OAuth app configured): refused before any id is read"],
  "GET /app/books/xero/start": ["refused: books.flash.xeroNotOffered", "Xero is not offered in the walk's composition (no OAuth app configured): refused before any id is read"],
  "POST /app/books/xero/read": ["refused: books.flash.xeroNotOffered", "Xero is not offered in the walk's composition (no OAuth app configured): refused before any id is read"],
  "POST /app/books/xero/write": ["refused: books.flash.xeroNotOffered", "Xero is not offered in the walk's composition (no OAuth app configured): refused before any id is read"],
  "POST /app/books/xero/disconnect": ["refused: books.flash.xeroNotOffered", "Xero is not offered in the walk's composition (no OAuth app configured): refused before any id is read"],
  "POST /app/books/xero/again": ["refused: books.flash.xeroNotOffered", "Xero is not offered in the walk's composition (no OAuth app configured): refused before any id is read"],
  "POST /app/books/xero/stale": ["refused: books.flash.xeroNotOffered", "Xero is not offered in the walk's composition (no OAuth app configured): refused before any id is read"],
  "POST /app/channels/whatsapp/ask": ["refused: channel.connect.flash.failed", "takes no id; asking Nomi for a number goes by the operator's mail, which the walk does not compose: 'failed' after the number is read"],
  "POST /app/channels/whatsapp/connect": ["refused: channel.flash.not_configured", "WhatsApp's own-number connection is not configured in the walk's composition (no Meta app)"],
  "GET /app/connect/:provider/callback": ["refused: connect.flash.expired", "a provider's login: not configured here, and a callback needs the provider's signed state (no network in the walk)"],
  "GET /app/connect/meta/callback": ["refused: connect.flash.expired", "a provider's login: not configured here, and a callback needs the provider's signed state (no network in the walk)"],
  "GET /app/connect/whatsapp/callback": ["refused: connect.flash.expired", "a provider's login: not configured here, and a callback needs the provider's signed state (no network in the walk)"],
  "GET /app/connect/tiktok/callback": ["refused: connect.flash.expired", "a provider's login: not configured here, and a callback needs the provider's signed state (no network in the walk)"],
  "POST /app/connect/meta/choose": ["refused: connect.flash.expired", "a provider's login: not configured here, and a callback needs the provider's signed state (no network in the walk)"],
  "POST /app/connect/whatsapp/choose": ["refused: connect.flash.expired", "a provider's login: not configured here, and a callback needs the provider's signed state (no network in the walk)"],
  "GET /app/connect/:provider/start": ["refused: connect.flash.not_configured", "a provider's login: not configured here, and a callback needs the provider's signed state (no network in the walk)"],
  "GET /app/connect/meta/start": ["refused: connect.flash.not_configured", "a provider's login: not configured here, and a callback needs the provider's signed state (no network in the walk)"],
  "GET /app/connect/whatsapp/start": ["refused: connect.flash.not_configured", "a provider's login: not configured here, and a callback needs the provider's signed state (no network in the walk)"],
  "GET /app/connect/tiktok/start": ["refused: connect.flash.not_configured", "a provider's login: not configured here, and a callback needs the provider's signed state (no network in the walk)"],
  "POST /app/channels/whatsapp/templates/submit": ["refused: connect.flash.not_configured", "WhatsApp's own-number connection is not configured in the walk's composition (no Meta app)"],
  "POST /app/channels/whatsapp/templates/check": ["refused: connect.flash.not_configured", "WhatsApp's own-number connection is not configured in the walk's composition (no Meta app)"],
  "POST /app/connect/mail/disconnect": ["refused: connect.flash.rejected", "nothing of that provider is connected in the seeded workspace, so there is nothing to disconnect"],
  "POST /app/connect/whatsapp/disconnect": ["refused: connect.flash.rejected", "nothing of that provider is connected in the seeded workspace, so there is nothing to disconnect"],
  "POST /app/connect/tiktok/disconnect": ["refused: connect.flash.rejected", "nothing of that provider is connected in the seeded workspace, so there is nothing to disconnect"],
  "POST /app/connect/meta/disconnect": ["refused: connect.flash.rejected", "Meta's login is not configured in the walk's composition, and nothing is connected: 'rejected'"],
  "POST /app/contacts/write": ["refused: contacts.flash.notLive", "writing first needs the outbound worker (messaging is off in the walk's composition): 'notLive'"],
  "POST /app/conversations/:conversationId/deletion": ["refused: conv.deletion.flash.moved", "a retired address: it says the control moved, before reading any id"],
  "POST /app/conversations/:conversationId/copilot/suggest": ["refused: copilot.flash.notSuggested.unavailable", "a suggestion needs the real turn's model (none in the walk): 'unavailable' after the conversation is read"],
  "POST /app/settings/data/close": ["refused: data.flash.protected", "the walk's owner signs in with the access code (person 'owner'), which may never close a workspace: 'protected', before the name is read"],
  "POST /app/help/write": ["refused: help.write.cannot", "writing to Nomi needs the help writer, which the walk does not compose"],
  "GET /app/channels/instagram/comments/callback": ["refused: igComments.flash.refused", "Instagram comments need a connected Instagram account and Meta's login (not configured)"],
  "POST /app/inbox/:conversationId/translate": ["refused: inbox.flash.translate.unavailable", "the draft is read and found (C's own id passes); the translator is not composed, so it stops at 'unavailable'"],
  "POST /app/inbox/:conversationId/maybe-yes/order": ["refused: order.flash.prepare.not_priceable", "the 'maybe' signal's product has no price for that quantity in the walk's catalogue"],
  "GET /app/payments/stripe/return": ["refused: paymentLinks.flash.refused — Payment links are not available for this country.", "payment links are not offered to the walk's country (MA) and Stripe is not configured"],
  "POST /app/payments/stripe/connect": ["refused: paymentLinks.flash.refused — Payment links are not available for this country.", "payment links are not offered to the walk's country (MA) and Stripe is not configured"],
  "POST /app/payments/stripe/accounts": ["refused: paymentLinks.flash.refused — Payment links are not available for this country.", "payment links are not offered to the walk's country (MA) and Stripe is not configured"],
  "POST /app/payments/stripe/invoices/:id/create": ["refused: paymentLinks.flash.refused — Payment links are not available for this country.", "payment links are not offered to the walk's country (MA) and Stripe is not configured"],
  "POST /app/payments/stripe/invoices/:id/send": ["refused: paymentLinks.flash.refused — Payment links are not available for this country.", "payment links are not offered to the walk's country (MA) and Stripe is not configured"],
  "POST /app/payments/stripe/retry": ["refused: paymentLinks.flash.refused — Payment links are not available for this country.", "payment links are not offered to the walk's country (MA) and Stripe is not configured"],
  "POST /app/payments/stripe/disconnect": ["refused: paymentLinks.flash.refused — Payment links are not available for this country.", "payment links are not offered to the walk's country (MA) and Stripe is not configured"],
  "POST /app/orders/:id/proforma-link": ["refused: pi.owner.flash.failed", "a proforma needs the order's payment terms and incoterm, which the seeded order does not carry"],
  "POST /app/orders/:id/proforma-link/off": ["refused: pi.owner.flash.failed", "a proforma needs the order's payment terms and incoterm, which the seeded order does not carry"],
  "POST /app/business/pilot/resume": ["refused: pilot.flash.not_active", "pilot mode belongs to a live WhatsApp channel; the walk's workspace has none activated"],
  "POST /app/business/pilot/end": ["refused: pilot.flash.not_active", "pilot mode belongs to a live WhatsApp channel; the walk's workspace has none activated"],
  "POST /app/prospects/key/remove": ["refused: prospects.flash.failed", "no prospect-search key is stored for the walk's workspace"],
  "POST /app/settings/rate": ["refused: rate.flash.none", "the rate page exists only where the selling currency differs from the country's (MAD in MA)"],
  "POST /app/channels/instagram/connect": ["refused: reach.inbound.flash.notConfigured", "Instagram and Messenger connection is not configured in the walk's composition (no Meta app)"],
  "POST /app/channels/messenger/connect": ["refused: reach.inbound.flash.notConfigured", "Instagram and Messenger connection is not configured in the walk's composition (no Meta app)"],
  "POST /app/sequences/:id/enroll": ["refused: seq.flash.notLive", "enrolling needs the outbound worker (messaging is off in the walk's composition): 'notLive'"],
  "POST /app/settings/business/shopify/switch": ["refused: shopifyOrders.flash.nothing", "no Shopify store is connected in the seeded workspace"],
  "POST /app/settings/business/shopify/disconnect": ["refused: shopifyOrders.flash.nothing", "no Shopify store is connected in the seeded workspace"],
  "POST /app/products/whatsapp/preview": ["refused: waCatalog.flash.connection", "the WhatsApp catalogue needs a connected WhatsApp Business account (not configured)"],
};

d('Authorization audit · A\'s owner on every route with B\'s ids (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 1_800_000 }, () => {
  let admin: pg.Client;
  let db: import('../../src/db/client.js').Db;
  type WS = { name: 'A' | 'B' | 'C'; w: string; conv: string; seeded: Record<string, string>; tableOf: Map<string, string>; app: import('fastify').FastifyInstance; cookie: string; personCookie: string; personCode: string };
  const ws: Record<'A' | 'B' | 'C', WS> = {} as Record<'A' | 'B' | 'C', WS>;
  const routes: { method: string; url: string; source: string }[] = [];
  let ids: { table: string; id: string }[] = [];
  const bByTable = new Map<string, string[]>();
  let theirs = new Set<string>();
  let before = new Map<string, string>();
  let heldBefore = new Map<string, Held>();
  let scopes: { table: string; where: string }[] = [];
  let idFields: string[] = [];
  const shown: string[] = [];
  /** F2 — the bytes B keeps (by hash), what A keeps or the walk itself sent, and each answer that was neither words nor a refusal. */
  let bBlobs = new Set<string>();
  const ownBlobs = new Set<string>();
  const binaries: { where: string; hash: string; type: string }[] = [];
  const unreadable: string[] = [];
  let blobSql = '';
  const blobsOf = async (w: string): Promise<string[]> => blobSql ? (await admin.query(blobSql, [w])).rows.map((r) => r.h as string) : [];
  const failures: string[] = [];
  const errors: string[] = [];
  const statuses = new Map<number, number>();
  const passCalls: Record<string, number> = {};
  const passMs: Record<string, number> = {};
  const sent5xx: string[] = [];
  const reach = new Map<string, string>();
  let calls = 0; let relogins = 0;
  let memory: import('../../src/advisor/memory.js').AdvisorMemory;
  let pass = '';

  /**
   * A workspace and its practice copy (rule 40): Practice writes into the copy, a business of its own, so W's rows are
   * the copy's too — B's copy is B's, and a call of A's that wrote into it would change B.
   */
  const FAMILY = '(select $1::uuid union all select id from businesses where practice_of = $1::uuid)';
  /** Every table that holds a workspace, and every table that hangs off one of them by a key, with how to read W's rows. */
  const readScopes = async () => {
    const direct = (await admin.query(`select c.relname as t from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attname = 'business_id' and not a.attisdropped
      where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p') order by 1`)).rows.map((r) => r.t as string);
    const hasBiz = new Set(direct);
    const kids = (await admin.query(`
      select con.conrelid::regclass::text as child, a.attname as col, con.confrelid::regclass::text as parent, pa.attname as pcol
        from pg_constraint con join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
        join pg_attribute pa on pa.attrelid = con.confrelid and pa.attnum = con.confkey[1]
        join pg_class c on c.oid = con.conrelid
       where con.contype = 'f' and array_length(con.conkey, 1) = 1 and c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p')
       order by 1, 2`)).rows as { child: string; col: string; parent: string; pcol: string }[];
    const byKid = new Map<string, string[]>();
    for (const k of kids) {
      if (hasBiz.has(k.child) || !hasBiz.has(k.parent)) continue;
      byKid.set(k.child, [...(byKid.get(k.child) ?? []), `${k.col} in (select ${k.pcol} from ${k.parent} where business_id in ${FAMILY})`]);
    }
    return [...direct.map((t) => ({ table: t, where: `business_id in ${FAMILY}` })), ...[...byKid].map(([t, w]) => ({ table: t, where: w.join(' or ') }))];
  };
  const snapshot = async (w: string): Promise<Map<string, string>> => {
    const out = new Map<string, string>();
    for (const s of scopes) {
      const r = (await admin.query(`select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as h, count(*)::int as n from ${s.table} x where ${s.where}`, [w])).rows[0];
      out.set(s.table, `${r.n}:${r.h}`);
    }
    return out;
  };
  /** All of W's rows as one hash, in one round trip: did a call write anything of W's? */
  let stateSql = '';
  const stateOf = async (w: string): Promise<string> => (await admin.query(stateSql, [w])).rows[0].h as string;

  /** S1's inventory, read from the catalogue: single-column keys between two workspace tables. Rows of A naming B's, or B's naming A's. */
  const crossings = async (): Promise<string[]> => {
    const keys = (await admin.query(`
      with scoped as (select c.oid from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p')
                        and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'business_id' and not a.attisdropped))
      select con.conrelid::regclass::text as child, a.attname as col, con.confrelid::regclass::text as parent, pa.attname as pcol
        from pg_constraint con join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
        join pg_attribute pa on pa.attrelid = con.confrelid and pa.attnum = con.confkey[1]
       where con.contype = 'f' and array_length(con.conkey, 1) = 1
         and con.conrelid in (select oid from scoped) and con.confrelid in (select oid from scoped)`)).rows as { child: string; col: string; parent: string; pcol: string }[];
    const out: string[] = [];
    for (const k of keys) {
      const n = (await admin.query(`select count(*)::int as n from ${k.child} c join ${k.parent} p on p.${k.pcol} = c.${k.col}
        where c.business_id <> p.business_id and c.business_id in ($1, $2) and p.business_id in ($1, $2)`, [A, B])).rows[0].n as number;
      if (n > 0) out.push(`${k.child}.${k.col} → ${k.parent}: ${n}`);
    }
    return out;
  };

  /** A workspace's extra rows, beyond the demo: one of each kind a route takes an id of, the books included. Each alone. */
  const seedWorkspace = async (ns: string, w: string, mark: string): Promise<Record<string, string>> => {
    // Every file a workspace keeps carries its marker in its bytes (F2): a face, a list photo, a product photo, a paper —
    // so each workspace's files differ, and one of B's served to A is known by its bytes.
    const png = Buffer.concat([PNG, Buffer.from(mark)]).toString('hex');
    const v: Record<string, string> = { W: w, conv: `${ns}-0000-4000-8000-000000000301`, client: `${ns}-0000-4000-8000-000000000201`,
      product: `${ns}-0000-4000-8000-000000000101`, MARK: mark };
    const tag = w === B ? 'B' : w === C ? 'C' : 'A';
    const one = async (name: string, text: string): Promise<string | null> => {
      try {
        const r = await admin.query(text.replace(/\$(\w+)/g, (_m, k: string) => (v[k] !== undefined ? `'${v[k]}'` : `$${k}`)));
        const id = r.rows[0]?.id as string | undefined;
        if (id) v[name] = id;
        return id ?? null;
      } catch (e) { failures.push(`seed ${tag} ${name}: ${(e as Error).message}`); return null; }
    };
    await one('mark', `update businesses set name = name || ' ' || $MARK where id = $W returning id::text as id`);
    await admin.query(`update products set name = name || ' ' || '${mark}' where business_id = '${w}'`);
    await admin.query(`update clients set display_name = display_name || ' ' || '${mark}' where business_id = '${w}'`);
    await admin.query(`update messages set text_content = text_content || ' ' || '${mark}' where conversation_id in (select id from conversations where business_id = '${w}')`);
    // One currency for the whole workspace, as production keeps it (the currency is fixed once a price exists): the books
    // below are Moroccan, so the demo's dollar prices are dirhams here. Before, the workspace said MAD and its prices USD,
    // and the owner's own order confirmation and the Ready page answered 500 on the mix (found by the reach check).
    // A kind that sells by quantity, so the export trade's pages are there (B14), and the outreach area on (rule 8): the
    // routes each opens are reached. The kind is set, not left empty: an empty kind's select would take its first word
    // when the profile's own form is sent, and the workspace would turn into a brand mid-walk.
    await admin.query(`update businesses set books_area = true, country = 'MA', currency = 'MAD', kind = 'manufacturer', outreach_area = true where id = '${w}'`);
    await admin.query(`update products set currency = 'MAD' where business_id = '${w}'`);
    await admin.query(`update pricing_policy set currency = 'MAD' where business_id = '${w}'`);
    await admin.query(`update price_tiers set currency = 'MAD' where product_id in (select id from products where business_id = '${w}')`);
    await admin.query(`update sample_policy set currency = 'MAD' where business_id = '${w}'`);
    // The owner as a person, as every workspace has one in production (the demo has none: the session was the 'owner'
    // sentinel, which the advisor's history cannot keep anything for).
    await one('owner', `insert into people (business_id, name, is_owner) values ($W, 'Owner ' || $MARK, true) returning id::text as id`);
    await one('person', `insert into people (business_id, name, is_owner) values ($W, 'Staff ' || $MARK, false) returning id::text as id`);
    await one('assistant', `insert into assistants (business_id, name, is_default) values ($W, 'Second ' || $MARK, false) returning id::text as id`);
    await one('quote', `insert into quotes (business_id, conversation_id, product_id, quantity, inputs, unit_price_usd, total_usd, engine_version) values ($W, $conv, $product, 10, '{}', 2, 20, 'authz') returning id::text as id`);
    await one('draft', `insert into drafts (business_id, conversation_id, capability, draft_text) values ($W, $conv, 'quote', 'Draft ' || $MARK) returning id::text as id`);
    await one('outbound', `insert into outbound_messages (business_id, conversation_id, seq, body) values ($W, $conv, 1, 'Sent ' || $MARK) returning id::text as id`);
    await one('order', `insert into orders (order_reference, business_id, client_id, conversation_id, product_id, quantity, unit) values ('AZ-' || $MARK, $W, $client, $conv, $product, 10, 'pcs') returning id::text as id`);
    await one('sample', `insert into sample_requests (business_id, conversation_id, asked_text) values ($W, $conv, 'Sample ' || $MARK) returning id::text as id`);
    await one('label', `insert into labels (business_id, name, created_by) values ($W, 'Label ' || $MARK, 'owner') returning id::text as id`);
    await one('buyerLabel', `insert into buyer_labels (business_id, client_id, label_id, added_by) values ($W, $client, $label, 'owner') returning id::text as id`);
    await one('calendar', `insert into calendar_entries (business_id, title, starts_at) values ($W, 'Entry ' || $MARK, now() + interval '1 day') returning id::text as id`);
    await one('closure', `insert into factory_closures (business_id, label, starts_on, ends_on) values ($W, 'Closed ' || $MARK, current_date + 30, current_date + 31) returning id::text as id`);
    await one('term', `insert into forbidden_terms (business_id, term) values ($W, 'term' || $MARK) returning id::text as id`);
    await one('knowledge', `insert into product_knowledge (business_id, product_id, kind, label, content) values ($W, $product, 'faq', 'Fact', 'Fact ' || $MARK) returning id::text as id`);
    await one('sequence', `insert into sequences (business_id, name, created_by) values ($W, 'Seq ' || $MARK, 'owner') returning id::text as id`);
    await one('step', `insert into sequence_steps (business_id, sequence_id, position, delay_days, subject, body) values ($W, $sequence, 1, 1, 'Hi', 'Step ' || $MARK) returning id::text as id`);
    await one('procedure', `insert into procedures (business_id, title, steps) values ($W, 'Proc ' || $MARK, '[{"text":"ask the address","kind":"do"}]') returning id::text as id`);
    await one('saved', `insert into saved_replies (business_id, title, texts, created_by) values ($W, 'Saved ' || $MARK, '{"en":"Saved"}', 'owner') returning id::text as id`);
    await one('note', `insert into conversation_notes (business_id, conversation_id, note) values ($W, $conv, 'Note ' || $MARK) returning id::text as id`);
    await one('handoff', `insert into handoffs (business_id, conversation_id, reason, sla_deadline_at) values ($W, $conv, 'human_requested', now() + interval '1 hour') returning id::text as id`);
    await one('signal', `insert into conversation_signals (business_id, conversation_id, kind) values ($W, $conv, 'human_requested') returning id::text as id`);
    await one('promise', `insert into promised_dates (business_id, conversation_id, kind, due_on, said, said_by) values ($W, $conv, 'delivery', current_date + 3, 'By Friday ' || $MARK, 'person') returning id::text as id`);
    await one('spot', `insert into spot_checks (business_id, conversation_id, capability) values ($W, $conv, 'quote') returning id::text as id`);
    await one('phone', `insert into push_subscriptions (business_id, person_id, endpoint, p256dh, auth) values ($W, $person, 'https://push.invalid/' || $MARK, repeat('k', 87), repeat('a', 22)) returning id::text as id`);
    await one('proposal', `insert into knowledge_proposals (business_id, source, lines, created_by) values ($W, 'https://example.invalid', '[{"key":"k1","fact":"Fact ${mark}"}]', 'owner') returning id::text as id`);
    await one('catalogImport', `insert into catalog_imports (business_id, kind, currency) values ($W, 'paste', 'MAD') returning id::text as id`);
    await one('contactImport', `insert into contact_imports (business_id, source, cells, mapping) values ($W, 'paste', '[["a@b.c"]]', '{}') returning id::text as id`);
    // The proposal waits in ANOTHER conversation than the order: a conversation that already holds an order answers the
    // owner's Confirm with a 500 (repos.orders.create queries inside the transaction its own failed insert aborted —
    // found by the reach check, 2026-11-12, reported, open). The walk judges authorization, not that defect.
    await one('conv2', `select id::text as id from conversations where business_id = $W and id <> $conv order by id limit 1`);
    await one('client2', `select client_id::text as id from conversations where id = $conv2`);
    await one('orderProposal', `insert into order_proposals (business_id, conversation_id, client_id, product_id, quantity, unit, unit_price, total, currency) values ($W, $conv2, $client2, $product, 10, 'pcs', 2, 20, 'MAD') returning id::text as id`);
    await one('deletionAsk', `insert into deletion_asks (business_id, client_id, conversation_id, asked_at) values ($W, $client, $conv, now()) returning id::text as id`);
    // The books: a chart's bank, receivable, expense and income accounts, a journal of every kind a form needs (the
    // spending book draws its bill and recurring forms only where a purchases journal exists: R1), a year, a posted entry
    // on the bank, a party, a tax code, a category, an invoice — and a statement line on the bank account of the posted
    // amount, so the bank page offers the match (A's own form, which pass 5 submits with B's journal line).
    await one('bank', `insert into accounts (business_id, code, name, kind) values ($W, '5141', 'Bank ' || $MARK, 'asset') returning id::text as id`);
    await one('receivable', `insert into accounts (business_id, code, name, kind) values ($W, '3421', 'Customers ' || $MARK, 'asset') returning id::text as id`);
    await one('expense', `insert into accounts (business_id, code, name, kind) values ($W, '6111', 'Costs ' || $MARK, 'expense') returning id::text as id`);
    await one('income', `insert into accounts (business_id, code, name, kind) values ($W, '7111', 'Sales ' || $MARK, 'income') returning id::text as id`);
    await one('journal', `insert into journals (business_id, code, name, kind) values ($W, 'BQ', 'Banque', 'bank') returning id::text as id`);
    for (const [k, code, kind] of [['purchases', 'AC', 'purchases'], ['sales', 'VT', 'sales'], ['cash', 'CA', 'cash'], ['general', 'OD', 'general']] as const) {
      await one(`journal_${k}`, `insert into journals (business_id, code, name, kind) values ($W, '${code}', '${kind} ' || $MARK, '${kind}') returning id::text as id`);
    }
    await one('fy', `insert into fiscal_years (business_id, starts_on, ends_on) values ($W, '2026-01-01', '2026-12-31') returning id::text as id`);
    await one('entry', `insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, created_by) values ($W, $journal, $fy, '2026-04-19', 'Entry ' || $MARK, 'owner') returning id::text as id`);
    await one('jline', `insert into journal_lines (business_id, entry_id, line_no, account_id, currency, debit, credit) values ($W, $entry, 1, $bank, 'MAD', 100, 0) returning id::text as id`);
    await one('jline2', `insert into journal_lines (business_id, entry_id, line_no, account_id, currency, debit, credit) values ($W, $entry, 2, $receivable, 'MAD', 0, 100) returning id::text as id`);
    await one('posted', `update journal_entries set state = 'posted', posted_by = 'owner', document_ref = 'F-1', document_date = entry_date where id = $entry returning id::text as id`);
    await one('draftEntry', `insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, created_by) values ($W, $journal, $fy, '2026-04-20', 'Draft entry ' || $MARK, 'owner') returning id::text as id`);
    // … balanced, with its document, so posting it is a real post.
    await one('dline1', `insert into journal_lines (business_id, entry_id, line_no, account_id, currency, debit, credit) values ($W, $draftEntry, 1, $bank, 'MAD', 10, 0) returning id::text as id`);
    await one('dline2', `insert into journal_lines (business_id, entry_id, line_no, account_id, currency, debit, credit) values ($W, $draftEntry, 2, $receivable, 'MAD', 0, 10) returning id::text as id`);
    await one('draftDoc', `update journal_entries set document_ref = 'D-1', document_date = entry_date where id = $draftEntry returning id::text as id`);
    await one('party', `insert into parties (business_id, kind, code, name) values ($W, 'customer', 'C-' || $MARK, 'Party ' || $MARK) returning id::text as id`);
    await one('tax', `insert into tax_codes (business_id, code, label, rate, kind, account_id, valid_from) values ($W, 'T20', 'Tax ' || $MARK, 20, 'collected', $receivable, '2026-01-01') returning id::text as id`);
    await one('category', `insert into spending_categories (business_id, name, account_id) values ($W, 'Cat ' || $MARK, $expense) returning id::text as id`);
    await one('invoice', `insert into invoices (business_id, party_id, issue_date, currency, label, created_by) values ($W, $party, '2026-04-20', 'MAD', 'Invoice ' || $MARK, 'owner') returning id::text as id`);
    await one('stmtImport', `insert into statement_imports (business_id, account_id, format, sha256, added, refused, imported_by) values ($W, $bank, 'csv', md5($MARK) || md5($MARK), 1, 0, 'owner') returning id::text as id`);
    await one('stmtLine', `insert into statement_lines (business_id, import_id, account_id, booked_on, amount, currency, wording, fingerprint) values ($W, $stmtImport, $bank, '2026-04-20', 100, 'MAD', 'Wire ' || $MARK, $MARK) returning id::text as id`);
    // Two more posted bank lines, each with its statement line: a copy for each swap of the bank match's fields.
    for (const [n, amount] of [[2, 101], [3, 102], [4, 103]] as const) {
      await one(`entry${n}`, `insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, created_by) values ($W, $journal, $fy, '2026-04-19', 'Entry ${n} ' || $MARK, 'owner') returning id::text as id`);
      await one(`jline_${n}`, `insert into journal_lines (business_id, entry_id, line_no, account_id, currency, debit, credit) values ($W, $entry${n}, 1, $bank, 'MAD', ${amount}, 0) returning id::text as id`);
      await one(`jline2_${n}`, `insert into journal_lines (business_id, entry_id, line_no, account_id, currency, debit, credit) values ($W, $entry${n}, 2, $receivable, 'MAD', 0, ${amount}) returning id::text as id`);
      await one(`posted${n}`, `update journal_entries set state = 'posted', posted_by = 'owner', document_ref = 'F-${n}', document_date = entry_date where id = $entry${n} returning id::text as id`);
      await one(`stmtLine${n}`, `insert into statement_lines (business_id, import_id, account_id, booked_on, amount, currency, wording, fingerprint) values ($W, $stmtImport, $bank, '2026-04-20', ${amount}, 'MAD', 'Wire ${n} ' || $MARK, $MARK || '-${n}') returning id::text as id`);
    }
    // The rest of what a route takes an id of (R1, the reach list): a credit note, a books field, a recurring cost and the
    // proposal it made, a bill, a sequence's enrollment, a follow-up, a volume discount, a customer's face, a check
    // staged before going live, a photo of a list.
    // The books' own accounts for invoices, and a second invoice with a line, issued below through the app's own writer
    // (the database gives the number), so a credit note has an issued invoice to be against.
    await one('booksSettings', `insert into books_settings (business_id, sales_journal_id, receivable_account_id, sales_account_id) values ($W, $journal_sales, $receivable, $income)
      on conflict (business_id) do update set sales_journal_id = excluded.sales_journal_id, receivable_account_id = excluded.receivable_account_id, sales_account_id = excluded.sales_account_id returning business_id::text as id`);
    await one('invoiceDraftLine', `insert into invoice_lines (business_id, invoice_id, line_no, label, quantity, unit_price, account_id, net) values ($W, $invoice, 1, 'Draft line ' || $MARK, 1, 50, $income, 50) returning invoice_id::text as id`);
    // A second draft invoice, for "discard" (issue takes the first).
    await one('invoice2', `insert into invoices (business_id, party_id, issue_date, currency, label, created_by) values ($W, $party, '2026-04-20', 'MAD', 'Invoice 2 ' || $MARK, 'owner') returning id::text as id`);
    await one('invoiceIssued', `insert into invoices (business_id, party_id, issue_date, currency, label, created_by, source_order_id) values ($W, $party, '2026-04-20', 'MAD', 'Issued ' || $MARK, 'owner', $order) returning id::text as id`);
    await one('invoiceLine', `insert into invoice_lines (business_id, invoice_id, line_no, label, quantity, unit_price, account_id, net) values ($W, $invoiceIssued, 1, 'Line ' || $MARK, 1, 100, $income, 100) returning invoice_id::text as id`);
    // A sequence approved and live, so someone can be enrolled on it.
    await one('sequenceLive', `insert into sequences (business_id, name, created_by) values ($W, 'Live ' || $MARK, 'owner') returning id::text as id`);
    await one('stepLive', `insert into sequence_steps (business_id, sequence_id, position, delay_days, subject, body) values ($W, $sequenceLive, 1, 1, 'Hi', 'Live step ' || $MARK) returning id::text as id`);
    await one('approved', `update sequences set approved_by = 'owner', approved_at = now() where id = $sequenceLive returning id::text as id`);
    await one('field', `insert into custom_field_defs (business_id, applies_to, key, label, kind) values ($W, 'entry', 'authz_f', 'Field ' || $MARK, 'text') returning id::text as id`);
    await one('recurring', `insert into recurring_costs (business_id, label, amount, currency, account_id, every, next_on, created_by, pay_from_account_id) values ($W, 'Rent ' || $MARK, 100, 'MAD', $expense, 'month', '2026-05-01', 'owner', $bank) returning id::text as id`);
    await one('spendingProposal', `insert into spending_proposals (business_id, recurring_id, due_on) values ($W, $recurring, '2026-05-01') returning id::text as id`);
    await one('billEntry', `insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, created_by) values ($W, $journal_purchases, $fy, '2026-04-18', 'Bill ' || $MARK, 'owner') returning id::text as id`);
    await one('payable', `insert into accounts (business_id, code, name, kind) values ($W, '4411', 'Suppliers ' || $MARK, 'liability') returning id::text as id`);
    await one('bline1', `insert into journal_lines (business_id, entry_id, line_no, account_id, currency, debit, credit) values ($W, $billEntry, 1, $expense, 'MAD', 50, 0) returning id::text as id`);
    await one('bline2', `insert into journal_lines (business_id, entry_id, line_no, account_id, currency, debit, credit, party_id) values ($W, $billEntry, 2, $payable, 'MAD', 0, 50, $party) returning id::text as id`);
    await one('billPosted', `update journal_entries set state = 'posted', posted_by = 'owner', document_ref = 'B-1', document_date = entry_date where id = $billEntry returning id::text as id`);
    await one('bill', `insert into spending_bills (business_id, entry_id, gross, currency, created_by) values ($W, $billEntry, 50, 'MAD', 'owner') returning id::text as id`);
    await one('enrollment', `insert into sequence_enrollments (business_id, sequence_id, identity, enrolled_by) values ($W, $sequenceLive, 'enrolled-' || $MARK || '@example.com', 'owner') returning id::text as id`);
    await one('run', `insert into follow_up_runs (business_id, client_id, conversation_id, source_quote_id, source_outbound_id, episode_key, channel, quoted_at, due_at, delay_days, wording) values ($W, $client, $conv, $quote, $outbound, gen_random_uuid(), 'whatsapp', now(), now() + interval '2 days', 2, 'Follow ' || $MARK) returning id::text as id`);
    await one('volume', `insert into negotiation_rules (business_id, priority, condition, action, is_active) values ($W, 100, '{"qtyGte": 50}', '{"kind": "discount_pct", "value": 5}', true) returning id::text as id`);
    await one('face', `insert into client_faces (client_id, business_id, state, bytes, content_type, version, kept_at) values ($client, $W, 'kept', decode('${png}', 'hex'), 'image/png', '0123456789ab', now()) returning client_id::text as id`);
    // Two finished checks: keep decides one, revert the other (each is decided once).
    for (const k of ['caseCheck', 'caseCheck2']) {
      await one(k, `insert into case_checks (business_id, kind, change, summary, created_by, status) values ($W, 'knowledge', '{"kind":"knowledge","productId":null,"knowledgeKind":"faq","label":"Authz check","content":"Authz answer"}', 'Check ' || $MARK, 'owner', 'done') returning id::text as id`);
    }
    // Rows in the state a route acts on (R1): a fact and a calendar entry taken off (to put back), a send that may or
    // may not have left (to send again or leave), a "maybe yes" (to make an order of), a customer who asked not to hear
    // from the business (to lift) — the last two in a third conversation, so nothing else there is held by them.
    await one('knowledgeArchived', `insert into product_knowledge (business_id, product_id, kind, label, content, status) values ($W, $product, 'faq', 'Old', 'Old fact ' || $MARK, 'archived') returning id::text as id`);
    await one('calendarRemoved', `insert into calendar_entries (business_id, title, starts_at, removed_at, removed_by) values ($W, 'Removed ' || $MARK, now() + interval '2 days', now(), 'owner') returning id::text as id`);
    await one('uncertain', `insert into outbound_messages (business_id, conversation_id, seq, body, status) values ($W, $conv, 2, 'Unsure ' || $MARK, 'uncertain') returning id::text as id`);
    // A second, for "leave it" (send-again takes the first).
    await one('uncertain2', `insert into outbound_messages (business_id, conversation_id, seq, body, status) values ($W, $conv, 3, 'Unsure 2 ' || $MARK, 'uncertain') returning id::text as id`);
    await one('conv3', `select id::text as id from conversations where business_id = $W and id not in ($conv, $conv2) order by id limit 1`);
    // … its payload as the turn writes it (pipeline/turn.ts): what they said, and the offer they were last given.
    await one('maybe', `insert into conversation_signals (business_id, conversation_id, kind, payload) select $W, $conv3, 'maybe_confirmation', jsonb_build_object('kind', 'maybe_confirmation',
      'said', 'Maybe yes ' || $MARK, 'messageId', null, 'offer', jsonb_build_object('productName', p.name, 'productId', p.id, 'quantity', 10, 'unit', p.unit,
      'unitPrice', jsonb_build_object('amount', '2', 'currency', 'MAD'), 'total', jsonb_build_object('amount', '20', 'currency', 'MAD'), 'givenAt', now()))
      from products p where p.id = $product returning id::text as id`);
    await one('optOut', `insert into opt_outs (business_id, channel, identity, recorded_by) select $W, c.channel, cc.channel_user_id, 'owner' from conversations c
      join client_channels cc on cc.client_id = c.client_id and cc.channel = c.channel where c.id = $conv3 limit 1 returning id::text as id`);
    // A draft of its own, in a fourth conversation, for the approval card and its translation: the owner's own reply in
    // the first conversation sets aside every draft waiting there.
    await one('conv4', `select id::text as id from conversations where business_id = $W and id not in ($conv, $conv2, $conv3) order by id limit 1`);
    await one('draft4', `insert into drafts (business_id, conversation_id, capability, draft_text) values ($W, $conv4, 'greet', 'Hello ' || $MARK) returning id::text as id`);
    // A second waiting "yes", for "Hand to me" (confirm decides conv2's).
    await one('orderProposal2', `insert into order_proposals (business_id, conversation_id, client_id, product_id, quantity, unit, unit_price, total, currency)
      select $W, c.id, c.client_id, $product, 10, 'pcs', 2, 20, 'MAD' from conversations c where c.id = $conv4 returning id::text as id`);
    // Second drafts of an entry and a waiting cost, for "discard" and "skip" (post takes the first of each).
    await one('draftEntry2', `insert into journal_entries (business_id, journal_id, fiscal_year_id, entry_date, label, created_by) values ($W, $journal, $fy, '2026-04-20', 'Draft entry 2 ' || $MARK, 'owner') returning id::text as id`);
    await one('recurring2', `insert into recurring_costs (business_id, label, amount, currency, account_id, every, next_on, created_by, pay_from_account_id) values ($W, 'Water ' || $MARK, 50, 'MAD', $expense, 'month', '2026-05-01', 'owner', $bank) returning id::text as id`);
    await one('spendingProposal2', `insert into spending_proposals (business_id, recurring_id, due_on) values ($W, $recurring2, '2026-05-01') returning id::text as id`);
    // Customers read from a file, waiting for the owner: one to review, one to confirm, one to discard.
    for (const k of ['contactImport', 'contactImport2', 'contactImport3']) {
      await one(k, `insert into contact_imports (business_id, source, cells, has_header, mapping, created_by) values ($W, 'paste',
        '[["name","phone"],["Lead ${k}","+971500000123"]]'::jsonb, true, '{"name":0,"phone":1,"language":null,"notes":null}'::jsonb, 'owner') returning id::text as id`);
    }
    // A draft sequence for steps (the seeded one is approved during the walk; a sequence changes only as a draft).
    await one('sequence2', `insert into sequences (business_id, name, created_by) values ($W, 'Draft 2 ' || $MARK, 'owner') returning id::text as id`);
    // An order not yet in the books (the seeded one is the issued invoice's), for "draft its invoice".
    // The conversation's own customer, as the order writer takes it (the erase tool refuses an order that sits in another
    // customer's conversation, and found this seed doing so).
    await one('orderBook', `insert into orders (order_reference, business_id, client_id, conversation_id, product_id, quantity, unit, status, total_value_usd, currency)
      select 'AZB-' || $MARK, $W, c.client_id, c.id, $product, 10, 'pcs', 'confirmed', 20, 'MAD' from conversations c where c.id = $conv4 returning id::text as id`);
    await one('importPhoto', `insert into catalog_import_photos (business_id, import_id, position, media_type, bytes, transcript) values ($W, $catalogImport, 1, 'image/png', decode('${png}', 'hex'), 'Bag ' || $MARK || ' 3.00') returning id::text as id`);
    // The photo Nomi serves for the product (0152), so B has one a broken "remove the photo" would delete — without it
    // that route had nothing of B's to take, and a remove under the body's workspace passed the walk (my break N5).
    await one('productPhoto', `insert into product_images (product_id, url, token, media_type, bytes)
      select $product, '/media/' || t, t, 'image/png', decode('${png}', 'hex') from (select md5($MARK || 'photo') || md5(random()::text) as t) s returning id::text as id`);
    // Fix round 3 (F4, F6). A bank line already matched (to set aside), a customer's deletion request still open (to
    // withdraw), a follow-up waiting for a person's yes (to confirm), the account a year's result is carried to. B has
    // each too: a route broken on any of them has something of B's to take.
    await one('stmtMatch', `insert into statement_matches (business_id, statement_line_id, journal_line_id, matched_by) values ($W, $stmtLine4, $jline_4, 'owner') returning id::text as id`);
    await one('clientGone', `insert into clients (business_id, display_name) values ($W, 'Gone ' || $MARK) returning id::text as id`);
    await one('deletionRequest', `insert into deletion_requests (business_id, scope, client_id, asked_by) values ($W, 'buyer', $clientGone, 'owner') returning id::text as id`);
    await one('enrollmentWaiting', `insert into sequence_enrollments (business_id, sequence_id, identity, enrolled_by, awaiting_confirmation_since) values ($W, $sequenceLive, 'waiting-' || $MARK || '@example.com', 'owner', now()) returning id::text as id`);
    await one('resultAccount', `insert into accounts (business_id, code, name, kind) values ($W, '1191', 'Result ' || $MARK, 'equity') returning id::text as id`);
    return v;
  };

  /**
   * The advisor's kept history (R2): the workspace's switch on, its owner's and a teammate's yes, a conversation each —
   * through the port production composes, so every history route has an id of the workspace's own to reach, and B has
   * conversations a broken bound would let A delete.
   */
  const seedAdvisor = async (memory: import('../../src/advisor/memory.js').AdvisorMemory, v: Record<string, string>, mark: string) => {
    const turn = { question: `How many customers? ${mark}`, entry: 'B1', params: { period: null, customer: null, product: null, reference: null },
      kind: 'fact' as const, text: `Answer ${mark}`, lines: [`Line ${mark}`], based: [], phrased: false, door: null, subjects: [], provider: null, model: null };
    try {
      if (await memory.workspace(v['W']!, v['owner']!, true) !== 'ok') failures.push(`advisor ${v['W']}: workspace refused`);
      for (const [who, key] of [['owner', 'advisorThread'], ['person', 'advisorThreadStaff']] as const) {
        if (await memory.consent(v['W']!, v[who]!, 'granted', 'en') !== 'ok') failures.push(`advisor ${v['W']} ${who}: consent refused`);
        const id = await memory.keep(v['W']!, v[who]!, null, turn, new Date());
        if (id) v[key] = id; else failures.push(`advisor ${v['W']} ${who}: nothing kept`);
      }
    } catch (e) { failures.push(`advisor ${v['W']}: ${(e as Error).message}`); }
  };

  /** One row of every table W has rows in (and W's messages), up to `per` a table. */
  const idsOf = async (w: string, per: number) => {
    const out: { table: string; id: string }[] = [];
    for (const s of scopes) {
      const hasId = (await admin.query(`select 1 from pg_attribute where attrelid = $1::regclass and attname = 'id' and atttypid = 'uuid'::regtype and not attisdropped`, [s.table])).rowCount;
      if (!hasId) continue;
      for (const r of (await admin.query(`select id::text as id from ${s.table} x where ${s.where} order by id limit ${per}`, [w])).rows) out.push({ table: s.table, id: r.id as string });
    }
    return out;
  };

  const look = (where: string, res: { body: string; headers: Record<string, unknown>; statusCode: number }) => {
    calls++; passCalls[pass] = (passCalls[pass] ?? 0) + 1;
    statuses.set(res.statusCode, (statuses.get(res.statusCode) ?? 0) + 1);
    if (res.statusCode >= 500) errors.push(`${pass}: ${where} → ${res.statusCode}`);
    // Nothing of B shown, in words OR in bytes (F2). The marker is looked for in the raw answer (a page, JSON, a CSV,
    // a picture kept as sent), in every entry of a zip or workbook once opened, and in a PDF's streams; an answer that
    // is not words is also compared with every file B keeps. What is left — bytes with no marker that are not B's
    // files — must be A's own (kept by A, or sent by this walk): judged at the end, `binaries`.
    const raw = (res as { rawPayload?: Buffer }).rawPayload ?? Buffer.from(res.body);
    if (raw.includes(MARK) || String(res.headers['location'] ?? '').includes(MARK)) { shown.push(`${pass}: ${where}`); return; }
    const type = String(res.headers['content-type'] ?? '');
    if (res.statusCode !== 200 || raw.length === 0 || /html|json|text\/|javascript|xml|csv/i.test(type)) return;
    const hash = sha(raw);
    if (bBlobs.has(hash)) { shown.push(`${pass}: ${where} (B's file, by its bytes)`); return; }
    const inside = raw.subarray(0, 2).toString() === 'PK' ? unzipped(raw) : raw.subarray(0, 5).toString() === '%PDF-' ? pdfStreams(raw) : undefined;
    if (inside === null) { unreadable.push(`${pass}: ${where} (${type})`); return; }
    if (inside) { if (inside.some((b) => b.includes(MARK))) shown.push(`${pass}: ${where} (inside the file)`); return; }
    binaries.push({ where: `${pass}: ${where}`, hash, type });
  };
  const signIn = async (s: WS) => {
    const login = await s.app.inject({ method: 'POST', url: '/login', payload: `code=${CODE}`, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    const sessionOf = (r: { headers: Record<string, unknown> }) => ([] as string[]).concat((r.headers['set-cookie'] as string | string[]) ?? []).map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_session=')) ?? '';
    s.cookie = sessionOf(login);
    // The teammate's own session (F6), by the teammate's own code: a route that acts for "this person" needs one.
    if (s.personCode) s.personCookie = sessionOf(await s.app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(s.personCode)}`, headers: { 'content-type': 'application/x-www-form-urlencoded' } }));
  };
  /** One call, judged; a walk that signed itself out (a password changed, a session ended) signs in again and calls once more. */
  type Body = { kind: 'form'; data: string } | { kind: 'json'; data: string } | { kind: 'multipart'; data: Buffer; type: string } | null;
  const callAs = async (s: WS, method: string, url: string, body: Body, where: string) => {
    const go = () => s.app.inject({ method: method as 'POST', url, headers: { cookie: AS_PERSON.test(url) && s.personCookie ? s.personCookie : s.cookie,
      ...(body ? { 'content-type': body.kind === 'form' ? 'application/x-www-form-urlencoded' : body.kind === 'json' ? 'application/json' : body.type } : {}) },
      ...(body ? { payload: body.data } : {}) });
    const t0 = Date.now();
    let res = await go();
    if (res.statusCode >= 300 && res.statusCode < 400 && String(res.headers['location'] ?? '').startsWith('/login')) { relogins++; await signIn(s); res = await go(); }
    look(where, res);
    passMs[pass] = (passMs[pass] ?? 0) + Date.now() - t0;
    // What was sent to a route that answered 5xx (for the report: AUTHZ_WALK_REPORT).
    if (res.statusCode >= 500 && sent5xx.length < 20) sent5xx.push(`${where}: ${method} ${url.slice(0, 300)} ${body && body.kind !== 'multipart' ? body.data.slice(0, 600) : ''}`);
    return res;
  };
  const call = (method: string, url: string, body: Body, where: string) => callAs(ws.A, method, url, body, where);
  const urlencoded = (o: Record<string, string>) => new URLSearchParams(o).toString();

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL }); await admin.connect();
    await ensureQueueSchema();
    for (const ns of [NS_A, NS_B, NS_C]) await admin.query(demoSeedSql(ns));
    scopes = await readScopes();
    stateSql = `select md5(array_to_string(array[${scopes.map((s) => `(select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from ${s.table} x where ${s.where})`).join(', ')}], ',')) as h`;
    const seededA = await seedWorkspace(NS_A, A, A_MARK);
    const seededB = await seedWorkspace(NS_B, B, MARK);
    const seededC = await seedWorkspace(NS_C, C, C_MARK);
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { advisorMemory } = await import('../../src/advisor/memory.js');
    const { advisorKeysFrom } = await import('../../src/advisor/seal.js');
    const { documentStoresFrom } = await import('../../src/db/documents.js');
    const { deriveKey } = await import('../../src/security/credentials.js');
    // Where papers are kept, as production composes it (DOCUMENT_STORES unset: in the database), so the papers' routes
    // have papers to reach (R1).
    const documents = documentStoresFrom({}, deriveKey('d'.repeat(64)));
    db = createDb(DATABASE_URL!);
    // The advisor's history, as production composes it (main.ts): a port onto our own database, not a provider (R2).
    memory = advisorMemory(db, advisorKeysFrom({ ADVISOR_KEY: 'ac'.repeat(32) }));
    for (const [v, mark] of [[seededA, A_MARK], [seededB, MARK], [seededC, C_MARK]] as const) await seedAdvisor(memory, v, mark);
    // The second invoice issued by the app's own writer, then a credit note against it.
    const { issueInvoice } = await import('../../src/db/booksInvoices.js');
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    for (const v of [seededA, seededB, seededC]) {
      const bid = parseBusinessId(v['W']!); if (!bid.ok || !v['invoiceIssued']) { failures.push(`issue ${v['W']}: nothing to issue`); continue; }
      const r = await withTenantTx(db, bid.value, (tx) => issueInvoice(tx, v['W']!, v['invoiceIssued']!, 'owner'));
      if (r.kind !== 'issued') { failures.push(`issue ${v['W']}: ${JSON.stringify(r)}`); continue; }
      const cn = await admin.query(`insert into credit_notes (business_id, invoice_id, issue_date, currency, reason, created_by) values ($1, $2, '2026-04-21', 'MAD', $3, 'owner') returning id::text as id`,
        [v['W'], v['invoiceIssued'], `Credit ${v['MARK']}`]);
      v['creditNote'] = cn.rows[0].id as string;
      await admin.query(`insert into credit_note_lines (business_id, credit_note_id, line_no, invoice_line_no, quantity, net) values ($1, $2, 1, 1, 1, 100)`, [v['W'], v['creditNote']]);
      // A second draft credit note, for "discard" (issue takes the first).
      v['creditNote2'] = (await admin.query(`insert into credit_notes (business_id, invoice_id, issue_date, currency, reason, created_by) values ($1, $2, '2026-04-21', 'MAD', $3, 'owner') returning id::text as id`,
        [v['W'], v['invoiceIssued'], `Credit 2 ${v['MARK']}`])).rows[0].id as string;
    }
    const make = async (name: 'A' | 'B' | 'C', w: string, ns: string, seeded: Record<string, string>, record: boolean): Promise<WS> => {
      // AUTHZ_WALK_LOG=1: the routes' own error log, to read why one answered 5xx (never on by default).
      const app = Fastify({ logger: process.env['AUTHZ_WALK_LOG'] ? { level: 'error' } : false });
      if (record) app.addHook('onRoute', (r) => { for (const m of ([] as string[]).concat(r.method as string | string[])) routes.push({ method: m, url: r.url, source: String(r.handler) }); });
      registerWebApp(app, {
        db, businessId: w, accessCode: CODE, sessionSecret: SECRET, factsTtlMs: 0,
        employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie: false, messagingEnabled: false,
        kickOutbound: async () => {}, kickDrive: async () => {},
        // The Copilot's read-only port, so its summary reads (it answered 503 without one, and a 5xx now fails the walk);
        // the domain check's lookup, which production always passes (no network here: every record reads as absent);
        // and the advisor's history (R2), which production composes, so its routes reach their ids.
        advisorDb: db, resolveDns: async () => ({ spf: [], dkim: [], dmarc: [] }), advisorMemory: memory, documents,
      } as unknown as Parameters<typeof registerWebApp>[1]);
      await app.ready();
      const personCode = `P${name}${RUN.slice(0, 2).toUpperCase().replace(/[^A-Z2-9]/g, 'Q')}-${RUN.slice(2, 7).toUpperCase().replace(/[^A-Z2-9]/g, 'Q')}`;
      const { hashCode } = await import('../../src/api/web/people.js');
      await admin.query(`update people set code_hash = $2 where id = $1`, [seeded['person'], hashCode(SECRET, personCode)]);
      const s: WS = { name, w, conv: `${ns}-0000-4000-8000-000000000301`, seeded, tableOf: new Map(), app, cookie: '', personCookie: '', personCode };
      await signIn(s);
      expect(s.cookie).not.toBe('');
      expect(s.personCookie, `${name}'s teammate signed in`).not.toBe('');
      // A paper of the workspace's own, through the route that keeps one (the store seals it: no SQL could).
      const paperBytes = Buffer.concat([PNG, Buffer.from(`paper ${seeded['MARK']}`)]);
      if (name === 'B') bBlobs.add(sha(paperBytes)); else ownBlobs.add(sha(paperBytes));
      const m = multipart({}, { field: 'file', name: 'paper.png', type: 'image/png', bytes: paperBytes });
      const up = await app.inject({ method: 'POST', url: '/app/books/papers', headers: { cookie: s.cookie, 'content-type': m.type }, payload: m.payload });
      const paper = /\/app\/books\/spending\/([0-9a-f-]{36})/.exec(String(up.headers['location'] ?? ''))?.[1];
      if (paper) seeded['paper'] = paper; else failures.push(`seed ${name} paper: ${up.statusCode} ${String(up.headers['location'] ?? '')}`);
      for (const r of await idsOf(w, 1000)) s.tableOf.set(r.id, r.table);
      s.tableOf.set(w, 'businesses');
      return s;
    };
    ws.A = await make('A', A, NS_A, seededA, true);
    ws.C = await make('C', C, NS_C, seededC, false);
    // B's app, only to keep B a paper the way A and C have one: the walk never calls a route as B.
    ws.B = await make('B', B, NS_B, seededB, false);
    ids = await idsOf(B, 2);
    for (const r of await idsOf(B, 6)) bByTable.set(r.table, [...new Set([...(bByTable.get(r.table) ?? []), r.id])]);
    // The seeded rows of B by table, whatever their order: the expense account, the posted bank line …
    for (const r of (await idsOf(B, 1000))) if (Object.values(seededB).includes(r.id)) bByTable.set(r.table, [...new Set([...(bByTable.get(r.table) ?? []), r.id])]);
    // B's workspace id is an id (R3): `businesses` has no business_id, so the scopes never offered it.
    ids.push({ table: 'businesses', id: B });
    bByTable.set('businesses', [B]);
    theirs = new Set([...ids.map((i) => i.id), ...[...bByTable.values()].flat()].map((x) => x.toLowerCase()));
    idFields = [...new Set([...LISTED_ID_FIELDS, ...spelledIdFields()])];
    before = await snapshot(B);
    heldBefore = await heldBy(admin, scopes, A, theirs);
    // F2 — every file each workspace keeps, by the hash of its bytes (every bytea column of every table of a workspace).
    const byteCols = (await admin.query(`select c.relname as t, a.attname as col from pg_class c join pg_attribute a on a.attrelid = c.oid and a.atttypid = 'bytea'::regtype and not a.attisdropped
      where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p') order by 1, 2`)).rows as { t: string; col: string }[];
    const parts = byteCols.flatMap((b) => scopes.filter((sc) => sc.table === b.t).map((sc) => `select encode(sha256(x.${b.col}), 'hex') as h from ${sc.table} x where (${sc.where}) and x.${b.col} is not null`));
    blobSql = parts.join(' union ');
    bBlobs = new Set([...bBlobs, ...await blobsOf(B)]);
    for (const h of [...await blobsOf(A), ...await blobsOf(C)]) ownBlobs.add(h);
  }, 600_000);
  afterAll(async () => {
    await ws.A?.app.close(); await ws.B?.app.close(); await ws.C?.app.close(); await db?.destroy();
    // Orders keep their workspace (no cascade): where the purge is refused, the workspaces stay — the isolated run's
    // database is removed with them, and nothing here reads another run's rows.
    await purgeBusinesses(admin, [A, B, C], 'authz-walk-test').catch(async () => { await admin.query('rollback'); });
    await admin?.end();
  });

  it('A, B and C were seeded with rows in the tables the routes take ids of', () => {
    expect(failures, failures.join('\n')).toEqual([]);
    const tables = new Set(ids.map((i) => i.table));
    for (const t of ['conversations', 'clients', 'products', 'drafts', 'quotes', 'orders', 'labels', 'journal_lines', 'journal_entries', 'statement_lines',
      'invoices', 'spending_categories', 'people', 'assistants', 'sequences', 'product_knowledge', 'calendar_entries', 'messages', 'advisor_threads', 'businesses']) {
      expect(tables.has(t), t).toBe(true);
    }
    expect(heldBefore.size, `A's rows hold B's ids before the walk:\n${[...heldBefore].map(([t, h]) => `${t}: ${h.n}`).join('\n')}`).toBe(0);
  });

  it('every route, B\'s ids alone and among A\'s own, as a form, JSON, multipart and A\'s real forms: B untouched, A holds nothing of B\'s, nothing points across, nothing of B shown, no 5xx; and every route reached', async () => {
    const skip = /^\/(logout|login|signup|verify|hooks|webhooks|u$|p\/|pi\/|inv\/|media\/|chat\/|catalogue-media\/|assets|favicon|sw\.js|manifest)/;
    const walk = routes.filter((r) => !skip.test(r.url) && !r.url.includes('*') && r.method !== 'HEAD' && r.method !== 'OPTIONS');
    const allB = ids.map((i) => i.id);
    const bOf = (tables: readonly string[] | undefined): string[] => tables ? [...new Set(tables.flatMap((t) => bByTable.get(t) ?? []))] : allB;
    const ownOf = (s: WS, field: string, copy = 0): string | undefined => {
      const all = FIELD_OWN[field] ?? FIELD_OWN[baseOf(field)]; const k = typeof all === 'string' || all === undefined ? all : all[copy % all.length];
      return k === 'conv' ? s.conv : k ? s.seeded[k] : undefined;
    };
    /** A path parameter of the workspace's own: by the route, by its name, else by the table its segment names (`/categories/:id` → spending_categories). */
    const ownParam = (s: WS, url: string, name: string): string | undefined => {
      const byRoute = ROUTE_OWN[url]?.[name];
      if (byRoute) {
        if (byRoute.startsWith('=')) return byRoute.slice(1);
        const [key, suffix] = byRoute.split('+') as [string, string | undefined];
        return s.seeded[key] ? `${s.seeded[key]}${suffix ?? ''}` : undefined;
      }
      const byName = ownOf(s, name); if (byName) return byName;
      const seg = url.split('/:' + name)[0]!.split('/').pop() ?? '';
      const stem = seg.replace(/ies$/, '').replace(/s$/, '').replace(/-/g, '_');
      if (stem.length < 3) return undefined;
      const tables = [...new Set(s.tableOf.values())].filter((t) => t.includes(stem)).sort((x, y) => x.length - y.length);
      // The seeded row first, in the order it was seeded (the same every run), else any row of the table.
      for (const t of tables) for (const id of Object.values(s.seeded)) if (s.tableOf.get(id) === t) return id;
      for (const t of tables) for (const [id, tt] of s.tableOf) if (tt === t) return id;
      return undefined;
    };
    const fillAll = (url: string, id: string, keepConversation = false) => {
      let first = true;
      return url.replace(/:(\w+)/g, (_m, name: string) => { const was = first; first = false; return keepConversation && was && /conversation/i.test(name) ? A_CONV : id; });
    };
    const read = (src: string, f: string) => new RegExp(`['"\`]${f}['"\`]|\\b${f}\\??:|\\.${f}\\b`).test(src);
    /** B's ids everywhere: every id field holds `id`, and a field that names a workspace holds B's own (R3). */
    const wordsOf = (url: string, s: WS | null) => Object.fromEntries(Object.entries(ROUTE_WORDS[url] ?? {})
      .flatMap(([k, v]) => !v.startsWith('@') ? [[k, v]] : s?.seeded[v.slice(1)] ? [[k, s.seeded[v.slice(1)]!]] : []));
    const formOf = (id: string, url = ''): Record<string, string> => { const o: Record<string, string> = { ...WORDS }; for (const f of idFields) o[f] = BUSINESS_FIELDS.has(f) ? B : id; return { ...o, ...wordsOf(url, null) }; };
    const ownBody = (s: WS, copy: number, url = '') => { const o: Record<string, string> = { ...WORDS }; for (const f of idFields) { const x = ownOf(s, f, copy); if (x) o[f] = x; } return { ...o, ...wordsOf(url, s) }; };
    /** A drawn form's empty boxes filled as a person would type them (R1): a form refused for an empty box proves nothing. */
    // An id's box drawn empty stays empty ("none chosen"; `label` is words as often as an id, and is typed): a person
    // cannot type into a hidden box, and words in one are
    // not an id (the prices form's empty `productId` answered 500 to 'authz': reported, not this walk's to judge).
    const typed = (fields: [string, string][]): [string, string][] => fields.map(([n, v]) => [n, v !== '' ? v : n in WORDS ? WORDS[n]! : n !== 'label' && (idFields.includes(n) || /(Id|_id)$/.test(n)) ? '' : 'authz']);
    const routeOf = (method: string, action: string) => {
      const path = action.split('?')[0]!;
      return walk.filter((r) => r.method === method && new RegExp(`^${r.url.replace(/:\w+/g, '[^/]+')}$`).test(path))
        .sort((x, y) => (x.url.match(/:/g)?.length ?? 0) - (y.url.match(/:/g)?.length ?? 0))[0];
    };

    /** A route whose handler reads a file, and the file it is sent: a picture where it takes one, else a small table. */
    const readsFile = (r: { method: string; source: string }) => r.method !== 'GET' && /req\.(file|parts)\(|isMultipart\(/.test(r.source);
    let fileN = 0;
    const fileFor = (r: { url: string; source: string }) => {
      const image = /photo|image|media|paper/i.test(r.url + r.source.slice(0, 400));
      const field = /\/photo$/.test(r.url) ? 'photo' : ['photo', 'media', 'file'].find((f) => r.source.includes(`'${f}'`)) ?? 'file';
      // Each image its own bytes (a store that keeps one copy of a paper refuses the same bytes twice).
      fileN++;
      const bytes = image ? Buffer.concat([PNG, Buffer.from(`authz-${fileN}`)]) : CSV;
      ownBlobs.add(sha(bytes));
      return image ? { field, name: 'a.png', type: 'image/png', bytes } : { field, name: 'a.csv', type: 'text/csv', bytes };
    };
    /** The workspace's pages crawled, and every POST form on them by shape (up to six drawn copies of each). */
    const crawl = async (s: WS, judge = true) => {
      const pages = new Set<string>(); const queue: string[] = [];
      const ownQuery = urlencoded(Object.fromEntries(Object.keys(FIELD_OWN).map((f) => [f, ownOf(s, f) ?? '']).filter(([, v]) => v)));
      for (const r of walk.filter((x) => x.method === 'GET')) {
        if (!r.url.includes(':')) { queue.push(r.url, `${r.url}?${ownQuery}`); continue; }
        const filled = r.url.replace(/:(\w+)/g, (_m, name: string) => ownParam(s, r.url, name) ?? '');
        if (!/\/\//.test(filled) && !filled.endsWith('/')) queue.push(filled);
      }
      const forms: Form[] = [];
      const copies = new Map<string, Form[]>();
      while (queue.length && pages.size < 1500) {
        const url = queue.shift()!;
        if (pages.has(url) || /\.(csv|xlsx|zip|pdf|json)(\?|$)/.test(url)) continue;
        pages.add(url);
        const res = judge ? await callAs(s, 'GET', url, null, `GET ${url}`) : await s.app.inject({ method: 'GET', url, headers: { cookie: s.cookie } });
        if (res.statusCode !== 200 || !String(res.headers['content-type'] ?? '').includes('html')) continue;
        for (const f of formsIn(res.body)) {
          if (!f.action.startsWith('/app') && !f.action.startsWith('/login/') ) continue;
          const key = `${f.action.replace(UUID_IN, ':u')} ${f.fields.map(([n]) => n).sort().join(',')}`;
          const got = copies.get(key) ?? [];
          if (got.length < 6) { if (got.length === 0) forms.push(f); copies.set(key, [...got, f]); }
        }
        for (const h of res.body.matchAll(/href="(\/app[^"#]*)/g)) {
          const u = unescape(h[1]!);
          if (!pages.has(u) && !/logout/.test(u) && pages.size + queue.length < 3000) queue.push(u);
        }
      }
      return { pages, forms, copies };
    };

    // ── 0. REACH (R1): C, A's twin, calls every route with its OWN ids — its drawn forms as drawn, else the walk's own
    //    body — and the outcome says whether the route got past its words. A route that refuses its own workspace's
    //    call (a notice of refusal, a 4xx, a redirect that wrote nothing) proves nothing when B's id is swapped in. ──
    // B's own pages, read as B before anything is judged (F1): the forms B's owner would send, with B's ids together
    // in them. Reading a page may stamp a row (a conversation opened), so B is photographed after it.
    const drawnB = await crawl(ws.B, false);
    before = await snapshot(B);
    bBlobs = new Set([...bBlobs, ...await blobsOf(B)]);
    pass = 'reach';
    const outcome = (method: string, res: { statusCode: number; headers: Record<string, unknown> }, changed: boolean): string => {
      if (res.statusCode >= 500) return `${res.statusCode}`;
      const notice = flashKeys(res);
      const refusal = notice.find((k) => FLASH_REFUSALS.has(k));
      // A notice in a refusal's tone over a change it made (a reply approved that the channel will not carry yet) is
      // still the handler acting on the ids it was given.
      if (changed) return 'reached';
      if (refusal) return `refused: ${refusal}${flashReason(res)}`;
      if (res.statusCode >= 400) return `${res.statusCode}`;
      if (changed || notice.length) return 'reached';
      if (res.statusCode < 300) return method === 'GET' ? 'reached' : `${res.statusCode}, nothing written`;
      const to = String(res.headers['location'] ?? '').split(/[?#]/)[0]!;
      // A page that only sends the browser on (an old address, a moved page) is reached when the page it sends to is.
      if (method === 'GET' && to.startsWith('/app')) return `alias of ${to}`;
      return `redirect to ${to.replace(UUID_IN, ':id')}, no notice, nothing written`;
    };
    const tried = async (r: { method: string; url: string }, method: string, url: string, body: Body, where: string) => {
      const was = method === 'GET' ? '' : await stateOf(C);
      const res = await callAs(ws.C, method, url, body, where);
      const got = outcome(method, res, method !== 'GET' && (await stateOf(C)) !== was);
      const key = `${r.method} ${r.url}`;
      // AUTHZ_TRACE=<part of a route>: each attempt at it, to read why it is not reached (never on by default).
      if (process.env['AUTHZ_TRACE'] && key.includes(process.env['AUTHZ_TRACE'])) console.log(`[trace] ${where} ${url} → ${got}`);
      if (reach.get(key) !== 'reached') reach.set(key, got);
    };
    // Every attempt first gathered, then made with what undoes or ends things LAST: C's own call to archive a person,
    // discard a draft or end a sequence must not take away the row a later route needs (a route refused because an
    // earlier call archived its row proves nothing). Then what puts back what was taken away; last, what takes a whole
    // history or the workspace's standing.
    const ENDS = /\/(archive|remove|delete|discard|stop|disconnect|off|skip|revert|leave|dismiss|retire|end|unmatch|reject|cancel|lock|reopen|again|stale|drop)(\/|$)/;
    // A waiting cost's "skip" runs on its own row before any "post" (a drawn post form may take either row).
    const lateness = (url: string) => /\/advisor-history\/(workspace|me)$/.test(url) ? 5 : /\/alerts\/phone\/:id\/remove$/.test(url) ? 2.5 : /\/products\/import\/:importId\/confirm$/.test(url) ? 2.6 : /\/proposals\/:id\/skip$/.test(url) ? 0.4 : /\/(forget|purge|erase|close|withdraw)(\/|$)/.test(url) ? 5 : /\/restore(\/|$)/.test(url) ? 4
      : ENDS.test(url) ? 3 : /\/resume(\/|$)/.test(url) ? 2 : /\/(takeover|handto|step-in)(\/|$)/.test(url) ? 1
      // A draft is changed before it is issued or posted (after, it never changes).
      : /\/(issue|post)(\/|$)/.test(url) ? 0.5
      // The pending draft's own routes before anything that may decide or set it aside (an opt-out, a reply).
      : /\/translate$/.test(url) ? -0.6 : /\/act$|^\/app\/sequences\/:id\/steps$|^\/app\/customers\/import\/:id\/select$/.test(url) ? -0.5
      // A refund follows the payment it gives back; the books start (and the periods behind them lock) last of all.
      : /\/refunds(\/|$)/.test(url) ? 0.6 : /^\/app\/books\/closing\/start$/.test(url) ? 0.7 : /^\/app\/books\/country$/.test(url) ? 0.75 : 0;
    const attempts: { r: { method: string; url: string }; method: string; url: string; body: Body; where: string; late: number }[] = [];
    const reachC = await crawl(ws.C);
    for (const [, all] of reachC.copies) {
      const f = all[all.length - 1]!;
      const r = routeOf('POST', f.action); if (!r) continue;
      attempts.push({ r, method: 'POST', url: f.action, body: { kind: 'form', data: new URLSearchParams(typed(f.fields)).toString() }, where: `reach form ${f.action}`, late: lateness(r.url) });
    }
    for (const r of walk) {
      const key = `${r.method} ${r.url}`;
      const params = [...r.url.matchAll(/:(\w+)/g)].map((m) => m[1]!);
      const own = params.map((p) => ownParam(ws.C, r.url, p));
      const missing = params.filter((_p, k) => !own[k]);
      if (missing.length) { reach.set(key, `no id of its own for :${missing.join(', :')}`); continue; }
      let n = -1; const url = r.url.replace(/:(\w+)/g, () => { n++; return own[n]!; });
      const body = ownBody(ws.C, 0, r.url);
      const late = lateness(r.url);
      if (r.method === 'GET') { attempts.push({ r, method: 'GET', url: `${url}?${urlencoded(body)}`, body: null, where: `reach ${key}`, late: -1 }); continue; }
      // A route that also reads its query (an account to import into) gets the own ids there too; a route that caps
      // its parts gets the file alone.
      const q = /req\.query/.test(r.source) ? `?${urlencoded(body)}` : '';
      if (readsFile(r)) { const capped = /limits:\s*\{[^}]*parts:/.test(r.source); const m = multipart(capped ? {} : body, fileFor(r)); attempts.push({ r, method: r.method, url: url + q, body: { kind: 'multipart', data: m.payload, type: m.type }, where: `reach ${key} multipart`, late });
        // Not reached with its words beside it: the file alone, as the page's own upload sends it.
        const alone = multipart({}, fileFor(r)); attempts.push({ r, method: r.method, url: url + q, body: { kind: 'multipart', data: alone.payload, type: alone.type }, where: `reach ${key} multipart alone`, late }); }
      else attempts.push({ r, method: r.method, url: url + q, body: { kind: 'form', data: urlencoded(body) }, where: `reach ${key}`, late });
    }
    // Pages first, while C is as seeded: a page reads, and what a form changed must not decide whether it is drawn.
    for (const a of [-1, -0.6, -0.5, 0, 0.4, 0.5, 0.6, 0.7, 0.75, 1, 2, 2.5, 2.6, 3, 4, 5].flatMap((k) => attempts.filter((x) => x.late === k))) {
      if (reach.get(`${a.r.method} ${a.r.url}`) === 'reached') continue;
      await tried(a.r, a.method, a.url, a.body, a.where);
    }

    // AUTHZ_WALK_REACH_ONLY=1: stop after the reach check, to work through its list (never on by default).
    const reachOnly = !!process.env['AUTHZ_WALK_REACH_ONLY'];
    // Every pass below walks the routes with what undoes or ends things last too (F5), and begins with A's advisor
    // history as seeded: the pass before switched it off (the switch's own call), and a route of A's that stops at
    // "the history is off" would never read the id it was given.
    const ordered = [...walk].sort((x, y) => lateness(x.url) - lateness(y.url));
    // AUTHZ_WALK_ONLY=<pass,…>: only those passes after the reach check, to work on one (never on by default).
    const only = process.env['AUTHZ_WALK_ONLY']?.split(',');
    const runs = (p: string) => !reachOnly && (!only || only.includes(p));
    const restoreAdvisor = async () => {
      if (reachOnly) return;
      await seedAdvisor(memory, ws.A.seeded, A_MARK);
      for (const k of ['advisorThread', 'advisorThreadStaff']) if (ws.A.seeded[k]) ws.A.tableOf.set(ws.A.seeded[k]!, 'advisor_threads');
    };
    // ── 5. A's real forms, crawled first, while A is whole ────────────────────────────────────────────────────────
    pass = 'forms';
    const { pages, forms, copies } = !runs('forms') ? { pages: new Set<string>(), forms: [] as Form[], copies: new Map<string, Form[]>() } : await crawl(ws.A);
    // Any field a drawn form fills with an id is an id field, listed or not (the audit's list missed `saved`, R3):
    // the later passes put B's ids in it too.
    const drawnIdFields = [...new Set([...forms, ...[...copies.values()].flat(), ...[...reachC.copies.values()].flat()].flatMap((f) => f.fields.filter(([, v]) => UUID.test(v)).map(([n]) => n)))];
    const addedIdFields = drawnIdFields.filter((f) => !idFields.includes(f));
    idFields = [...idFields, ...addedIdFields];
    // ── 6. B'S OWN REQUESTS, UNDER A'S SESSION (F1): B's ids TOGETHER ─────────────────────────────────────────────
    //    The passes above offer one of B's ids at a time, or the same one everywhere. A route keyed by a parent and
    //    its child (a conversation and its proposal, a sequence and its enrolment, an import and its row) is only
    //    crossed by B's pair. So: every form B's own pages draw, sent as drawn; and every route called as the reach
    //    check calls it for C, with B's own rows. Each with B's workspace id in every field that names one, in the body
    //    and in the query, as a form and as JSON (and with its file where it reads one).
    //    FIRST of the passes, while A is as seeded: a pass before it leaves A's own rows changed (a discount ceiling, a
    //    draft decided), and a form refused for A's own state never reads the ids it carries — the volume discount's
    //    unchecked product was only found with this pass run alone.
    pass = 'replay';
    if (runs('replay')) {
      const withB = (fields: [string, string][]): [string, string][] => [...fields, ...[...BUSINESS_FIELDS].filter((f) => !fields.some(([n]) => n === f)).map((f) => [f, B] as [string, string])];
      for (const [, all] of drawnB.copies) for (const f of all) {
        // B's words are not sent with B's ids (a name in a box, drawn from B's row): a route that answers with what it
        // was sent would "show" them. What is shown of B must come from B's rows.
        const fields = withB(typed(f.fields)).map(([k, x]) => [k, x.split(MARK).join('zqx')] as [string, string]); const q = new URLSearchParams(fields).toString();
        const url = `${f.action}${f.action.includes('?') ? '&' : '?'}${q}`;
        await call('POST', url, { kind: 'form', data: q }, `replay B's form ${f.action}`);
        await call('POST', url, { kind: 'json', data: JSON.stringify(Object.fromEntries(fields)) }, `replay B's form ${f.action} json`);
      }
      for (const r of ordered) {
        const params = [...r.url.matchAll(/:(\w+)/g)].map((m) => m[1]!);
        const own = params.map((p) => ownParam(ws.B, r.url, p));
        if (own.some((x) => !x)) continue;
        let n = -1; const url = r.url.replace(/:(\w+)/g, () => { n++; return own[n]!; });
        const body = ownBody(ws.B, 0, r.url); const q = urlencoded(body); const where = `replay ${r.method} ${r.url}`;
        if (r.method === 'GET') { await call('GET', `${url}?${q}`, null, where); continue; }
        await call(r.method, `${url}?${q}`, { kind: 'form', data: q }, where);
        await call(r.method, `${url}?${q}`, { kind: 'json', data: JSON.stringify(body) }, `${where} json`);
        if (readsFile(r)) {
          const m = multipart(/limits:\s*\{[^}]*parts:/.test(r.source) ? {} : body, fileFor(r));
          await call(r.method, `${url}?${q}`, { kind: 'multipart', data: m.payload, type: m.type }, `${where} multipart`);
        }
      }
    }

    pass = 'forms';
    await restoreAdvisor();
    // Each swapped position submits its OWN copy of the form (the k-th position the k-th copy drawn, where A has
    // several): a swap that leaves the form valid uses A's row, and must not use up the row the next swap needs.
    for (const [, all] of copies) {
      const send = (action: string, fields: [string, string][], where: string) => call('POST', action, { kind: 'form', data: new URLSearchParams(typed(fields)).toString() }, where);
      const at = all[0]!.fields.map(([n, v]) => ({ n, v })).filter(({ n, v }) => UUID.test(v) || idFields.includes(n) || /(Id|_id)$/.test(n)).map((x) => x.n);
      for (const [k, name] of [...new Set(at)].entries()) {
        const f = all[k % all.length]!;
        const i = f.fields.findIndex(([n]) => n === name); if (i < 0) continue;
        const [n, v] = f.fields[i]!;
        const table = ws.A.tableOf.get(v);
        for (const b of bOf(table ? [table] : FIELD_TABLES[n] ?? FIELD_TABLES[baseOf(n)])) {
          const fields = f.fields.map(([k, x], j) => [k, j === i ? b : x] as [string, string]);
          await send(f.action, fields, `form ${f.action} ${n}=${b}`);
        }
      }
      const f = all[all.length - 1]!;
      for (const u of new Set(f.action.match(UUID_IN) ?? [])) {
        const table = ws.A.tableOf.get(u);
        for (const b of bOf(table ? [table] : undefined)) await send(f.action.replace(u, b), f.fields, `form ${f.action} path ${u}→${b}`);
      }
    }

    // ── 4. one of B's ids among A's own, field by field as each handler reads them ────────────────────────────────
    pass = 'mixed';
    await restoreAdvisor();
    for (const r of runs('mixed') ? ordered : []) {
      const params = [...r.url.matchAll(/:(\w+)/g)].map((m) => m[1]!);
      const ownPath = params.map((p) => ownParam(ws.A, r.url, p));
      if (ownPath.some((x) => !x)) continue;
      const pathWith = (k: number, id: string) => { let n = -1; return r.url.replace(/:(\w+)/g, () => { n++; return n === k ? id : ownPath[n]!; }); };
      const own = ownBody(ws.A, 0, r.url);
      const fields = idFields.filter((f) => read(r.source, f));
      const send = (url: string, o: Record<string, string>, where: string) => r.method === 'GET'
        ? call('GET', `${url}?${urlencoded(o)}`, null, where)
        : call(r.method, `${url}?${urlencoded(o)}`, { kind: 'form', data: urlencoded(o) }, where);
      for (const [k, f] of fields.entries()) for (const b of bOf(FIELD_TABLES[f] ?? FIELD_TABLES[baseOf(f)])) await send(pathWith(-1, ''), { ...ownBody(ws.A, k, r.url), [f]: b }, `${r.method} ${r.url} ${f}=${b}`);
      for (let k = 0; k < params.length; k++) {
        const t = ws.A.tableOf.get(ownPath[k]!);
        for (const b of bOf(t ? [t] : undefined)) await send(pathWith(k, b), own, `${r.method} ${r.url} :${params[k]}=${b}`);
      }
    }

    // ── 1–2. B's ids everywhere, as a form, and as JSON for every route that takes a body ─────────────────────────
    for (const [p, json] of [['ids', false], ['json', true]] as const) {
      pass = p;
      await restoreAdvisor();
      for (const r of runs(p) ? ordered : []) {
        if (json && r.method === 'GET') continue;
        const twice = /^\/app\/(inbox|conversations)\/:conversationId/.test(r.url) ? [false, true] : [false];
        for (const keep of twice) {
          for (const { table, id } of ids) {
            const url = fillAll(r.url, id, keep);
            const where = `${r.method} ${url} (${table})`;
            if (r.method === 'GET') await call('GET', `${url}${url.includes('?') ? '&' : '?'}${urlencoded(formOf(id, r.url))}`, null, where);
            // F3 — the query of a POST carries B's ids as its body does (the workspace's own id among them).
            else await call(r.method, `${url}?${urlencoded(formOf(id, r.url))}`, json ? { kind: 'json', data: JSON.stringify({ ...formOf(id, r.url), ids: [id] }) } : { kind: 'form', data: urlencoded(formOf(id, r.url)) }, where);
            if (!r.url.includes(':') && r.method === 'GET') break;   // a page with no id in its address: once is enough for the query
          }
        }
      }
    }

    // ── 3. multipart, for every route whose handler reads a file: a small file, the fields it reads, B's ids ────────
    pass = 'multipart';
    await restoreAdvisor();
    for (const r of (runs('multipart') ? ordered : []).filter(readsFile)) {
      const words = Object.fromEntries(Object.entries(WORDS).filter(([k]) => r.source.includes(`'${k}'`)).slice(0, 3));
      const file = fileFor(r);
      for (const { table, id } of ids) {
        const url = fillAll(r.url, id);
        const m = multipart(words, file);
        await call(r.method, `${url}?${urlencoded(formOf(id, r.url))}`, { kind: 'multipart', data: m.payload, type: m.type }, `${r.method} ${url} (${table}) multipart`);
      }
    }

    // An old address is reached when the address it sends to is (R1): resolved through the chain of them.
    const aliasReached = (o: string, depth = 0): boolean => {
      if (o === 'reached') return true;
      if (!o.startsWith('alias of ') || depth > 5) return false;
      const r = routeOf('GET', o.slice('alias of '.length));
      return !!r && aliasReached(reach.get(`GET ${r.url}`) ?? '', depth + 1);
    };
    const unreached = [...reach].filter(([, o]) => !aliasReached(o));
    const notListed = unreached.filter(([k]) => !(k in NOT_REACHED)).map(([k, o]) => `${k} — ${o}`);
    const nowReached = Object.keys(NOT_REACHED).filter((k) => aliasReached(reach.get(k) ?? ''));
    const otherwise = unreached.filter(([k, o]) => k in NOT_REACHED && NOT_REACHED[k]![0] !== o).map(([k, o]) => `${k} — answered "${o}", listed as "${NOT_REACHED[k]![0]}"`);
    // AUTHZ_WALK_REPORT=<file>: what was called and how it answered, for the audit's report (never on by default).
    const report = process.env['AUTHZ_WALK_REPORT'];
    if (report) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(report, JSON.stringify({ routes: walk.length, calls, passCalls, pages: pages.size, forms: forms.length, relogins, ids: ids.length,
        idFields: idFields.length, statuses: Object.fromEntries(statuses), errors: errors.slice(0, 400), shown: [...new Set(shown)].slice(0, 100),
        addedIdFields, reached: [...reach.values()].filter((o) => o === 'reached').length, aliases: [...reach.values()].filter((o) => o.startsWith('alias of ')).length,
        passSeconds: Object.fromEntries(Object.entries(passMs).map(([k, v]) => [k, Math.round(v / 1000)])), sent5xx, unreached: Object.fromEntries(unreached), notListed, nowReached, otherwise, binaries: binaries.length, unreadable, formsOfB: [...drawnB.copies.values()].flat().length }, null, 1));
    }
    if (reachOnly) {
      expect([...new Set(errors)], `routes answered 5xx:\n${[...new Set(errors)].join('\n')}`).toEqual([]);
      expect(notListed, notListed.join('\n')).toEqual([]);
      expect(nowReached, `listed in NOT_REACHED, and reached:\n${nowReached.join('\n')}`).toEqual([]);
      expect(otherwise, `not reached for another reason than the one listed:\n${otherwise.join('\n')}`).toEqual([]);
      return;
    }
    const after = await snapshot(B);
    const changed = [...before].filter(([t, h]) => after.get(t) !== h).map(([t, h]) => `${t}: ${h} → ${after.get(t)}`);
    // Every value of A's that holds one of B's ids, judged whole (authzHeld.ts): the one exemption is B's id as the whole
    // of a `label`, the owner's typed words stored as typed.
    const held = [...await heldBy(admin, scopes, A, theirs)].filter(([t, h]) => h.n > (heldBefore.get(t)?.n ?? 0))
      .map(([t, h]) => `${t}: ${h.n} row(s) ${JSON.stringify(h.shapes)}`);
    const across = await crossings();
    // F2 — an answer that is not words, to a call that carried B's ids, is A's own or it fails: its bytes are kept by A
    // (or by C, whose own calls the reach check made) now or at the start, or were sent by this walk.
    const kept = new Set([...ownBlobs, ...await blobsOf(A), ...await blobsOf(C)]);
    const unproven = [...new Set(binaries.filter((b) => !kept.has(b.hash)).map((b) => `${b.where} (${b.type})`))];
    // The session is still A's, and still works.
    if ((await ws.A.app.inject({ method: 'GET', url: '/app', headers: { cookie: ws.A.cookie } })).statusCode !== 200) await signIn(ws.A);
    expect((await ws.A.app.inject({ method: 'GET', url: '/app', headers: { cookie: ws.A.cookie } })).statusCode).toBe(200);
    expect(calls).toBeGreaterThan(1000);
    if (!only) expect(forms.length, 'the crawl found A\'s forms').toBeGreaterThan(50);
    expect(changed, `B's rows changed:\n${changed.join('\n')}`).toEqual([]);
    expect(held, `A's rows hold B's ids:\n${held.join('\n')}`).toEqual([]);
    expect(across, `rows point across workspaces:\n${across.join('\n')}`).toEqual([]);
    expect(unproven.slice(0, 40), `answers that are not words and not provably A's own:\n${unproven.slice(0, 40).join('\n')}`).toEqual([]);
    expect(unreadable.slice(0, 40), `files the walk could not open to look inside:\n${unreadable.slice(0, 40).join('\n')}`).toEqual([]);
    expect(nowReached, `listed in NOT_REACHED, and reached:\n${nowReached.join('\n')}`).toEqual([]);
    expect(otherwise, `not reached for another reason than the one listed:\n${otherwise.join('\n')}`).toEqual([]);
    expect([...new Set(shown)].slice(0, 40), `B's words shown to A:\n${[...new Set(shown)].slice(0, 40).join('\n')}`).toEqual([]);
    expect([...new Set(errors)].slice(0, 40), `routes answered 5xx:\n${[...new Set(errors)].slice(0, 40).join('\n')}`).toEqual([]);
    expect(notListed, `routes C's own call does not get past their first checks (send what they need, or list them in NOT_REACHED with the reason):\n${notListed.join('\n')}`).toEqual([]);
  });
});

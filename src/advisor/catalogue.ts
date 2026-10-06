import type { MessageKey } from '../core/owner/i18n/messages.js';

/**
 * THE ADVISOR'S CATALOGUE (docs/ADVISOR-GROUNDING.md, section 4; approved 2026-10-06). Every question the
 * advisor answers, as data: what it asks (in English, for the model's routing — the owner may ask in any
 * language), and where its answer comes from.
 *
 *   grounded   an existing definition answers it (src/advisor/reads.ts names which);
 *   new        a new read-only query, written for it in reads.ts;
 *   metric     one of the two the owner approved: reply times (B8) and revenue at the owner's stated rate (D8);
 *   notStored  Nomi does not record it: its fixed sentence, always — no query, no model;
 *   opinion    advice, under "My suggestion, not a fact from your records:", standing only on the entries it
 *              names (`cites`), never on anything else.
 */

export type EntryKind = 'grounded' | 'new' | 'metric' | 'notStored' | 'opinion';

export type Entry = {
  readonly id: string;
  readonly kind: EntryKind;
  /** What it asks, for routing. */
  readonly ask: string;
  /** notStored, and the one opinion with nothing to stand on: the fixed sentence. */
  readonly says?: MessageKey;
  /** opinion: the factual entries it may cite, and only these. */
  readonly cites?: readonly string[];
};

const g = (id: string, ask: string): Entry => ({ id, kind: 'grounded', ask });
const n = (id: string, ask: string): Entry => ({ id, kind: 'new', ask });
const none = (id: string, ask: string, says: MessageKey): Entry => ({ id, kind: 'notStored', ask, says });
const advice = (id: string, ask: string, cites: readonly string[], says?: MessageKey): Entry =>
  ({ id, kind: 'opinion', ask, cites, ...(says ? { says } : {}) });

export const CATALOGUE: readonly Entry[] = [
  // A · Customers
  g('A1', 'How many customers the business has.'),
  g('A2', 'The list of the business\'s customers.'),
  g('A3', 'About one named customer: who they are, what they bought, asked about or spent.'),
  { id: 'A4', kind: 'grounded', ask: 'When the business last talked to a named customer, or when that customer last wrote.' },
  n('A5', 'Which customers contacted the business most recently.'),
  g('A6', 'How many new customers there were in a period.'),
  g('A7', 'The best customers: who spent the most.'),
  g('A8', 'Which customers are regulars, who ordered three times or more.'),
  none('A9', 'Where customers are from; customers by country.', 'advisor.notStored.country'),
  n('A10', 'Which channel customers use most (WhatsApp, Instagram, Messenger, e-mail).'),
  // B · Conversations, and what waits
  g('B1', 'Who is waiting for the owner; what needs the owner now.'),
  g('B2', 'Replies the assistant drafted that wait for the owner\'s review.'),
  g('B3', 'Customers handed over and waiting for a person.'),
  g('B4', 'Replies that failed to reach a customer.'),
  g('B5', 'How many conversations there were in a period.'),
  none('B6', 'Unread messages; what the owner has not read yet.', 'advisor.notStored.unread'),
  g('B7', 'Customers who wrote last and have had no answer yet.'),
  { id: 'B8', kind: 'metric', ask: 'How fast the business replies to customers; reply time in a period.' },
  g('B9', 'Customers\' requests to delete their data that wait.'),
  // C · Gone quiet, and follow-ups
  g('C1', 'Customers who have gone quiet or stopped replying.'),
  g('C2', 'Customers who have not answered since they were given a price.'),
  g('C3', 'Regular customers who stopped ordering.'),
  g('C4', 'Follow-ups that are due; follow-ups promised to customers.'),
  none('C5', 'Why deals were lost; which deals were lost.', 'advisor.notStored.lost'),
  // D · Sales and orders
  g('D1', 'How much the business sold; sales or revenue in a period.'),
  g('D2', 'How many orders there were in a period, and in which state.'),
  g('D3', 'Orders customers said yes to that wait for the owner\'s OK.'),
  g('D4', 'How many prices or quotes were sent in a period.'),
  n('D5', 'The average order value in a period.'),
  none('D6', 'The conversion rate or win rate.', 'advisor.notStored.winRate'),
  n('D7', 'Whether sales this month are better than last month.'),
  { id: 'D8', kind: 'metric', ask: 'Sales in the owner\'s own currency, converted at the owner\'s rate, in a period.' },
  none('D9', 'Payments received, unpaid invoices, refunds; whether a customer paid.', 'advisor.notStored.payments'),
  none('D10', 'Profit or margin.', 'advisor.notStored.profit'),
  n('D11', 'Where one order stands, by its reference.'),
  // E · Schedule
  g('E1', 'What is on the calendar today or this week.'),
  g('E2', 'What is coming up next on the calendar.'),
  g('E3', 'Samples waiting to go out.'),
  g('E4', 'Replies that are overdue.'),
  g('E5', 'When the business is closed; its closures.'),
  { id: 'E6', kind: 'grounded', ask: 'When a named customer\'s order will arrive; a delivery date.' },
  // F · Products
  g('F1', 'What the business sells; the price of a product.'),
  n('F2', 'Which products sell best in a period.'),
  n('F3', 'Which products customers ask about most in a period.'),
  g('F4', 'Products that have no price.'),
  none('F5', 'Stock levels; how much stock there is.', 'advisor.notStored.stock'),
  none('F6', 'What a product costs the business; costs.', 'advisor.notStored.costs'),
  // G · The assistant
  g('G1', 'How much the assistant does alone; its level.'),
  g('G2', 'How many conversations the assistant handled in a period.'),
  n('G3', 'How many replies the assistant sent alone and how many the owner approved, in a period.'),
  g('G4', 'How often the owner corrected the assistant\'s replies in a period.'),
  g('G5', 'Questions the assistant could not answer in a period.'),
  g('G6', 'Why customers needed a person in a period.'),
  g('G7', 'Work of the assistant waiting to be checked (spot checks).'),
  g('G8', 'Whether the assistant is stopped or paused.'),
  advice('G9', 'Whether the assistant is doing a good job.', ['G2', 'G4', 'G5', 'G6', 'G7']),
  // H · The business
  g('H1', 'The business\'s payment terms, sample policy, how it sells, its profile.'),
  { id: 'H2', kind: 'grounded', ask: 'The business\'s opening hours.' },
  none('H2n', 'Whether the business is open right now.', 'advisor.notStored.openNow'),
  g('H3', 'What the assistant knows about a product, or about the business.'),
  // I · Advice
  advice('I1', 'What to post; marketing ideas.', ['F3', 'F2', 'G5']),
  advice('I2', 'What the business is doing wrong; what to improve.', ['G6', 'G5', 'C2', 'B4', 'G4']),
  advice('I3', 'Which customers to follow up first.', ['C1', 'C2', 'C3', 'A7']),
  advice('I4', 'Whether to raise or change prices.', ['F1', 'D1', 'D2']),
  advice('I5', 'Strategy; how to grow the business.', ['A1', 'D1', 'G2', 'C1', 'F2']),
  advice('I6', 'What competitors are doing.', [], 'advisor.opinion.competitors'),
];

export const entryOf = (id: string): Entry | undefined => CATALOGUE.find((e) => e.id === id);

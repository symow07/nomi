import type { MessageKey } from '../../core/owner/i18n/messages.js';
import type { SetupStep } from '../../db/setup.js';

/**
 * Block 6.1 — WHICH GUIDES A PAGE SHOWS. The "?" on every owner page opens two or three short guides for that page
 * (helpPanel.ts); this file is the map, and the guides' own sources.
 *
 * A guide is written in English from the product as built (src/core/owner/i18n/help.ts). It names where it came
 * from: a docs/kb article it was rewritten from, or the page it describes. `KB_SOURCES` accounts for every docs/kb
 * article: the guides it became, or why it was left out. tests/parity/help-panel.test.ts holds both to the folder.
 */
export type GuideId =
  | 'setup' | 'profile' | 'channels' | 'whatsapp' | 'approve' | 'inbox' | 'products' | 'away' | 'alone' | 'name'
  | 'disclosure' | 'data' | 'practice' | 'knowledge' | 'customers' | 'calendar' | 'books' | 'team' | 'billing';

export type Guide = {
  readonly id: GuideId;
  /** The page that does what the guide describes. */
  readonly door: string;
  /** The setup step whose recorded video shows it, where one exists (guide.ts, rule 81). */
  readonly video?: SetupStep;
  /** How many lines it has (`help.g.<id>.<n>`). */
  readonly lines: 2 | 3;
};

export const GUIDES: Readonly<Record<GuideId, Guide>> = {
  setup: { id: 'setup', door: '/app/get-started', lines: 3 },
  profile: { id: 'profile', door: '/app/settings/business/profile', video: 'profile', lines: 2 },
  channels: { id: 'channels', door: '/app/settings/channels', video: 'channels', lines: 3 },
  whatsapp: { id: 'whatsapp', door: '/app/settings/channels/whatsapp', lines: 3 },
  approve: { id: 'approve', door: '/app/inbox', video: 'first_success', lines: 3 },
  inbox: { id: 'inbox', door: '/app/inbox', lines: 3 },
  products: { id: 'products', door: '/app/products/add', video: 'products', lines: 3 },
  away: { id: 'away', door: '/app', lines: 3 },
  alone: { id: 'alone', door: '/app/settings/assistant/alone', lines: 3 },
  name: { id: 'name', door: '/app/settings/assistant/name', video: 'name', lines: 2 },
  disclosure: { id: 'disclosure', door: '/app/settings/assistant/name', lines: 3 },
  data: { id: 'data', door: '/app/settings/business/data', lines: 3 },
  practice: { id: 'practice', door: '/app/assistant/practice', video: 'first_success', lines: 3 },
  knowledge: { id: 'knowledge', door: '/app/assistant/knowledge', lines: 3 },
  customers: { id: 'customers', door: '/app/customers', lines: 2 },
  calendar: { id: 'calendar', door: '/app/calendar', lines: 2 },
  books: { id: 'books', door: '/app/books', lines: 2 },
  team: { id: 'team', door: '/app/settings/team', lines: 2 },
  billing: { id: 'billing', door: '/app/settings/billing', lines: 2 },
};

export const guideTitle = (id: GuideId): MessageKey => `help.g.${id}.title` as MessageKey;
export const guideDoor = (id: GuideId): MessageKey => `help.g.${id}.door` as MessageKey;
export const guideLines = (id: GuideId): MessageKey[] =>
  Array.from({ length: GUIDES[id].lines }, (_, i) => `help.g.${id}.${i + 1}` as MessageKey);

/**
 * Where each guide came from. A kb article is a draft (owner review); each guide was checked against the code and
 * the positioning (customers, not buyers; no quote, minimum or factory frame) and says only what is built.
 */
export const GUIDE_SOURCE: Readonly<Record<GuideId, string>> = {
  setup: 'docs/kb/01-first-ten-minutes.md', practice: 'docs/kb/01-first-ten-minutes.md',
  channels: 'docs/kb/02-connect-whatsapp.md', whatsapp: 'docs/kb/02-connect-whatsapp.md',
  approve: 'docs/kb/03-approve-edit-skip.md', products: 'docs/kb/04-catalog-import.md',
  away: 'docs/kb/05-night-shift.md', alone: 'docs/kb/06-promotion-revoke.md',
  data: 'docs/kb/09-data-export.md', disclosure: 'docs/kb/10-buyer-privacy.md',
  profile: 'page', inbox: 'page', name: 'page', knowledge: 'page', customers: 'page', calendar: 'page',
  books: 'page', team: 'page', billing: 'page',
};

/** Every docs/kb article: the guides it became, or why it was left out (listed for the owner). */
export const KB_SOURCES: Readonly<Record<string, readonly GuideId[] | { readonly dropped: string }>> = {
  '01-first-ten-minutes.md': ['setup', 'practice'],
  '02-connect-whatsapp.md': ['channels', 'whatsapp'],
  '03-approve-edit-skip.md': ['approve'],
  '04-catalog-import.md': ['products'],
  '05-night-shift.md': ['away'],
  '06-promotion-revoke.md': ['alone'],
  '07-mistakes-repair.md': { dropped: 'describes a repair flow (auto-replies stopped, a correction draft, a training record) that is not built' },
  '08-pricing-billing.md': { dropped: 'about Nomi\'s own prices, which are not published; the Billing guide is written from the page instead' },
  '09-data-export.md': ['data'],
  '10-buyer-privacy.md': ['disclosure'],
};

/**
 * The page → guides map: the longest matching prefix wins; `/app` matches only itself. Two or three each, the
 * page's own first.
 */
const BY_PREFIX: readonly (readonly [string, readonly GuideId[]])[] = [
  ['/app', ['setup', 'approve', 'away']],
  ['/app/inbox', ['approve', 'inbox', 'disclosure']],
  ['/app/conversations', ['approve', 'inbox', 'disclosure']],
  ['/app/customers', ['customers', 'approve', 'data']],
  ['/app/orders', ['customers', 'away']],
  ['/app/products', ['products', 'knowledge']],
  ['/app/business/prices', ['products', 'alone']],
  ['/app/assistant', ['knowledge', 'practice', 'alone']],
  ['/app/assistant/practice', ['practice', 'approve', 'alone']],
  ['/app/assistant/knowledge', ['knowledge', 'practice']],
  ['/app/advisor', ['setup', 'knowledge']],
  ['/app/knowledge', ['knowledge', 'practice']],
  ['/app/sandbox', ['practice', 'approve']],
  ['/app/calendar', ['calendar', 'away']],
  ['/app/results', ['away', 'alone']],
  ['/app/analytics', ['away', 'alone']],
  ['/app/get-started', ['setup', 'channels', 'practice']],
  ['/app/guide', ['setup', 'channels', 'practice']],
  ['/app/onboarding', ['setup', 'channels', 'practice']],
  ['/app/ready', ['setup', 'practice', 'alone']],
  ['/app/help', ['setup', 'channels']],
  ['/app/books', ['books', 'data']],
  ['/app/settings', ['profile', 'channels', 'alone']],
  ['/app/settings/business', ['profile', 'products', 'data']],
  ['/app/settings/business/data', ['data', 'customers']],
  ['/app/settings/data', ['data', 'customers']],
  ['/app/settings/channels', ['channels', 'whatsapp']],
  ['/app/settings/channels/whatsapp', ['whatsapp', 'channels']],
  ['/app/channels', ['channels', 'whatsapp']],
  ['/app/connect', ['channels', 'whatsapp']],
  ['/app/settings/assistant', ['alone', 'name', 'disclosure']],
  ['/app/settings/assistant/name', ['name', 'disclosure']],
  ['/app/employee', ['alone', 'name']],
  ['/app/settings/team', ['team', 'approve']],
  ['/app/settings/people', ['team', 'approve']],
  ['/app/settings/billing', ['billing', 'data']],
  ['/app/settings/books', ['books', 'data']],
  ['/app/settings/personal', ['team', 'data']],
];

/** The guides for a page, by its path (a query or fragment is ignored). Never empty. */
export function helpFor(path: string): readonly GuideId[] {
  const url = ((path.split(/[?#]/)[0] ?? path).replace(/\/+$/, '')) || '/app';
  let best: readonly [string, readonly GuideId[]] = BY_PREFIX[0]!;
  for (const entry of BY_PREFIX) {
    const [prefix] = entry;
    const hit = prefix === '/app' ? url === '/app' : url === prefix || url.startsWith(`${prefix}/`);
    if (hit && prefix.length > best[0].length) best = entry;
  }
  return best[1];
}

/** The longest page address the help panel takes. */
export const FROM_MAX = 200;

/**
 * The page a help request came from, or null. Only a same-origin owner path: it starts with `/app`, is made of
 * plain path characters (no scheme, no `//`, no backslash, no percent-encoding, no dot segment), and is at most
 * `FROM_MAX` long. A query or fragment is dropped. Anything else gives the general guides, and is never used as a
 * link or a redirect.
 */
export function pageFrom(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > FROM_MAX) return null;
  const path = raw.split(/[?#]/)[0] ?? '';
  if (!/^\/app(?:\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9]+)?)*\/?$/.test(path)) return null;
  return path.replace(/\/+$/, '') || '/app';
}

import { describe, it, expect } from 'vitest';
import {
  usabilitySeedSql, usabilityChecks, usabilityBusinessId, inNamespace,
  USABILITY_BUYERS, USABILITY_CONVERSATIONS, USABILITY_HANDED, USABILITY_DRAFT, USABILITY_STAFF,
  USABILITY_REGULAR, USABILITY_REGULAR_PAST,
} from '../../src/demo/usability.js';
import { REGULAR_ORDERS, SPEND_STATUSES } from '../../src/db/customerValue.js';
import { DEMO_CONVERSATIONS, DEMO_NAMESPACE, DEMO_PRODUCTS } from '../../src/demo/factory.js';

/**
 * The usability workspace (docs/USABILITY-SCRIPT.md "开始前的准备") is a
 * fixture with a list to meet. This holds the shape of the fixture; the
 * integration test of the same name holds that the app's own readers see it
 * the way the script needs.
 */
const DAY = 1440;
const lastAge = (c: { messages: readonly { ageMin: number }[] }) => c.messages.at(-1)!.ageMin;

describe('usability workspace · the fixture', () => {
  it('is deterministic', () => {
    expect(usabilitySeedSql()).toBe(usabilitySeedSql());
  });

  it('with the demo factory, exceeds the fifty-row window', () => {
    expect(USABILITY_CONVERSATIONS.length + DEMO_CONVERSATIONS.length).toBeGreaterThanOrEqual(60);
    expect(new Set(USABILITY_CONVERSATIONS.map((c) => c.id)).size).toBe(USABILITY_CONVERSATIONS.length);
    expect(new Set(USABILITY_BUYERS.map((b) => b.phone)).size).toBe(USABILITY_BUYERS.length);
  });

  it('every buyer has a thirteen-digit number, so re-namespacing keeps them apart', () => {
    for (const b of USABILITY_BUYERS) expect(b.phone, b.name).toMatch(/^\d{13}$/);
  });

  it('exactly one conversation is handed to a colleague, replied to, and older than every other', () => {
    const handed = USABILITY_CONVERSATIONS.filter((c) => c.kind === 'handed');
    expect(handed).toHaveLength(1);
    const h = handed[0]!;
    expect(h).toBe(USABILITY_HANDED);
    expect(h.messages.at(-1)!.dir).toBe('outbound');
    expect(lastAge(h)).toBeGreaterThan(7 * DAY);
    for (const c of USABILITY_CONVERSATIONS) if (c !== h) expect(lastAge(c), c.buyer.name).toBeLessThan(lastAge(h));
    expect(usabilitySeedSql()).toContain(`'${USABILITY_STAFF.id}'`);
  });

  it('one draft waits, on a buyer who wrote within the hour', () => {
    expect(USABILITY_CONVERSATIONS.filter((c) => c.kind === 'draft')).toHaveLength(1);
    expect(USABILITY_DRAFT.messages.at(-1)!.dir).toBe('inbound');
    expect(lastAge(USABILITY_DRAFT)).toBeLessThan(60);
    expect(usabilitySeedSql()).toMatch(/insert into drafts[^;]*'pending'/);
  });

  it('has activity today and yesterday', () => {
    expect(USABILITY_CONVERSATIONS.some((c) => lastAge(c) < 8 * 60)).toBe(true);
    expect(USABILITY_CONVERSATIONS.some((c) => lastAge(c) > DAY && lastAge(c) < 2 * DAY)).toBe(true);
  });

  it('quotes name a demo product and its tier price', () => {
    for (const c of USABILITY_CONVERSATIONS) {
      expect(DEMO_PRODUCTS.some((p) => p.id === c.product.id), c.buyer.name).toBe(true);
      expect(c.qty).toBeGreaterThanOrEqual(c.product.tiers[0]![0]);
    }
  });

  it('every write is guarded, so a second run changes nothing', () => {
    const sql = usabilitySeedSql();
    const inserts = sql.split('\n').filter((l) => l.startsWith('insert into'));
    expect(inserts.length).toBeGreaterThan(200);
    const guarded = (sql.match(/on conflict|where not exists/g) ?? []).length;
    expect(guarded).toBeGreaterThanOrEqual(inserts.length);
  });

  it('re-namespacing touches ids, the order reference and phones, and nothing else', () => {
    const a = usabilitySeedSql();
    const b = usabilitySeedSql('f1234567');
    expect(b).not.toContain(DEMO_NAMESPACE);
    expect(b.length).toBe(a.length);
    expect(b).toContain(usabilityBusinessId('f1234567'));
    expect(b).toContain(inNamespace(USABILITY_HANDED.id, 'f1234567'));
  });

  // The warmth run, phase 9 (w4-today-setup-01): Today, the assistant's month
  // and Results read the SENT rows; a seed that wrote only the transcript's
  // copies drew Today with no hero, no faces and "0 · 0 · 0".
  it('every reply is sent the way the product records a send: a sent row, and its copy under the row\'s id', () => {
    const sql = usabilitySeedSql();
    const replies = USABILITY_CONVERSATIONS.flatMap((c) => c.messages.filter((m) => m.dir === 'outbound').map((m) => ({ c, m })));
    expect(replies.length).toBeGreaterThan(60);
    const sent = [...sql.matchAll(/insert into outbound_messages[^\n]*\n  \('([0-9a-f-]{36})', '[^']+', '([0-9a-f-]{36})', \d+, '((?:[^']|'')*)', 'sent', '(employee|owner)', 'whatsapp'/g)];
    const copies = new Set([...sql.matchAll(/'out:([0-9a-f-]{36})', 'outbound'/g)].map((m) => m[1]!));
    expect(sent.length).toBe(replies.length + USABILITY_REGULAR_PAST.length);
    expect(new Set(sent.map((m) => m[1])).size).toBe(sent.length);
    for (const [, id] of sent) expect(copies.has(id!), id).toBe(true);
    // No reply is left a transcript line without its sent row.
    expect(sql).not.toMatch(/'usab-[0-9a-f]{4}-\d+', 'outbound'/);
    // The colleague's reply in the handed conversation is a person's; every other the assistant's.
    const handed = sent.filter((m) => m[2] === USABILITY_HANDED.id);
    expect(handed.map((m) => m[4])).toEqual(['owner']);
    expect(sent.filter((m) => m[2] !== USABILITY_HANDED.id).every((m) => m[4] === 'employee')).toBe(true);
    // Today's freshest replies are dated like their transcript lines, so the day counts them.
    const fresh = USABILITY_CONVERSATIONS[0]!;
    expect(sql).toMatch(new RegExp(`\\('[0-9a-f-]{36}', '[^']+', '${fresh.id}', 1, '[^\\n]*'sent', 'employee', 'whatsapp', greatest\\(`));
  });

  it('one regular customer: three orders that stand, from conversations of their own, the last one recent', () => {
    const sql = usabilitySeedSql();
    const buyer = USABILITY_REGULAR.buyer.id;
    const orders = [...sql.matchAll(/insert into orders [^\n]*\n  \('[0-9a-f-]{36}', '[^']+', '[^']+', '([0-9a-f-]{36})', '([0-9a-f-]{36})', [^\n]*?, '([a-z_]+)', '[^']*', '[^']*', 'FOB'/g)]
      .filter((m) => m[1] === buyer);
    expect(orders.length).toBeGreaterThanOrEqual(REGULAR_ORDERS);
    expect(orders.every((m) => (SPEND_STATUSES as readonly string[]).includes(m[3]!))).toBe(true);
    // One open order per conversation (0003): each in its own.
    expect(new Set(orders.map((m) => m[2])).size).toBe(orders.length);
    // The earlier conversations are closed, and older than every conversation of the script.
    for (const p of USABILITY_REGULAR_PAST) {
      expect(sql).toMatch(new RegExp(`\\('${p.id}', '[^']+', '${buyer}', 'whatsapp', 'confirmation', false,`));
      expect(p.ageMin).toBeGreaterThan(USABILITY_HANDED.messages.at(-1)!.ageMin);
    }
  });

  it('carries no real-looking secret', () => {
    expect(usabilitySeedSql()).not.toMatch(/D360|api[_-]?key|Bearer/i);
  });

  it('every check reads this business and answers with `ok`', () => {
    const checks = usabilityChecks('f1234567');
    expect(checks.map((c) => c.key)).toEqual(['sixty', 'handed', 'window', 'draft', 'products', 'yesterday', 'instagram']);
    for (const c of checks) {
      expect(c.sql, c.key).toContain(usabilityBusinessId('f1234567'));
      expect(c.sql, c.key).toMatch(/ as ok\b/);
      expect(c.sql, c.key).not.toContain(DEMO_NAMESPACE);
      expect(c.zh.length, c.key).toBeGreaterThan(0);
      expect(c.en.length, c.key).toBeGreaterThan(0);
    }
  });
});

import { describe, it, expect } from 'vitest';
import {
  usabilitySeedSql, usabilityChecks, usabilityBusinessId, inNamespace,
  USABILITY_BUYERS, USABILITY_CONVERSATIONS, USABILITY_HANDED, USABILITY_DRAFT, USABILITY_STAFF,
} from '../../src/demo/usability.js';
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

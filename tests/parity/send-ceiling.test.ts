import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { metaErrorAlarms, META_ERROR_MIN_FAILED, META_ERROR_RATE_DENOMINATOR, type MetaErrorRate } from '../../src/core/ops/metaErrors.js';
import { renderOwnerAlert, OPERATOR_ALERT_KINDS, goesByMail } from '../../src/pipeline/notify.js';
import { DAILY_OUTBOUND_CEILING } from '../../src/core/channel/limits.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';

/**
 * CEIL (0085) — the parts no database is needed for: when a workspace's
 * errors on Meta's channels are the operator's news, and how the alert says
 * it. The ceiling in the gate and the counting are
 * tests/integration/send-ceiling.test.ts.
 */

const MIGRATION = readFileSync(fileURLToPath(new URL('../../migrations/0085_send_ceiling.sql', import.meta.url)), 'utf8');
const rate = (business: string, attempted: number, failed: number): MetaErrorRate => ({ business, attempted, failed, errors: ['meta 401'] });

describe('CEIL · the ceiling', () => {
  it('a new workspace starts at 50; the ones that existed keep 200 — in the migration as in the constants', () => {
    expect(DAILY_OUTBOUND_CEILING).toBe(200);
    expect(MIGRATION).toContain(`update businesses set daily_send_ceiling = ${DAILY_OUTBOUND_CEILING} where daily_send_ceiling is null;`);
    expect(MIGRATION).toContain('alter column daily_send_ceiling set default 50;');
  });
});

describe('CEIL · when Meta\'s errors are the operator\'s news', () => {
  it('both: at least five refused or lost, AND at least one in five of the day', () => {
    expect(META_ERROR_MIN_FAILED).toBe(5);
    expect(META_ERROR_RATE_DENOMINATOR).toBe(5);
    const got = metaErrorAlarms([
      rate('noise', 3, 2),          // two of three: too few to be news
      rate('normal day', 4000, 40), // forty of four thousand: a normal day
      rate('on the line', 25, 5),   // five of twenty-five: exactly one in five
      rate('bad', 10, 6),
      rate('worse', 8, 8),
      rate('nothing sent', 0, 0),
    ]).map((r) => r.business);
    expect(got).toEqual(['worse', 'bad', 'on the line']);
  });

  it('an operator alert, by e-mail always', () => {
    expect(OPERATOR_ALERT_KINDS).toContain('meta_errors');
    expect(goesByMail('meta_errors')).toBe(true);
  });

  it('says which workspaces, the day\'s counts, the provider\'s words, and what to do — in each language', () => {
    for (const l of LOCALES) {
      const text = renderOwnerAlert(l, 'meta_errors', null, {
        metaErrors: [{ business: 'Noisy Shop', attempted: 10, failed: 6, errors: ['meta 401', '131026 undeliverable'] }],
      });
      expect(text, l).toContain(t(l, 'notify.meta_errors', { n: 1 }));
      expect(text, l).toContain('Noisy Shop');
      expect(text, l).toContain('meta 401; 131026 undeliverable');
      expect(text, l).toContain('tools/send-ceiling.mjs');
      expect(t(l, 'notify.meta_errors.subject').length, l).toBeGreaterThan(5);
    }
  });

  it('a long list is cut and counted', () => {
    const many = Array.from({ length: 13 }, (_, i) => ({ business: `Shop ${i}`, attempted: 10, failed: 6, errors: [] as string[] }));
    const text = renderOwnerAlert('en', 'meta_errors', null, { metaErrors: many });
    expect(text).toContain(t('en', 'notify.meta_errors.more', { n: 3 }));
    expect(text).not.toContain('Shop 12');
  });
});

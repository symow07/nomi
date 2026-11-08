import { describe, expect, it } from 'vitest';
import { renderFollowUpRule, renderFollowUps } from '../../src/api/web/followUps.js';
import type { FollowUpRun } from '../../src/db/followUps.js';
import { buttonsAndDoors } from './buttons-and-doors.js';
import { FOLLOW_UPS_EN } from '../../src/core/owner/i18n/followUps.js';
import { readFileSync } from 'node:fs';
import { renderMonthReport } from '../../src/api/web/monthReport.js';
import { FIXTURE_MONTH_REPORT } from '../../src/core/report/month.js';
const now = new Date('2031-05-03T09:00:00Z');
const run: FollowUpRun = {
  id: '00000000-0000-4000-8000-000000000001', business_id: 'b', client_id: 'c', conversation_id: 'conversation',
  source_quote_id: 'quote', source_outbound_id: 'outbound', episode_message_id: null, episode_key: 'c',
  channel: 'whatsapp', quoted_at: new Date('2031-05-01T09:00:00Z'), due_at: now, delay_days: 2, wording: 'My words',
  state: 'scheduled', reason: null, draft_id: null, presented_at: null, answered_after_approval: false,
};
describe('Follow-up owner states', () => {
  it('lists every new English-only sentence for native review, with no invented translations', () => {
    const doc = readFileSync(new URL('../../docs/NATIVE-REVIEW-UI.md', import.meta.url), 'utf8');
    for (const [key, text] of Object.entries(FOLLOW_UPS_EN)) expect(doc).toContain(`| \`${key}\` | ${text} |`);
  });
  for (const locale of ['en', 'ar'] as const) {
    it(`${locale}: the off rule has labelled controls, exact preview, and no grant promise`, () => {
      const html = renderFollowUpRule(locale, { enabled: false, delayDays: 2, wording: 'My <exact> words' }, true);
      expect(html).toContain('action="/app/settings/assistant/follow-ups"');
      expect(html).toContain('for="follow-up-wording"');
      expect(html).toContain('for="follow-up-delay"');
      expect(html).toContain('My &lt;exact&gt; words');
      expect(html).toContain('You choose Send');
      expect(html).not.toContain('checked');
      expect(html).toContain('<bdi lang="en" dir="ltr">');
      expect(buttonsAndDoors(html)).toEqual([]);
    });
    it(`${locale}: staff can read the rule and run but cannot save or skip`, () => {
      const html = renderFollowUpRule(locale, { enabled: true, delayDays: 2, wording: 'My words' }, false)
        + renderFollowUps(locale, [run], false, now);
      expect(html).toContain('My words');
      expect(html).toContain('Follow-up');
      expect(html).not.toMatch(/<form|<button/);
    });
    it(`${locale}: due, closed and canceled states say what happened; skip is a button`, () => {
      const html = renderFollowUps(locale, [{ ...run, state: 'window_closed', reason: 'window_closed' }], true, now);
      expect(html).toContain('until the customer writes');
      expect(html).toContain('method="post"');
      expect(html).toContain('type="submit"');
      expect(html).not.toMatch(/<span[^>]*dir="auto"[^>]*>\s*<bdi/);
      expect(renderFollowUps(locale, [{ ...run, state: 'canceled', reason: 'customer_answered' }], true, now))
        .toContain('The customer answered');
      expect(buttonsAndDoors(html)).toEqual([]);
    });
    it(`${locale}: the monthly subset says zero honestly and adds no second estimate`, () => {
      const html = renderMonthReport({ ...FIXTURE_MONTH_REPORT, followUpsSent: 0 }, locale, {
        canSetMinutes: true, months: ['2026-10'], flash: null, now, startedAt: now, setupDone: true,
      });
      expect(html).toMatch(/Follow-ups you sent: [\u2068\u2069]*0/);
      expect(html.match(/Follow-ups you sent:/g)).toHaveLength(1);
    });
  }
});

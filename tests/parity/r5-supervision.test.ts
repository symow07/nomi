import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { wrongPrice } from '../../src/pipeline/spotChecks.js';
import { renderOwnerAlert, goesByMail, waitsInApp, SELF_DEMOTION_REASONS, SELF_DEMOTION_PAGE } from '../../src/pipeline/notify.js';
import { renderEmployee, type EmployeeProfile } from '../../src/api/web/employee.js';
import { renderOperationsHome, type OperationsSnapshot } from '../../src/api/web/operations.js';
import { NOTHING_TODAY } from '../../src/api/web/today.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, capabilityName, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { formatList } from '../../src/core/owner/i18n/format.js';
import { esc } from '../../src/api/web/layout.js';
import { assistantName } from '../../src/api/web/say.js';
import { withoutIsolates } from './isolates.js';

/**
 * R5 (0109) — supervision after promotion: spot checks reach work sent alone,
 * a wrong price found by one sends the workspace back to rung 1, every
 * self-demotion is told to the owner (e-mail, Today), and the level page names
 * what the owner chose beside what is in force. Over Postgres:
 * tests/integration/r5-supervision.test.ts.
 */

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

describe('R5 · a wrong price', () => {
  it('priced work called seriously wrong, or corrected with figures it did not hold', () => {
    expect(wrongPrice('quote', 'serious', null, '$12.00 each.')).toBe(true);
    expect(wrongPrice('quote', 'needs_improvement', 'It is $13 a piece, not $12', '$12.00 each.')).toBe(true);
    expect(wrongPrice('negotiate', 'needs_improvement', 'We can do 10% off, not 15%', 'We can do 15% off.')).toBe(true);
  });
  it('never a wording correction, never the same figures, never unpriced work', () => {
    expect(wrongPrice('quote', 'needs_improvement', 'Say it more warmly please', '$12.00 each.')).toBe(false);
    expect(wrongPrice('quote', 'needs_improvement', 'Say: it is 12.00 each', '$12.00 each.')).toBe(false);
    expect(wrongPrice('quote', 'correct', null, '$12.00 each.')).toBe(false);
    expect(wrongPrice('greet', 'serious', null, 'Hello!')).toBe(false);
    expect(wrongPrice('recommend', 'needs_improvement', 'It comes in 3 colours', 'It comes in 2 colours.')).toBe(false);
  });
  it('answered as serious, with its own reason, and the price rung goes even where the capability was in drafts', () => {
    const s = src('src/pipeline/spotChecks.ts');
    expect(s).toContain("const verdict: SpotCheckVerdict = priceWrong ? 'serious' : parsed.verdict;");
    expect(s).toContain("? { action: 'return_to_learning', reasons: ['wrong_price'] } : demotionDecision(evidence);");
    expect(s).toContain('await clearRungFor(tx, businessId, row.capability);');
    expect(s).toContain("array['wrong_price'], ${JSON.stringify(evidence)}::jsonb, 'system_self_demoted')");
  });
});

describe('R5 · spot checks reach work sent alone', () => {
  it('the turn records what it sent alone: the words as queued, the capability, the message it answered', () => {
    expect(src('src/pipeline/turn.ts')).toContain(
      "await tenant.events.append(req.conversationId, 'auto_sent', { capability, messageId: req.messageId, body: outbound.reply });");
  });
  it('only work that actually left is offered, from the last fortnight, and never twice', () => {
    const s = src('src/pipeline/spotChecks.ts');
    expect(s).toContain("and e.type = 'auto_sent'");
    expect(s).toContain("and e.created_at >= now() - interval '14 days'");
    expect(s).toContain("and m.text_content = e.payload->>'body')");
    expect(s).toContain('s.work_ref = ${AUTO_REF} || e.id::text');
  });
  it('offered once a day to every workspace that sent alone this week; the alert sweep every five minutes', () => {
    const main = src('src/main.ts');
    expect(main).toContain("await boss.schedule(QUEUES.spotChecks, '20 5 * * *', {});");
    expect(main).toContain('...await demotionAlerts(db),');
  });
});

describe('R5 · the owner is told', () => {
  for (const l of LOCALES) {
    it(`${l} · the e-mail: which replies wait again, and why`, () => {
      const words = renderOwnerAlert(l, 'self_demoted', null, { demoted: { capabilities: ['negotiate', 'quote'], reasons: ['wrong_price'] } });
      expect(words).toBe(t(l, 'notify.self_demoted', {
        caps: formatList(l, [capabilityName(l, 'negotiate'), capabilityName(l, 'quote')]),
        why: t(l, 'notify.self_demoted.why.wrong_price'),
      }));
      expect(t(l, 'notify.self_demoted.subject')).not.toBe('notify.self_demoted.subject');
      for (const r of SELF_DEMOTION_REASONS) {
        expect(t(l, `notify.self_demoted.why.${r}` as MessageKey), `${l} ${r}`).not.toContain('notify.');
        expect(t(l, `demote.why.${r}` as MessageKey), `${l} ${r}`).not.toContain('demote.');
      }
    });
  }
  it('a reason with no words is never shown as a code', () => {
    expect(renderOwnerAlert('en', 'self_demoted', null, { demoted: { capabilities: ['quote'], reasons: ['', 'something_new'] } }))
      .toContain(t('en', 'notify.self_demoted.why.repeated_corrections'));
  });
  it('phase 8 of the warmth run: it waits in the app — its replies wait under Needs you, and the level is on the assistant\'s page', () => {
    // Deliberately changed from "by e-mail always": the owner (2026-10-03): "Only two things may interrupt the owner outside the app: an order waiting for their tap, and a conversation the assistant handed over because it could not handle it. Everything else waits quietly in-app."
    expect(goesByMail('self_demoted')).toBe(false);
    expect(waitsInApp('self_demoted')).toBe(true);
    expect(SELF_DEMOTION_PAGE).toBe('/app/employee#on-her-own');
  });
  it('the claim marks each demotion told as it returns it; every older one counts as told', () => {
    const m = src('migrations/0109_supervision.sql');
    expect(m).toContain('update capability_events set alerted_at = at where alerted_at is null;');
    expect(m).toContain("update capability_events ce set alerted_at = now()\n     where ce.actor = 'system_self_demoted' and ce.alerted_at is null");
  });
});

describe('R5 · Today and the level page', () => {
  const snapshot = (supervision: OperationsSnapshot['supervision']): OperationsSnapshot => ({
    range: 'today',
    attention: { pendingApprovals: 0, handoffs: 0, ownerHandling: 0, blockedMessages: 0 },
    activity: { handled: 3, draftsCreated: 2, corrections: 0 },
    knowledge: { openGaps: 0, recentCorrections: 0, recentlyTaught: 0 },
    channel: { status: 'connected', provider: 'meta' },
    budget: null, hasAttention: false, ...(supervision ? { supervision } : {}),
  });
  for (const l of LOCALES) {
    it(`${l} · Today: what stepped back, and the work to check — each a door`, () => {
      const html = withoutIsolates(renderOperationsHome(snapshot({ spotChecks: 2, demoted: ['quote'] }), l, NOTHING_TODAY(new Date('2026-10-02T09:00:00Z'))));
      expect(html).toContain('href="/app/employee#on-her-own"');
      expect(html).toContain(esc(t(l, 'today.demoted', { caps: capabilityName(l, 'quote') })));
      expect(html).toContain('href="/app/employee#spot-checks"');
    });
  }
  it('nothing to say, nothing said', () => {
    const html = renderOperationsHome(snapshot({ spotChecks: 0, demoted: [] }), 'en', NOTHING_TODAY(new Date('2026-10-02T09:00:00Z')));
    expect(html).not.toContain('#spot-checks');
    expect(html).not.toContain('href="/app/employee#on-her-own"');
  });

  const base: EmployeeProfile = {
    knows: 3, assistantNamed: true, spotChecks: [], hireDate: new Date('2026-10-01T00:00:00Z'), stage: 'partial',
    canDo: [], needConfirm: [], growth: [], promoted: true, conditions: [],
    capabilities: (['greet', 'qualify', 'recommend', 'quote', 'negotiate', 'follow_up'] as const)
      .map((capability) => ({ capability, mode: 'auto' as const, promotable: false })),
  };
  const ramp = (rung: 0 | 1 | 2) => ({
    gated: true, rung, checklistComplete: true, named: true, talksEarnedAt: new Date('2026-10-05T00:00:00Z'), sellsEarnedAt: null,
    talks: { done: 20, of: 20, need: 17, customers: 5, customersNeed: 5, days: 3, daysNeed: 3, clean: true, ready: true },
    sells: { done: 12, of: 30, customers: 6, customersNeed: 10, days: 5, daysNeed: 7, clean: true, ready: false },
  });
  const chosen = { level: 'sells' as const, at: new Date('2026-10-08T00:00:00Z') };
  const stepped = [{ capability: 'quote', at: new Date('2026-10-12T00:00:00Z'), reasons: ['wrong_price'] }];
  for (const l of LOCALES) {
    it(`${l} · chose "sells", a wrong price took the rung: what is in force, and since when and why`, () => {
      const html = withoutIsolates(renderEmployee({ ...base, earned: true, ramp: ramp(1), chosen, stepped }, l, null));
      expect(html).toContain(esc(t(l, 'autonomy.inForce', { level: t(l, 'autonomy.level.talks') })));
      expect(html).toContain(esc(withoutIsolates(t(l, 'notify.self_demoted.why.wrong_price'))));
      expect(html).toContain(esc(capabilityName(l, 'quote')));
    });
  }
  it('what is in force is what was chosen: the choice alone, nothing else', () => {
    const html = renderEmployee({ ...base, earned: true, ramp: ramp(2), chosen, stepped: [] }, 'en', null);
    expect(html).toContain(esc(t('en', 'autonomy.level.sells')));
    expect(html).not.toContain(esc(t('en', 'autonomy.inForce', { level: t('en', 'autonomy.level.talks') })));
  });
  it('no choice on record (set one by one): the page as before', () => {
    const html = renderEmployee({ ...base, earned: true, chosen: null }, 'en', null);
    expect(html).not.toContain('In force now');
  });
  it('a spot check on work sent alone says so', () => {
    const check = { id: 'c1', capability: 'quote', buyerMessage: 'How much?', reply: '$12.00 each.', conversationId: null, askedAt: new Date(), wasAuto: true };
    const html = withoutIsolates(renderEmployee({ ...base, spotChecks: [check] }, 'en', null));
    expect(html).toContain('id="spot-checks"');
    expect(html).toContain(esc(t('en', 'spotcheck.sentAlone', { name: assistantName('en') })));
  });
});

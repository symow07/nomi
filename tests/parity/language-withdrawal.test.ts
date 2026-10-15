import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderOwnerAlert } from '../../src/pipeline/notify.js';
import { renderEmployee, renderEmployeeScreen, type EmployeeProfile } from '../../src/api/web/employee.js';
import { renderOperationsHome, type OperationsSnapshot } from '../../src/api/web/operations.js';
import { NOTHING_TODAY } from '../../src/api/web/today.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, capabilityName, steppedName, languageDisplay } from '../../src/core/owner/i18n/messages.js';
import { formatList } from '../../src/core/owner/i18n/format.js';
import { esc } from '../../src/api/web/layout.js';
import { withoutIsolates } from './isolates.js';

/**
 * 0163 — a withdrawal is narrowed to the language it happened in (the owner, 2026-10-15). The turn, the lift and the
 * alert's claim run over Postgres in tests/integration/language-withdrawal.test.ts; this holds the words, the pages and
 * the shape of the migration.
 */

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const code = (p: string) => src(p).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*|--)/.test(l)).join('\n');

describe('0163 · the turn and the writer', () => {
  it('the send decision reads the withdrawal for the language (and, G8, the reply\'s own), and names it on the draft', () => {
    const turn = src('src/pipeline/turn.ts');
    expect(turn).toContain('await tenant.autonomy.withdrawnIn(capability, languageHead(language)) ? languageHead(language)');
    expect(turn).toContain('replyDiffers && await tenant.autonomy.withdrawnIn(capability, languageHead(replyIn!)) ? languageHead(replyIn!)');
    expect(turn).toContain("withdrawnLanguage ? { reason: 'language_withdrawn' as const, language: withdrawnLanguage } : null;");
  });
  it('a failed kept reply is withdrawn in the language it was kept in; one nobody could tell, everywhere', () => {
    const turn = src('src/pipeline/turn.ts');
    expect(turn).toContain('const keptIn = replyIn && replyIn !== UNDETERMINED ? replyIn : language !== UNDETERMINED ? language : null;');
    expect(turn).toContain('language: keptIn ? languageHead(keptIn) : null,');
    const repos = src('src/db/repos.ts');
    expect(repos).toContain('? withdrawLanguage(tx, businessId, capability, language, demotionDecision(evidence), evidence)');
    expect(repos).toContain(': autoDemote(tx, businessId, capability, demotionDecision(evidence), evidence);');
  });
  it('the writer leaves the owner\'s policy alone, writes one open row, names the language, and still clears the rung', () => {
    const cap = code('src/pipeline/capability.ts');
    const fn = cap.slice(cap.indexOf('export async function withdrawLanguage('), cap.indexOf('export async function liftWithdrawals('));
    expect(fn).not.toMatch(/update autonomy_policy/);
    expect(fn).toMatch(/on conflict \(business_id, capability, language\) where lifted_at is null do nothing/);
    expect(fn).toMatch(/'system_self_demoted', \$\{language\}\)/);
    expect(fn).toContain('await clearRungFor(tx, businessId, capability);');
  });
  it('the owner lifts it by choosing a level, or granting the capability', () => {
    const cap = code('src/pipeline/capability.ts');
    expect(cap).toContain("Object.entries(want).filter(([c, m]) => m === 'auto' && !NON_PROMOTABLE.includes(c)).map(([c]) => c), actor);");
    expect(cap).toContain("if (toMode === 'auto') await liftWithdrawals(tx, bid.value, [capability], actor);");
  });
  it('the migration: one open row per capability and language under row security; the event and the claim carry it', () => {
    const m = code('migrations/0163_language_withdrawals.sql');
    expect(m).toMatch(/create table if not exists language_withdrawals/);
    expect(m).toMatch(/create unique index if not exists language_withdrawals_open\s+on language_withdrawals \(business_id, capability, language\) where lifted_at is null/);
    expect(m).toMatch(/alter table language_withdrawals enable row level security/);
    expect(m).toMatch(/revoke delete, truncate on language_withdrawals from nomi_app/);
    expect(m).toMatch(/alter table capability_events add column if not exists language text/);
    expect(m).toMatch(/returns table \(business_id uuid, capabilities text\[\], reasons text\[\], narrowed text\[\], everywhere text\[\]\)/);
    expect(m).toMatch(/\('language_withdrawals', 'unrelated'/);
    expect(m).toMatch(/values \(163, 'language_withdrawals'\)/);
  });
});

describe('0163 · the owner is told which language', () => {
  for (const l of LOCALES) {
    it(`${l} · narrowed only: the language with each, and every other language goes on`, () => {
      const words = renderOwnerAlert(l, 'self_demoted', null, {
        demoted: { capabilities: ['qualify'], reasons: ['policy_violation'], narrowed: ['qualify:ar'], everywhere: [] },
      });
      expect(words).toBe(t(l, 'notify.self_demoted.narrowed', {
        caps: t(l, 'notify.self_demoted.inLanguage', { cap: capabilityName(l, 'qualify'), language: languageDisplay(l, 'ar') }),
        why: t(l, 'notify.self_demoted.why.policy_violation'),
      }));
      expect(words).not.toMatch(/\{|notify\./);
    });
    it(`${l} · one everywhere and one narrowed: both named, the ordinary sentence`, () => {
      const words = renderOwnerAlert(l, 'self_demoted', null, {
        demoted: { capabilities: ['qualify', 'quote'], reasons: ['wrong_price'], narrowed: ['qualify:ar'], everywhere: ['quote'] },
      });
      expect(words).toBe(t(l, 'notify.self_demoted', {
        caps: formatList(l, [capabilityName(l, 'quote'), steppedName(l, 'qualify:ar')]),
        why: t(l, 'notify.self_demoted.why.wrong_price'),
      }));
    });
  }
  it('a job queued before 0163 (no lists) reads as it always did', () => {
    expect(renderOwnerAlert('en', 'self_demoted', null, { demoted: { capabilities: ['quote'], reasons: ['wrong_price'] } }))
      .toBe(t('en', 'notify.self_demoted', { caps: capabilityName('en', 'quote'), why: t('en', 'notify.self_demoted.why.wrong_price') }));
  });
  it('the names: "Qualifying, in Arabic" and its code when the runtime has no name', () => {
    expect(steppedName('en', 'qualify:ar')).toBe(`${capabilityName('en', 'qualify')}, in Arabic`);
    expect(steppedName('zh', 'qualify:ar')).toContain('阿拉伯语');
    expect(steppedName('en', 'quote')).toBe(capabilityName('en', 'quote'));
  });
});

describe('0163 · Today and the assistant\'s page show it while it stands', () => {
  const snapshot = (demoted: string[]): OperationsSnapshot => ({
    range: 'today',
    attention: { pendingApprovals: 0, handoffs: 0, ownerHandling: 0, blockedMessages: 0 },
    activity: { handled: 3, draftsCreated: 2, corrections: 0 },
    knowledge: { openGaps: 0, recentCorrections: 0, recentlyTaught: 0 },
    channel: { status: 'connected', provider: 'meta' },
    budget: null, hasAttention: false, supervision: { spotChecks: 0, demoted },
  });
  const base: EmployeeProfile = {
    knows: 3, assistantNamed: true, spotChecks: [], hireDate: new Date('2026-10-01T00:00:00Z'), stage: 'partial',
    canDo: [], needConfirm: [], growth: [], promoted: true, conditions: [], earned: true,
    capabilities: (['greet', 'qualify', 'recommend', 'quote', 'negotiate', 'follow_up'] as const)
      .map((capability) => ({ capability, mode: 'auto' as const, promotable: false })),
  };
  const at = new Date('2026-10-15T00:00:00Z');
  const open = [{ capability: 'qualify', at, reasons: ['policy_violation'], language: 'ar', open: true }];
  for (const l of LOCALES) {
    const row = esc(t(l, 'autonomy.since.inLanguage', {
      cap: capabilityName(l, 'qualify'), language: languageDisplay(l, 'ar'),
      date: '', why: t(l, 'notify.self_demoted.why.policy_violation'),
    })).split(esc(languageDisplay(l, 'ar')))[0]!;
    it(`${l} · Today names the language`, () => {
      const html = withoutIsolates(renderOperationsHome(snapshot(['qualify:ar']), l, NOTHING_TODAY(new Date('2026-10-15T09:00:00Z'))));
      expect(html).toContain(esc(t(l, 'today.demoted', { caps: steppedName(l, 'qualify:ar') })));
    });
    it(`${l} · the levels and the screen below them list it — with no level ever chosen, and with the level still in force`, () => {
      for (const e of [{ ...base, stepped: open }, { ...base, stepped: open, chosen: { level: 'sells' as const, at } }]) {
        expect(withoutIsolates(renderEmployee(e, l, null))).toContain(row);
        expect(withoutIsolates(renderEmployeeScreen('alone', e, l, null))).toContain(row);
      }
    });
    it(`${l} · lifted, it is gone`, () => {
      const e = { ...base, stepped: [], chosen: { level: 'sells' as const, at } };
      expect(withoutIsolates(renderEmployee(e, l, null))).not.toContain(row);
    });
  }
});

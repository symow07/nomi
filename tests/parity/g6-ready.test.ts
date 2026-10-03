import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderPilotReadiness, type PilotReadiness } from '../../src/api/web/pilot.js';
import { renderReady, readyComplete, readyTotal, type ReadyView } from '../../src/api/web/ready.js';
import { checklistFor, type ChecklistItem } from '../../src/db/practiceChecklist.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, assistantName } from '../../src/api/web/say.js';
import { esc } from '../../src/api/web/layout.js';
import { withoutIsolates } from './isolates.js';

/**
 * G6 — "Ready for customers", and Getting ready showing a workspace that
 * signed itself up only what applies to it; the machine room is the
 * installation's. Over Postgres: tests/integration/g6-ready.test.ts.
 */

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const pr = (over: Partial<PilotReadiness> = {}): PilotReadiness => ({
  detected: { profile: true, products: true, priceRules: true, knowledge: true, claims: true, sandbox: false, channel: false },
  attest: { backupTestedAt: null, secretsRotatedAt: null, ownerReadyAt: null, assistantNamedAt: null },
  assistantName: 'Lily', validation: { at: null, pass: null, total: null }, backupVerifiedAt: null, readyToLaunch: false,
  ...over,
});
const items = checklistFor('retail');
const view = (seen: readonly ChecklistItem[], over: Partial<ReadyView> = {}): ReadyView => ({
  items, seen: new Set(seen), named: true, connected: false, earned: false, ...over,
});

describe('G6 · Getting ready, for a workspace that signed itself up', () => {
  for (const l of LOCALES) {
    it(`${l} · "Ready for customers" stands where the installation's facts and the fixed-scenario check stood`, () => {
      const html = withoutIsolates(renderPilotReadiness(pr({ selfServe: true, ready: { done: 3, total: 8, complete: false } }), l, null));
      expect(html).toContain(esc(t(l, 'pilot.item.ready')));
      expect(html).toContain(esc(withoutIsolates(t(l, 'pilot.ready.count', { done: 3, total: 8 }))));
      expect(html).toContain('href="/app/ready"');
      for (const k of ['pilot.nomiChecks', 'pilot.item.sandbox'] as const) {
        expect(html, k).not.toContain(esc(t(l, k)));
      }
      expect(html).not.toContain('action="/app/onboarding/validate"');
    });
  }
  it('a workspace the operator made keeps every row it had', () => {
    const html = renderPilotReadiness(pr(), 'en', null);
    for (const k of ['pilot.nomiChecks', 'pilot.item.sandbox'] as const) expect(html).toContain(esc(t('en', k)));
    // Phase 9 — the installation's chores are Nomi's: one row, no button for the owner.
    expect(html).not.toMatch(/value="(backup_tested|secrets_rotated)"/);
    // The page is everyone's to read; the row that counts it is a self-serve workspace's.
    expect(html).toContain('href="/app/ready"');
    expect(html).not.toContain(esc(t('en', 'pilot.ready.count', { done: 0, total: 8 })));
  });
  it('readiness: the checklist instead of backup, secrets and the old check — only for a self-serve workspace', () => {
    const p = src('src/api/web/pilot.ts');
    expect(p).toContain(': detected.sandbox && (!!attest.backupTestedAt || !!backupVerifiedAt) && !!attest.secretsRotatedAt)');
    expect(p).toContain('? ready.complete');
  });
});

describe('G6 · the Ready for customers page', () => {
  for (const l of LOCALES) {
    it(`${l} · the checklist with its count, the three facts, a door to Practice`, () => {
      const name = assistantName(l);
      const html = withoutIsolates(renderReady(view(['quoted', 'bot_answered']), l));
      expect(html).toContain(esc(t(l, 'ready.title')));
      expect(html).toContain(`2/${readyTotal(view([]))}`);
      for (const i of items) expect(html).toContain(esc(withoutIsolates(t(l, `practice.check.${i}` as never, { name }))));
      expect(html).toContain(esc(withoutIsolates(t(l, 'ready.name.done', { name }))));
      expect(html).toContain(esc(t(l, 'ready.channel.todo')));
      expect(html).toContain(esc(t(l, 'ready.alone.not')));
      expect(html).toContain('href="/app/sandbox"');
      // Phase 7 — the channels step opens their one home, My business's screen.
      expect(html).toContain('href="/app/business/channels"');
      expect(html).not.toContain(esc(t(l, 'ready.done')));
    });
  }
  it('complete when every item is seen; it says so', () => {
    expect(readyComplete(view(items))).toBe(true);
    expect(readyComplete(view(items.slice(1)))).toBe(false);
    expect(renderReady(view(items), 'en')).toContain(esc(t('en', 'ready.done')));
  });
});

describe('G6 · the machine room is the installation\'s', () => {
  it('only the installation\'s own workspace reaches it, and no owner\'s page links to it (phase 9)', () => {
    const app = src('src/api/web/app.ts');
    const at = app.indexOf("app.get('/app/onboarding/technical', {");
    expect(at).toBeGreaterThan(-1);
    expect(app.slice(at, at + 300)).toContain('if (s && s.businessId !== deps.businessId) return reply.callNotFound();');
    expect(app).toContain('renderPilotRunbook(data, locale, flash, feedback, personOf(s))');
    expect(src('src/api/web/pilot.ts')).not.toContain("deeper('/app/onboarding/technical'");
  });
});

describe('Phase 9 · "may send alone" is ticked only when it is true (V1-145)', () => {
  it('earned but the name unconfirmed: not ticked, and it says the name is what is left', () => {
    for (const l of LOCALES) {
      const html = withoutIsolates(renderReady(view([], { earned: true, named: false }), l));
      const facts = html.slice(html.indexOf('id="ready-facts"'));
      expect(facts, l).toContain(esc(t(l, 'ready.alone.needsName')));
      expect(facts, l).not.toContain('class="chk ok"');   // nothing in the facts is ticked: name, channel, sending alone
    }
    const both = renderReady(view([], { earned: true, named: true }), 'en');
    // Phase 9 (V1-147) — the row is named for what must be in place, its state in words beside it.
    expect(both).toMatch(new RegExp(`<li class="chk ok"><span class="mk" aria-hidden="true">✓</span><span class="lbl">${t('en', 'ready.alone.label')}</span>\\s*<span class="rd-state">[^<]*send alone`));
  });
});

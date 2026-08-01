import { describe, it, expect } from 'vitest';
import {
  renderPilotReadiness, renderPilotRunbook, type PilotReadiness, type PilotRunbook,
} from '../../src/api/web/pilot.js';
import { type OperationsSnapshot } from '../../src/api/web/operations.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';

const NOW = new Date('2026-08-01T10:00:00Z');

const pr = (over: Partial<PilotReadiness> = {}): PilotReadiness => ({
  detected: { profile: true, products: true, knowledge: true, claims: false, sandbox: false, channel: false },
  attest: { backupTestedAt: null, secretsRotatedAt: null, ownerReadyAt: null },
  validation: { at: null, pass: null, total: null },
  readyToLaunch: false,
  ...over,
});

describe('M15.1 · pilot readiness hub (localized renderer)', () => {
  it('detected items: ✓ badged "Verified by system"; ○ shows a blocker + deep link, in en/zh/ar', () => {
    for (const l of LOCALES) {
      const html = renderPilotReadiness(pr(), l, null);
      expect(html).toContain(t(l, 'pilot.title'));
      expect(html).toContain(t(l, 'pilot.verifiedBySystem'));   // profile/products/knowledge are ✓
      expect(html).toContain(t(l, 'pilot.item.profile'));
      // claims is ○ → blocker + the surface link + "we have none" attest
      expect(html).toContain(t(l, 'pilot.blocker.claims'));
      expect(html).toContain('href="/app/knowledge"');
      expect(html).toContain('value="claims_reviewed"');
    }
  });

  it('owner attestations: ○ offers Confirm; ✓ shows "Confirmed by you"', () => {
    const none = renderPilotReadiness(pr(), 'en', null);
    expect(none).toContain(t('en', 'pilot.attest.backup_tested'));
    expect(none).toContain('action="/app/onboarding/attest"');
    expect(none).toContain('value="backup_tested"');
    expect(none).toContain(t('en', 'pilot.attest.confirm'));

    const done = renderPilotReadiness(pr({ attest: { backupTestedAt: NOW, secretsRotatedAt: NOW, ownerReadyAt: NOW } }), 'en', null);
    expect(done).toContain(t('en', 'pilot.confirmedByOwner'));   // "Confirmed by you"
    expect(done).not.toContain('value="backup_tested"');          // no confirm button once done
  });

  it('sandbox validation: run button + result, and it drives the Sandbox ✓', () => {
    const never = renderPilotReadiness(pr(), 'en', null);
    expect(never).toContain('action="/app/onboarding/validate"');
    expect(never).toContain(t('en', 'pilot.validate.never'));

    const ran = renderPilotReadiness(pr({ detected: { profile: true, products: true, knowledge: true, claims: true, sandbox: true, channel: false }, validation: { at: NOW, pass: 23, total: 23 } }), 'en', null);
    expect(ran).toContain('23/23');
    expect(ran).toContain(t('en', 'pilot.verifiedBySystem'));   // sandbox now ✓
  });

  it('verdict: ready vs not-ready; channel stays honest; never a percentage', () => {
    const notReady = renderPilotReadiness(pr(), 'en', null);
    expect(notReady).toContain(t('en', 'pilot.notReady'));
    expect(notReady).toContain(t('en', 'pilot.blocker.channel'));   // honest "coming with WhatsApp"

    const ready = renderPilotReadiness(pr({
      detected: { profile: true, products: true, knowledge: true, claims: true, sandbox: true, channel: false },
      attest: { backupTestedAt: NOW, secretsRotatedAt: NOW, ownerReadyAt: NOW },
      readyToLaunch: true,
    }), 'en', null);
    expect(ready).toContain(t('en', 'pilot.allReady'));

    for (const l of LOCALES) expect(renderPilotReadiness(pr(), l, null)).not.toMatch(/\d+\s*%/);
  });
});

// ── M16.2d — the full operations runbook (before / during / practice / after) ─
const snap = (over: Partial<OperationsSnapshot> = {}): OperationsSnapshot => ({
  range: 'week',
  attention: { pendingApprovals: 2, handoffs: 1, ownerHandling: 0 },
  activity: { handled: 4, draftsCreated: 3, corrections: 1 },
  knowledge: { openGaps: 2, recentCorrections: 1, recentlyTaught: 3 },
  channel: { status: 'not_connected', provider: 'disabled' },
  hasAttention: true,
  ...over,
});
const rb = (over: Partial<PilotRunbook> = {}): PilotRunbook => ({
  readiness: pr(),
  operations: snap(),
  rehearsal: {
    available: true,
    done: { takeover: true, ownerReply: false, resume: false, knowledgeCorrection: true, validationPassed: false },
    completed: 2, total: 5,
  },
  ...over,
});

describe('M16.2d · pilot operations runbook (localized renderer)', () => {
  it('renders all four phases (before / during / practice / after) in en/zh/ar', () => {
    for (const l of LOCALES) {
      const html = renderPilotRunbook(rb(), l, null);
      expect(html).toContain(t(l, 'pilot.title'));            // before launch (M15, reused)
      expect(html).toContain(t(l, 'runbook.during.title'));
      expect(html).toContain(t(l, 'runbook.practice.title'));
      expect(html).toContain(t(l, 'runbook.after.title'));
    }
  });

  it('during pilot: real counts + deep links into the owning surfaces', () => {
    const html = renderPilotRunbook(rb(), 'en', null);
    for (const href of ['/app/inbox', '/app/inbox?filter=pending', '/app/knowledge', '/app/analytics']) {
      expect(html).toContain(`href="${href}"`);
    }
    for (const n of ['>2<', '>1<', '>3<', '>4<']) expect(html).toContain(n);
  });

  it('during pilot: honest quiet state when the factory has no activity', () => {
    const quiet = snap({
      attention: { pendingApprovals: 0, handoffs: 0, ownerHandling: 0 },
      activity: { handled: 0, draftsCreated: 0, corrections: 0 },
      knowledge: { openGaps: 0, recentCorrections: 0, recentlyTaught: 0 },
      hasAttention: false,
    });
    const html = renderPilotRunbook(rb({ operations: quiet }), 'en', null);
    expect(html).toContain(t('en', 'runbook.during.quiet'));
    expect(html).not.toContain(t('en', 'ops.card.waiting'));   // no count rows in the quiet state
  });

  it('rehearsal progress: ✓ for practiced, ○ for not, with an n/total header and sandbox link', () => {
    const html = renderPilotRunbook(rb(), 'en', null);
    expect(html).toContain('Take-over practiced');   // done → ✓
    expect(html).toContain('✓'); expect(html).toContain('○');
    expect(html).toContain('2/5');                    // a fraction, not a percentage
    expect(html).toContain('href="/app/sandbox"');
  });

  it('after pilot: read-only review links, no new POST actions', () => {
    const html = renderPilotRunbook(rb(), 'en', null);
    expect(html).toContain(t('en', 'runbook.after.promotion'));
    expect(html).toContain(t('en', 'runbook.after.gaps'));
    expect(html).toContain('href="/app/employee"');
    // the after section adds only anchors — no <form> of its own
    const afterIdx = html.indexOf(t('en', 'runbook.after.title'));
    expect(html.slice(afterIdx)).not.toContain('<form');
  });

  it('no percentages anywhere', () => {
    for (const l of LOCALES) expect(renderPilotRunbook(rb(), l, null)).not.toMatch(/\d+\s*%/);
  });

  it('no score / grade / technical vocabulary — any locale', () => {
    for (const l of LOCALES) {
      const html = renderPilotRunbook(rb(), l, null).toLowerCase();
      for (const banned of ['confidence', 'score', 'grade', 'percentage', 'ranking', 'rating', 'model', 'webhook']) {
        expect(html.includes(banned), `${l}:${banned}`).toBe(false);
      }
      expect(new RegExp('\\bai\\b').test(html), `${l}:ai`).toBe(false);
    }
  });
});

import { describe, it, expect } from 'vitest';
import { renderPilotReadiness, type PilotReadiness } from '../../src/api/web/pilot.js';
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

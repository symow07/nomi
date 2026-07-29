import { describe, it, expect } from 'vitest';
import { renderOnboarding, type OnboardingData, type OnboardingStep } from '../../src/api/web/onboarding.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

const mk = (done: Partial<Record<OnboardingStep, boolean>>, next: OnboardingStep | null): OnboardingData => {
  const steps = (['profile', 'products', 'channels', 'first_success'] as OnboardingStep[])
    .map((step) => ({ step, done: done[step] ?? false }));
  return { steps, allDone: steps.every((s) => s.done), nextStep: next };
};

const allIncomplete = mk({}, 'profile');
const partial = mk({ profile: true, products: true }, 'channels');
const complete = mk({ profile: true, products: true, channels: true, first_success: true }, null);

describe('M11.2 · guided onboarding (localized renderer)', () => {
  it('en: title, four steps, deep links only (no re-implemented flows)', () => {
    const html = renderOnboarding(allIncomplete, 'en');
    expect(html).toContain('Get set up');
    expect(html).toContain('Fill in your business profile');
    expect(html).toContain('Teach her your products');
    expect(html).toContain('Connect WhatsApp');
    expect(html).toContain('Complete your first conversation');
    // deep links to the EXISTING pages
    expect(html).toContain('href="/app/settings"');
    expect(html).toContain('href="/app/products"');
    expect(html).toContain('href="/app/channels"');
    expect(html).toContain('href="/app/inbox"');
    expect(html).not.toContain('<form');            // no forms — links only
  });

  it('honest ✓/○ checklist, never a percentage', () => {
    const html = renderOnboarding(partial, 'en');
    expect(html).toContain('✓'); expect(html).toContain('○');
    expect(html).not.toContain('%');
    // a done step shows no action button; an incomplete one does
    expect(html).not.toMatch(/business profile[\s\S]*?Open Settings/);   // profile done → no CTA
    expect(html).toContain('Open Channels');                            // channels pending → CTA
  });

  it('next step is marked "Start here"', () => {
    expect(renderOnboarding(partial, 'en')).toMatch(/Connect WhatsApp[\s\S]*?Start here/);
    expect(renderOnboarding(partial, 'zh')).toContain('从这里开始');
  });

  it('all done → honest "all set" state, no pending markers', () => {
    const en = renderOnboarding(complete, 'en');
    expect(en).toContain('All set'); expect(en).toContain('Lily');
    expect(en).not.toContain('○');
    expect(en).not.toContain('Open Settings');       // nothing left to do
  });

  it('zh + ar localized; Step 4 is 完成第一次沟通; RTL handled by shell', () => {
    expect(renderOnboarding(allIncomplete, 'zh')).toContain('完成第一次沟通');
    expect(renderOnboarding(allIncomplete, 'zh')).toContain('开始设置');
    const ar = renderOnboarding(allIncomplete, 'ar');
    expect(ar).toContain('اربط واتساب'); expect(ar).toContain('لنُجهّز حسابك');
  });

  it('no tables / no technical vocabulary in any locale', () => {
    for (const l of LOCALES) {
      const html = (renderOnboarding(allIncomplete, l) + renderOnboarding(complete, l)).toLowerCase();
      expect(html).not.toContain('<table');
      for (const w of ['ai', 'llm', 'model', 'api', 'webhook', 'database', 'draft', 'onboarding_state']) {
        expect(new RegExp(`\\b${w}\\b`).test(html), `${l}:${w}`).toBe(false);
      }
    }
  });
});

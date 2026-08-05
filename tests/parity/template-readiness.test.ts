import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { templateReadiness, TEMPLATE_ENTRY_POINT } from '../../src/core/channel/templateReadiness.js';
import { sendPlan, windowState } from '../../src/core/channel/window.js';
import { gateOutbound } from '../../src/core/channel/sendGate.js';
import { REFUSAL_REASONS } from '../../src/api/web/refusals.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';

/**
 * M22 §B — template readiness. Nothing here implements template sending, calls
 * Meta, or pretends an approval exists. What is on trial is that the product
 * tells the truth about a capability it does not yet have.
 */

const NOW = new Date('2026-08-05T10:00:00Z');
const THREE_DAYS_AGO = new Date('2026-08-02T10:00:00Z');

describe('M22 · templates: the product is honest about what it cannot do', () => {
  it('without an approved template, a closed window cannot be re-opened', () => {
    const r = templateReadiness('none');
    expect(r.canReopenWindow).toBe(false);
    expect(r.awaitingExternalApproval).toBe(true);
  });

  it('a rejected template is not treated as a maybe', () => {
    expect(templateReadiness('rejected').canReopenWindow).toBe(false);
  });

  it('only an actual approval unlocks it', () => {
    expect(templateReadiness('approved'))
      .toEqual({ state: 'approved', canReopenWindow: true, awaitingExternalApproval: false });
  });
});

describe('M22 · the entry point is one line, and it is named', () => {
  it('the file and field it names really exist, with that value', async () => {
    // Documentation that can go stale silently is worse than none. If the entry
    // point moves, this fails instead of the comment quietly lying.
    const src = await readFile(new URL(`../../${TEMPLATE_ENTRY_POINT.file}`, import.meta.url), 'utf8');
    expect(src).toContain(`${TEMPLATE_ENTRY_POINT.field}: '${TEMPLATE_ENTRY_POINT.currentValue}'`);
    expect(src).toContain('TEMPLATE_ENTRY_POINT');   // the line points back here
  });

  it('while it reads none, a closed window refuses as window_closed — not via template', () => {
    // The whole chain, in the state production is actually in.
    const plan = sendPlan(windowState(THREE_DAYS_AGO, NOW), 'reply', TEMPLATE_ENTRY_POINT.currentValue);
    expect(plan.action).toBe('wait_for_buyer');
    const gate = gateOutbound({
      origin: 'employee', assignedTo: null, paused: false, activated: true,
      pilotMode: false, windowPlan: plan,
    });
    expect(gate).toEqual({ allow: false, reason: 'window_closed' });
  });

  it('with an approval, the SAME chain routes to the template branch — gate unchanged', () => {
    const plan = sendPlan(windowState(THREE_DAYS_AGO, NOW), 'reply', 'approved');
    expect(plan.action).toBe('send_template');
    const gate = gateOutbound({
      origin: 'employee', assignedTo: null, paused: false, activated: true,
      pilotMode: false, windowPlan: plan,
    });
    // Allowed, but only through a template — which the worker then refuses as
    // window_needs_owner until one is actually approved.
    expect(gate).toEqual({ allow: true, viaTemplate: true });
  });
});

describe('M22 · the owner is told when a template is what is missing', () => {
  it('window_needs_owner explains the approval, not a fault of hers', () => {
    for (const locale of LOCALES) {
      const why = t(locale, 'refused.why.window_needs_owner' as MessageKey, { name: 'Lily' });
      const todo = t(locale, 'refused.do.window_needs_owner' as MessageKey, { name: 'Lily' });
      expect(why.length).toBeGreaterThan(10);
      expect(todo.length).toBeGreaterThan(10);
    }
    // English, where the wording can be asserted precisely.
    expect(t('en', 'refused.why.window_needs_owner' as MessageKey, { name: 'Lily' }))
      .toContain('approved in advance');
    expect(t('en', 'refused.do.window_needs_owner' as MessageKey, { name: 'Lily' }))
      .toContain('your own phone');
  });

  it('both window refusals are explainable, though only one can fire today', () => {
    expect(REFUSAL_REASONS).toContain('window_closed');        // reachable now
    expect(REFUSAL_REASONS).toContain('window_needs_owner');   // reachable once approved
  });

  it('the owner is never shown Meta’s vocabulary', () => {
    for (const locale of LOCALES)
      for (const part of ['what', 'why', 'do'] as const) {
        const s = t(locale, `refused.${part}.window_needs_owner` as MessageKey, { name: 'Lily' });
        for (const jargon of ['template', 'HSM', 'session message', '24-hour window', 'Cloud API'])
          expect(s.toLowerCase(), `${locale}/${part}: ${jargon}`).not.toContain(jargon.toLowerCase());
      }
  });
});

describe('M22 · credentials and approval are never conflated', () => {
  it('the readiness check knows nothing about credentials', async () => {
    const src = await readFile(new URL('../../src/core/channel/templateReadiness.ts', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const forbidden of ['ACCESS_TOKEN', 'APP_SECRET', 'PHONE_NUMBER_ID', 'checkMetaReadiness', 'process.env'])
      expect(code.includes(forbidden), `templateReadiness reaches ${forbidden}`).toBe(false);
  });

  it('and it reaches no network', async () => {
    const src = await readFile(new URL('../../src/core/channel/templateReadiness.ts', import.meta.url), 'utf8');
    for (const forbidden of ['fetch(', 'graph.facebook', 'https://'])
      expect(src.includes(forbidden), `templateReadiness reaches ${forbidden}`).toBe(false);
  });
});

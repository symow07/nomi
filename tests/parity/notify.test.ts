import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { alertKindFor, renderOwnerAlert, validateOwnerPhone, type AlertKind } from '../../src/pipeline/notify.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { ASSISTANT_FALLBACK, type MessageKey } from '../../src/core/owner/i18n/messages.js';

describe('P3 · owner alerts (pure)', () => {
  it('alertKindFor maps events to neutral codes (no strings)', () => {
    expect(alertKindFor({ handoffAlert: true, hotLeadAlert: false })).toBe('handoff');
    expect(alertKindFor({ handoffAlert: false, hotLeadAlert: true })).toBe('hot_lead');
    expect(alertKindFor({ handoffAlert: true, hotLeadAlert: true })).toBe('handoff'); // handoff wins
    expect(alertKindFor({ handoffAlert: false, hotLeadAlert: false })).toBeNull();
  });

  it('renders each alert kind in en/zh/ar with the assistant\'s name, else "your assistant"', () => {
    expect(renderOwnerAlert('en', 'hot_lead').toLowerCase()).toContain(ASSISTANT_FALLBACK.en);
    // The positioning rewrite: a strong buying signal, and no promise of a nightly summary nothing builds.
    expect(renderOwnerAlert('en', 'hot_lead')).toContain('looks ready to buy');
    expect(renderOwnerAlert('zh', 'hot_lead')).toContain(ASSISTANT_FALLBACK.zh);
    expect(renderOwnerAlert('zh', 'hot_lead')).toContain('准备下单');
    expect(renderOwnerAlert('ar', 'hot_lead')).toContain(ASSISTANT_FALLBACK.ar);

    expect(renderOwnerAlert('en', 'handoff').toLowerCase()).toContain(ASSISTANT_FALLBACK.en);
    expect(renderOwnerAlert('zh', 'handoff')).toContain('等你接手');
    expect(renderOwnerAlert('ar', 'handoff')).toContain(ASSISTANT_FALLBACK.ar);

    // A name the owner chose is used as-is, in every language.
    for (const l of LOCALES) for (const k of ['hot_lead', 'handoff'] as const) {
      const named = renderOwnerAlert(l, k, 'Lily');
      expect(named, `${l}:${k}`).toContain('Lily');
      expect(named.toLowerCase(), `${l}:${k}`).not.toContain(ASSISTANT_FALLBACK[l]);
    }

    expect(renderOwnerAlert('en', 'dead_letter')).toContain('may not have gone through');
    expect(renderOwnerAlert('zh', 'dead_letter')).toContain('可能没送达');
    expect(renderOwnerAlert('ar', 'dead_letter')).toContain('يرجى المراجعة');
  });

  it('delivery_failed reuses the dead_letter copy (no dormant string)', () => {
    for (const l of LOCALES) {
      expect(renderOwnerAlert(l, 'delivery_failed')).toBe(renderOwnerAlert(l, 'dead_letter'));
    }
  });

  it('validateOwnerPhone: accepts E.164, normalizes spacing, clears on empty, rejects junk', () => {
    expect(validateOwnerPhone('+8613800000000')).toEqual({ ok: true, value: '+8613800000000' });
    expect(validateOwnerPhone(' +86 138 0000 0000 ')).toEqual({ ok: true, value: '+8613800000000' });
    expect(validateOwnerPhone('')).toEqual({ ok: true, value: null });       // clear
    expect(validateOwnerPhone('   ')).toEqual({ ok: true, value: null });
    expect(validateOwnerPhone('13800000000')).toEqual({ ok: false });        // no +
    expect(validateOwnerPhone('not-a-number')).toEqual({ ok: false });
    expect(validateOwnerPhone('+12')).toEqual({ ok: false });                // too short
    expect(validateOwnerPhone('+1234567890123456')).toEqual({ ok: false });  // too long
  });

  it('no technical vocabulary in any alert / locale', () => {
    for (const l of LOCALES) {
      for (const k of ['hot_lead', 'handoff', 'dead_letter'] as AlertKind[]) {
        const s = renderOwnerAlert(l, k).toLowerCase();
        for (const w of ['ai', 'llm', 'model', 'api', 'queue', 'webhook', 'retry', 'token']) {
          expect(new RegExp(`\\b${w}\\b`).test(s), `${l}/${k}:${w}`).toBe(false);
        }
        for (const zh of ['模型', '人工智能', '队列']) expect(s.includes(zh), `${l}/${k}:${zh}`).toBe(false);
      }
    }
  });
});

/*
 * G5 sent a waiting reply, a hand-off and a hot lead to the owner by e-mail
 * (and WhatsApp). Phase 8 of the warmth run changed that ON PURPOSE — the
 * owner, 2026-10-03: "Only two things may interrupt the owner outside the app:
 * an order waiting for their tap, and a conversation the assistant handed over
 * because it could not handle it. Everything else waits quietly in-app." The
 * events keep their codes and their words; only the two interruptions leave.
 */
describe('G5 → phase 8 · a waiting reply and a hot lead keep their codes, and wait in the app', () => {
  it('a waiting reply has its own code, the least of them — and nothing about it leaves Nomi', async () => {
    const { alertKindFor, interrupts, waitsInApp } = await import('../../src/pipeline/notify.js');
    expect(alertKindFor({ handoffAlert: false, hotLeadAlert: false, draftCreated: { draftId: 'd' } })).toBe('draft_waiting');
    expect(alertKindFor({ handoffAlert: true, hotLeadAlert: false, draftCreated: { draftId: 'd' } })).toBe('handoff');
    expect(alertKindFor({ handoffAlert: false, hotLeadAlert: true, draftCreated: { draftId: 'd' } })).toBe('hot_lead');
    expect(alertKindFor({ handoffAlert: false, hotLeadAlert: false, draftCreated: null })).toBeNull();
    for (const k of ['draft_waiting', 'hot_lead'] as const) {
      expect(waitsInApp(k), k).toBe(true);
      expect(interrupts(k), k).toBe(false);
    }
    expect(interrupts('handoff')).toBe(true);
  });
  it('each interruption has its words and an e-mail subject in every language; a hand-off names the assistant', async () => {
    const { INTERRUPTION_KINDS } = await import('../../src/pipeline/notify.js');
    const { t } = await import('../../src/core/owner/i18n/messages.js');
    expect([...INTERRUPTION_KINDS].sort()).toEqual(['deletion_requested', 'handoff', 'order_proposed']);
    for (const l of LOCALES) for (const k of INTERRUPTION_KINDS) {
      expect(t(l, `notify.${k}.subject` as MessageKey), `${l}:${k}`).not.toMatch(/^notify\./);
      expect(renderOwnerAlert(l, k, 'Lily'), `${l}:${k}`).not.toMatch(/^notify\./);
    }
    for (const l of LOCALES) expect(renderOwnerAlert(l, 'handoff', 'Lily'), l).toContain('Lily');
    // The words a quiet kind had are kept, unchanged, for the day it is asked for again.
    expect(renderOwnerAlert('en', 'draft_waiting', 'Lily')).toBe('Lily wrote a reply for a customer. It waits for you to send it, change it or leave it.');
  });
  it('the link opens the conversation where the web app does', async () => {
    const { alertLink } = await import('../../src/pipeline/notify.js');
    const { conversationUrl } = await import('../../src/api/web/layout.js');
    const id = '0b1e5c2a-6f1d-4c8e-9a3b-2d4f6a8b0c1d';
    expect(alertLink('https://app.nomidoes.com/', id)).toBe(`https://app.nomidoes.com${conversationUrl(id)}`);
  });
  it('the worker queues only the two interruptions: no job for a waiting reply, and none for a job that gave up', () => {
    const src = readFileSync(new URL('../../src/worker/main.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/if \(alertKind && interrupts\(alertKind\)\) \{/);
    expect(src).toMatch(/if \(!kind \|\| !interrupts\(kind\)\) return;/);
    expect(src).not.toContain('draft_waiting');
    expect(src).not.toContain("kind: 'dead_letter'");
  });
});

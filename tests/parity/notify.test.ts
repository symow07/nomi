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

describe('G5 · a waiting reply, a hand-off and a hot lead, by e-mail too', () => {
  it('a waiting reply has its own alert, the least of them', async () => {
    const { alertKindFor } = await import('../../src/pipeline/notify.js');
    expect(alertKindFor({ handoffAlert: false, hotLeadAlert: false, draftCreated: { draftId: 'd' } })).toBe('draft_waiting');
    expect(alertKindFor({ handoffAlert: true, hotLeadAlert: false, draftCreated: { draftId: 'd' } })).toBe('handoff');
    expect(alertKindFor({ handoffAlert: false, hotLeadAlert: true, draftCreated: { draftId: 'd' } })).toBe('hot_lead');
    expect(alertKindFor({ handoffAlert: false, hotLeadAlert: false, draftCreated: null })).toBeNull();
  });
  it('each has its words and an e-mail subject in every language, naming the assistant', async () => {
    const { CUSTOMER_ALERT_KINDS, mailsToo } = await import('../../src/pipeline/notify.js');
    const { t } = await import('../../src/core/owner/i18n/messages.js');
    for (const l of LOCALES) for (const k of CUSTOMER_ALERT_KINDS) {
      expect(mailsToo(k)).toBe(true);
      expect(t(l, `notify.${k}.subject` as MessageKey), `${l}:${k}`).not.toMatch(/^notify\./);
      expect(renderOwnerAlert(l, k, 'Lily'), `${l}:${k}`).toContain('Lily');
    }
    expect(renderOwnerAlert('en', 'draft_waiting', 'Lily')).toBe('Lily wrote a reply for a customer. It waits for you to send it, change it or leave it.');
  });
  it('the link opens the conversation where the web app does', async () => {
    const { alertLink } = await import('../../src/pipeline/notify.js');
    const { conversationUrl } = await import('../../src/api/web/layout.js');
    const id = '0b1e5c2a-6f1d-4c8e-9a3b-2d4f6a8b0c1d';
    expect(alertLink('https://app.nomidoes.com/', id)).toBe(`https://app.nomidoes.com${conversationUrl(id)}`);
  });
  it('the worker tells a waiting reply once an hour per conversation', () => {
    const src = readFileSync(new URL('../../src/worker/main.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/alertKind === 'draft_waiting' \? \{ singletonSeconds: DRAFT_ALERT_EVERY_SECONDS \}/);
  });
});

import { describe, it, expect } from 'vitest';
import { alertKindFor, renderOwnerAlert, validateOwnerPhone, type AlertKind } from '../../src/pipeline/notify.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { ASSISTANT_FALLBACK } from '../../src/core/owner/i18n/messages.js';

describe('P3 · owner alerts (pure)', () => {
  it('alertKindFor maps events to neutral codes (no strings)', () => {
    expect(alertKindFor({ handoffAlert: true, hotLeadAlert: false })).toBe('handoff');
    expect(alertKindFor({ handoffAlert: false, hotLeadAlert: true })).toBe('hot_lead');
    expect(alertKindFor({ handoffAlert: true, hotLeadAlert: true })).toBe('handoff'); // handoff wins
    expect(alertKindFor({ handoffAlert: false, hotLeadAlert: false })).toBeNull();
  });

  it('renders each alert kind in en/zh/ar with the assistant\'s name, else "your assistant"', () => {
    expect(renderOwnerAlert('en', 'hot_lead').toLowerCase()).toContain(ASSISTANT_FALLBACK.en);
    expect(renderOwnerAlert('en', 'hot_lead')).toContain('Big-buyer');
    expect(renderOwnerAlert('zh', 'hot_lead')).toContain(ASSISTANT_FALLBACK.zh);
    expect(renderOwnerAlert('zh', 'hot_lead')).toContain('大买家');
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

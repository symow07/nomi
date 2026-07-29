import { describe, it, expect } from 'vitest';
import { alertKindFor, renderOwnerAlert, type AlertKind } from '../../src/pipeline/notify.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

describe('P3 · owner alerts (pure)', () => {
  it('alertKindFor maps events to neutral codes (no strings)', () => {
    expect(alertKindFor({ handoffAlert: true, hotLeadAlert: false })).toBe('handoff');
    expect(alertKindFor({ handoffAlert: false, hotLeadAlert: true })).toBe('hot_lead');
    expect(alertKindFor({ handoffAlert: true, hotLeadAlert: true })).toBe('handoff'); // handoff wins
    expect(alertKindFor({ handoffAlert: false, hotLeadAlert: false })).toBeNull();
  });

  it('renders each alert kind in en/zh/ar with the localized employee name', () => {
    expect(renderOwnerAlert('en', 'hot_lead')).toContain('Lily');
    expect(renderOwnerAlert('en', 'hot_lead')).toContain('Big-buyer');
    expect(renderOwnerAlert('zh', 'hot_lead')).toContain('小雅');
    expect(renderOwnerAlert('zh', 'hot_lead')).toContain('大买家');
    expect(renderOwnerAlert('ar', 'hot_lead')).toContain('ياسمين');

    expect(renderOwnerAlert('en', 'handoff')).toContain('Lily');
    expect(renderOwnerAlert('zh', 'handoff')).toContain('等你接手');
    expect(renderOwnerAlert('ar', 'handoff')).toContain('ياسمين');

    expect(renderOwnerAlert('en', 'dead_letter')).toContain('may not have gone through');
    expect(renderOwnerAlert('zh', 'dead_letter')).toContain('可能没送达');
    expect(renderOwnerAlert('ar', 'dead_letter')).toContain('يرجى المراجعة');
  });

  it('delivery_failed reuses the dead_letter copy (no dormant string)', () => {
    for (const l of LOCALES) {
      expect(renderOwnerAlert(l, 'delivery_failed')).toBe(renderOwnerAlert(l, 'dead_letter'));
    }
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

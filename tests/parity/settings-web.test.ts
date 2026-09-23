import { describe, it, expect } from 'vitest';
import {
  validateProfile, renderSettings, type ProfileInput, type BusinessProfile,
} from '../../src/api/web/settings.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';

const baseInput: ProfileInput = {
  name: 'Acme', description: '', location: '', workingHours: '',
  contactEmail: '', contactPhone: '', languagesServed: ['en', 'zh'],
};

const full: BusinessProfile = {
  name: 'Yiwu Sunshine Trading', description: 'Household goods exporter', location: 'Yiwu, Zhejiang',
  workingHours: '9:00-18:00 Mon-Sat', contactEmail: 'sales@example.com', contactPhone: '+8613800000000',
  languagesServed: ['en', 'zh'], categories: ['bags', 'drinkware'],
};

const bare: BusinessProfile = {
  name: 'New Factory', description: null, location: null, workingHours: null,
  contactEmail: null, contactPhone: null, languagesServed: [], categories: [],
};

describe('M11.1 · profile validation (pure)', () => {
  it('name required; empty/too-long rejected', () => {
    expect(validateProfile(baseInput).ok).toBe(true);
    expect(validateProfile({ ...baseInput, name: '   ' }).ok).toBe(false);
    expect(validateProfile({ ...baseInput, name: 'x'.repeat(201) }).ok).toBe(false);
  });

  it('email + phone shapes; empty optionals become null', () => {
    expect(validateProfile({ ...baseInput, contactEmail: 'nope' }).ok).toBe(false);
    expect(validateProfile({ ...baseInput, contactEmail: 'a@b.co' }).ok).toBe(true);
    expect(validateProfile({ ...baseInput, contactPhone: 'abc' }).ok).toBe(false);
    const r = validateProfile({ ...baseInput, contactPhone: '+86 138 0000 0000' });
    expect(r.ok && r.value.contactPhone).toBe('+8613800000000');
    const empty = validateProfile(baseInput);
    expect(empty.ok && empty.value.description).toBeNull();
    expect(empty.ok && empty.value.contactPhone).toBeNull();
  });

  it('languages filtered to the supported set; description capped', () => {
    const r = validateProfile({ ...baseInput, languagesServed: ['en', 'xx', 'ar', 'fr'] });
    expect(r.ok && r.value.languagesServed).toEqual(['en', 'ar']);
    expect(validateProfile({ ...baseInput, description: 'x'.repeat(1001) }).ok).toBe(false);
  });
});

describe('M11.1 · settings renderer (localized)', () => {
  it('en: title, fields, derived categories, save', () => {
    const html = renderSettings(full, 'en', null);
    expect(html).toContain('Business profile');
    expect(html).toContain('Company name'); expect(html).toContain('Yiwu Sunshine Trading');
    expect(html).toContain('Working hours'); expect(html).toContain('Languages served');
    expect(html).toContain('Product categories');
    expect(html).toContain('bags'); expect(html).toContain('drinkware');   // derived
    expect(html).toContain('action="/app/settings"');
  });

  it('Phase F: this page no longer keeps its own answer to “what is missing”', () => {
    // My factory owns that question now, from ONE derivation (loadOnboarding).
    // A blank field on this form already says the same thing where it matters.
    for (const p of [full, bare]) {
      const html = renderSettings(p, 'en', null);
      expect(html).not.toContain('Profile checklist');
      expect(html).not.toContain('All set');
      expect(html).not.toContain('○');
      expect(html).not.toContain('%');
    }
  });

  it('derived categories empty state; language checkboxes reflect served set', () => {
    expect(renderSettings(bare, 'en', null)).toContain('Add products and their categories appear here');
    const html = renderSettings(full, 'en', null);
    expect(html).toMatch(/name="lang_en"[^>]*checked/);
    expect(html).toMatch(/name="lang_zh"[^>]*checked/);
    expect(html).not.toMatch(/name="lang_ar"[^>]*checked/);   // ar not served here
  });

  it('zh + ar render localized labels', () => {
    expect(renderSettings(full, 'zh', null)).toContain('企业资料');
    expect(renderSettings(full, 'zh', null)).toContain('公司名称');
    const ar = renderSettings(full, 'ar', null);
    expect(ar).toContain('ملف النشاط'); expect(ar).toContain('اسم الشركة');
  });

  it('escapes owner-entered values; no tables; no tech vocabulary (every locale)', () => {
    const evil = renderSettings({ ...full, name: '<script>x</script>' }, 'en', null);
    expect(evil).not.toContain('<script>x'); expect(evil).toContain('&lt;script&gt;');
    for (const l of LOCALES) {
      const html = (renderSettings(full, l, null) + renderSettings(bare, l, null)).toLowerCase();
      expect(html).not.toContain('<table');
      for (const w of ['ai', 'llm', 'model', 'api', 'webhook', 'database']) {
        expect(new RegExp(`\\b${w}\\b`).test(html), `${l}:${w}`).toBe(false);
      }
    }
  });
});

/**
 * M20.4 (F-07) — the M21 rehearsal stopped here: a Chinese landline without a
 * leading "+" was rejected, the error said only "check what you entered", and
 * the description, location, hours, e-mail and languages were all discarded.
 */
describe('M20.4 · F-07 · a rejected save loses nothing and says which field', () => {
  const typed = {
    name: '义乌宏发保温杯厂', description: '不锈钢保温杯、饭盒、竹砧板。',
    location: '浙江义乌', workingHours: '周一至周六 9:00-18:00',
    contactEmail: 'sales@hongfa.example', contactPhone: '8657985001234',   // the M21 input
    languagesServed: ['zh', 'en'],
  };

  it('THE M21 REPRODUCTION: that exact phone is rejected, and only the phone', () => {
    const r = validateProfile(typed);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual({ contactPhone: 'phoneShape' });
  });

  it('reports EVERY bad field at once, so one retry is enough', () => {
    const r = validateProfile({ ...typed, name: '', contactEmail: 'not-an-email', contactPhone: 'abc' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual({ name: 'required', contactEmail: 'emailShape', contactPhone: 'phoneShape' });
  });

  it('the re-render carries the owner’s own words back, not the stored row', () => {
    const stored: BusinessProfile = { ...bare, name: 'OLD NAME' };
    const html = renderSettings(stored, 'zh', null, typed, { contactPhone: 'phoneShape' });
    for (const v of ['义乌宏发保温杯厂', '不锈钢保温杯、饭盒、竹砧板。', '浙江义乌',
                     '周一至周六 9:00-18:00', 'sales@hongfa.example', '8657985001234'])
      expect(html, v).toContain(v);
    expect(html).not.toContain('OLD NAME');          // the submission wins
  });

  it('marks the field that failed, and only that one', () => {
    const html = renderSettings(bare, 'en', null, typed, { contactPhone: 'phoneShape' });
    expect(html.match(/class="fld bad"/g) ?? []).toHaveLength(1);
    expect(html).toContain('role="alert"');
    expect(html).toContain('Start with + and the country code');
  });

  it('the phone error states the shape it wants', () => {
    expect(renderSettings(bare, 'en', null, typed, { contactPhone: 'phoneShape' }))
      .toContain('+8657985001234');
    expect(renderSettings(bare, 'zh', null, typed, { contactPhone: 'phoneShape' }))
      .toContain('要以+和国家号开头');
    expect(renderSettings(bare, 'ar', null, typed, { contactPhone: 'phoneShape' }))
      .toContain(t('ar', 'settings.err.phoneShape'));   // states the shape: + and the country code
  });

  it('checkbox state survives too — the languages she ticked stay ticked', () => {
    const html = renderSettings(bare, 'en', null, { ...typed, languagesServed: ['ar'] }, { contactPhone: 'phoneShape' });
    expect(html).toMatch(/name="lang_ar"[^>]*checked/);
    expect(html).not.toMatch(/name="lang_zh"[^>]*checked/);
  });

  it('a valid phone with + still passes, in every locale’s rendering', () => {
    expect(validateProfile({ ...typed, contactPhone: '+8657985001234' }).ok).toBe(true);
    expect(validateProfile({ ...typed, contactPhone: '' }).ok).toBe(true);   // empty clears
  });
});

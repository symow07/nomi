import { describe, it, expect } from 'vitest';
import {
  validateProfile, renderSettings, type ProfileInput, type BusinessProfile,
} from '../../src/api/web/settings.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

const baseInput: ProfileInput = {
  name: 'Acme', description: '', location: '', workingHours: '',
  contactEmail: '', contactPhone: '', languagesServed: ['en', 'zh'],
};

const checklist = (over: Partial<Record<string, boolean>> = {}): BusinessProfile['checklist'] =>
  ([
    ['settings.field.name', true], ['settings.field.description', false], ['settings.field.location', false],
    ['settings.field.workingHours', false], ['settings.field.contactEmail', false], ['settings.field.categories', false],
  ] as const).map(([label, done]) => ({ label, done: over[label] ?? done }));

const full: BusinessProfile = {
  name: 'Yiwu Sunshine Trading', description: 'Household goods exporter', location: 'Yiwu, Zhejiang',
  workingHours: '9:00-18:00 Mon-Sat', contactEmail: 'sales@example.com', contactPhone: '+8613800000000',
  languagesServed: ['en', 'zh'], categories: ['bags', 'drinkware'],
  checklist: checklist({ 'settings.field.description': true, 'settings.field.location': true, 'settings.field.workingHours': true, 'settings.field.contactEmail': true, 'settings.field.categories': true }),
};

const bare: BusinessProfile = {
  name: 'New Factory', description: null, location: null, workingHours: null,
  contactEmail: null, contactPhone: null, languagesServed: [], categories: [], checklist: checklist(),
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
  it('en: title, checklist, fields, derived categories, save', () => {
    const html = renderSettings(full, 'en', null);
    expect(html).toContain('Business profile');
    expect(html).toContain('Profile checklist');
    expect(html).toContain('Company name'); expect(html).toContain('Yiwu Sunshine Trading');
    expect(html).toContain('Working hours'); expect(html).toContain('Languages served');
    expect(html).toContain('Product categories');
    expect(html).toContain('bags'); expect(html).toContain('drinkware');   // derived
    expect(html).toContain('action="/app/settings"');
    expect(html).toContain('✓ All set');                                    // complete → allSet
  });

  it('checklist is honest ✓/○, never a percentage', () => {
    const html = renderSettings(bare, 'en', null);
    expect(html).toContain('○');                       // missing items
    expect(html).not.toContain('%');
    expect(html).not.toContain('All set');             // incomplete
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

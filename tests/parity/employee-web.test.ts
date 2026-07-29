import { describe, it, expect } from 'vitest';
import { renderEmployee, type EmployeeProfile } from '../../src/api/web/employee.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

const base: EmployeeProfile = {
  hireDate: new Date('2026-07-09T00:00:00Z'),
  stage: 'partial',
  canDo: ['greet'], needConfirm: ['quote', 'negotiate', 'follow_up'],
  capabilities: [
    { capability: 'greet', mode: 'auto', promotable: false },
    { capability: 'quote', mode: 'draft', promotable: true },
    { capability: 'negotiate', mode: 'draft', promotable: false },
  ],
  growth: [
    { kind: 'promote', capability: 'greet', at: new Date('2026-07-15T00:00:00Z') },
    { kind: 'spotcheck_pass', capability: null, at: new Date('2026-07-14T00:00:00Z') },
    { kind: 'learned_edit', capability: 'quote', at: new Date('2026-07-10T00:00:00Z') },
  ],
  promoted: true, conditions: [],
};

const probation: EmployeeProfile = {
  ...base, stage: 'probation', canDo: [], promoted: false,
  capabilities: [{ capability: 'greet', mode: 'draft', promotable: false }],
  growth: [], conditions: [{ cond: 'passed_spotcheck', met: true }, { cond: 'learned_correction', met: false }],
};

describe('M9.6 · employee profile (localized)', () => {
  it('card: name is a per-locale constant; stage/role localized', () => {
    const zh = renderEmployee(base, 'zh', null);
    expect(zh).toContain('员工档案'); expect(zh).toContain('小雅');
    expect(zh).toContain('正式接待'); expect(zh).toContain('客户接待'); expect(zh).toContain('入职');
    const en = renderEmployee(base, 'en', null);
    expect(en).toContain('Employee file'); expect(en).toContain('Lily');
    expect(en).toContain('Customer reception');
    expect(renderEmployee(base, 'ar', null)).toContain('ياسمين');
  });

  it('duties: canDo / needConfirm / cannotDo from capability codes', () => {
    const zh = renderEmployee(base, 'zh', null);
    expect(zh).toContain('现在可以'); expect(zh).toContain('接待问候');   // greet
    expect(zh).toContain('需要确认'); expect(zh).toContain('报价');       // quote
    expect(zh).toContain('暂不能'); expect(zh).toContain('确认订单');     // confirm_order
    const en = renderEmployee(base, 'en', null);
    expect(en).toContain('Can do now'); expect(en).toContain('Greeting');
    expect(en).toContain('Needs your OK'); expect(en).toContain('Quoting');
    expect(en).toContain('Cannot do'); expect(en).toContain('Confirming orders');
  });

  it('growth: neutral event kinds render localized (with capability name)', () => {
    const zh = renderEmployee(base, 'zh', null);
    expect(zh).toContain('成长记录');
    expect(zh).toContain('「接待问候」晋升');
    expect(zh).toContain('抽查通过');
    expect(zh).toContain('学会一次修正（报价）');
    const en = renderEmployee(base, 'en', null);
    expect(en).toContain('Promoted: Greeting');
    expect(en).toContain('Spot-check passed');
    expect(en).toContain('Learned a correction (Quoting)');
    expect(renderEmployee({ ...base, growth: [] }, 'en', null)).toContain('Just getting started');
    expect(renderEmployee({ ...base, growth: [] }, 'zh', null)).toContain('还在起步');
  });

  it('promotion: stage, next step, real conditions — no invented score', () => {
    const zh = renderEmployee(probation, 'zh', null);
    expect(zh).toContain('晋升状态'); expect(zh).toContain('试用期'); expect(zh).toContain('正式接待');
    expect(zh).toContain('✓ 通过一次抽查'); expect(zh).toContain('○ 学会一次修正');
    const en = renderEmployee(probation, 'en', null);
    expect(en).toContain('Promotion'); expect(en).toContain('Probation');
    expect(en).toContain('Handling some on her own');
    expect(en).toContain('✓ Pass one spot-check'); expect(en).toContain('○ Learn one correction');
  });

  it('actions: revoke on granted, promote only where eligible, confirm_order note', () => {
    const en = renderEmployee(base, 'en', null);
    expect(en).toContain('action="/app/employee/capability/greet/revoke"');
    expect(en).toContain('action="/app/employee/capability/quote/promote"');
    expect(en).not.toContain('capability/negotiate/promote');
    expect(en).toContain('Confirming orders always waits for you');
    expect(renderEmployee(base, 'zh', null)).toContain('确认订单永远等你');
  });

  it('never shows a confidence score or technical vocabulary — every locale', () => {
    for (const l of LOCALES) {
      const html = (renderEmployee(base, l, null) + renderEmployee(probation, l, null)).toLowerCase();
      for (const banned of ['ai', 'llm', 'model', 'confidence', 'accuracy', 'automation', 'api',
        '置信度', '准确率', '模型', '人工智能', '%']) {
        const hit = /^[a-z ]+$/.test(banned) ? new RegExp(`\\b${banned}\\b`).test(html) : html.includes(banned);
        expect(hit, `${l}:"${banned}"`).toBe(false);
      }
    }
  });

  it('mobile: no tables', () => {
    expect(renderEmployee(base, 'en', null)).not.toContain('<table');
  });
});

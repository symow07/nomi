import { describe, it, expect } from 'vitest';
import { renderEmployee, type EmployeeProfile } from '../../src/api/web/employee.js';

const base: EmployeeProfile = {
  name: '小雅', hireDate: new Date('2026-07-09T00:00:00Z'),
  stageZh: '正式接待（部分）', roleZh: '客户接待',
  canDo: ['接待问候'], needConfirm: ['报价', '谈价', '跟进客户'], cannotDo: ['确认订单', '承诺库存'],
  capabilities: [
    { capability: 'greet', nameZh: '接待问候', mode: 'auto', promotable: false },
    { capability: 'quote', nameZh: '报价', mode: 'draft', promotable: true },
    { capability: 'negotiate', nameZh: '谈价', mode: 'draft', promotable: false },
  ],
  growth: [
    { icon: '⭐', textZh: '「接待问候」晋升', at: new Date('2026-07-15T00:00:00Z') },
    { icon: '✓', textZh: '抽查通过', at: new Date('2026-07-14T00:00:00Z') },
    { icon: '⭐', textZh: '学会一次修正（报价）', at: new Date('2026-07-10T00:00:00Z') },
  ],
  promoted: true, nextStepZh: null, conditions: [],
};

const probation: EmployeeProfile = {
  ...base, stageZh: '试用期', canDo: [], promoted: false, nextStepZh: '正式接待',
  capabilities: [{ capability: 'greet', nameZh: '接待问候', mode: 'draft', promotable: false }],
  growth: [], conditions: [{ label: '通过一次抽查', met: true }, { label: '学会一次修正', met: false }],
};

describe('M9.6 · employee profile (pure)', () => {
  it('card shows name, stage, role, hire date — owner language', () => {
    const html = renderEmployee(base, null);
    expect(html).toContain('员工档案');
    expect(html).toContain('小雅');
    expect(html).toContain('正式接待');
    expect(html).toContain('客户接待');
    expect(html).toContain('入职');
  });

  it('工作职责: 现在可以 / 需要确认 / 暂不能 from capability data', () => {
    const html = renderEmployee(base, null);
    expect(html).toContain('现在可以');
    expect(html).toContain('接待问候');
    expect(html).toContain('需要确认');
    expect(html).toContain('报价');
    expect(html).toContain('暂不能');
    expect(html).toContain('确认订单');
  });

  it('成长记录 renders real trust events; empty state is honest', () => {
    const html = renderEmployee(base, null);
    expect(html).toContain('成长记录');
    expect(html).toContain('「接待问候」晋升');
    expect(html).toContain('抽查通过');
    expect(html).toContain('学会一次修正（报价）');
    const empty = renderEmployee({ ...base, growth: [] }, null);
    expect(empty).toContain('还在起步');
  });

  it('晋升状态 shows stage, next step, and real conditions (no invented score)', () => {
    const html = renderEmployee(probation, null);
    expect(html).toContain('晋升状态');
    expect(html).toContain('试用期');
    expect(html).toContain('正式接待');
    expect(html).toContain('通过一次抽查');
    expect(html).toContain('学会一次修正');
    // met vs unmet marks
    expect(html).toContain('✓ 通过一次抽查');
    expect(html).toContain('○ 学会一次修正');
  });

  it('owner actions: revoke on granted, promote only where eligible', () => {
    const html = renderEmployee(base, null);
    expect(html).toContain('action="/app/employee/capability/greet/revoke"');   // greet is auto → revocable
    expect(html).toContain('action="/app/employee/capability/quote/promote"');  // quote eligible → promotable
    expect(html).not.toContain('capability/negotiate/promote');                 // not eligible → not offered
    expect(html).toContain('确认订单永远等你');
  });

  it('never shows a confidence score, accuracy, or technical vocabulary', () => {
    const html = (renderEmployee(base, null) + renderEmployee(probation, null)).toLowerCase();
    for (const banned of ['ai', 'llm', 'model', 'confidence', 'accuracy', 'automation', 'system', 'api',
      '置信度', '准确率', '模型', '人工智能', '%']) {
      const needle = banned.toLowerCase();
      const hit = /^[a-z ]+$/.test(needle) ? new RegExp(`\\b${needle}\\b`).test(html) : html.includes(needle);
      expect(hit, `"${banned}"`).toBe(false);
    }
  });

  it('mobile: no tables', () => {
    expect(renderEmployee(base, null)).not.toContain('<table');
  });
});

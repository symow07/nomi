import { describe, it, expect } from 'vitest';
import { ATTENTION_PRIORITY, renderOperationsHome, type OperationsSnapshot } from '../../src/api/web/operations.js';
import { ownershipOf, WAITING_HUMAN_AGENT, OWNER_AGENT } from '../../src/core/conversation/ownership.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

/**
 * M16.2a — the Operations snapshot is a neutral, honest shape. These pure tests
 * pin down that it invents nothing (no scores/percentages/confidence/rankings)
 * and that the ownership mapping the read model relies on is the M16.1 one.
 */

const sample = (): OperationsSnapshot => ({
  range: 'week',
  attention: { pendingApprovals: 2, handoffs: 1, ownerHandling: 1 },
  activity: { handled: 5, draftsCreated: 4, corrections: 1 },
  knowledge: { openGaps: 3, recentCorrections: 1, recentlyTaught: 2 },
  channel: { status: 'not_connected', provider: 'disabled' },
  hasAttention: true,
});

describe('M16.2a · operations snapshot (pure)', () => {
  it('is a neutral shape — exactly the expected sections, all plain integers', () => {
    const s = sample();
    expect(Object.keys(s).sort()).toEqual(['activity', 'attention', 'channel', 'hasAttention', 'knowledge', 'range']);
    for (const grp of [s.attention, s.activity, s.knowledge]) {
      for (const v of Object.values(grp)) expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('invents no metric — no score / percentage / confidence / ranking anywhere', () => {
    const blob = JSON.stringify(sample()).toLowerCase();
    for (const banned of ['score', 'percent', '%', 'confidence', 'rank', 'rating', 'weight']) {
      expect(blob.includes(banned), banned).toBe(false);
    }
  });

  it('attention priority is explicit and ordered — no urgency scoring', () => {
    // Human waiting first, then approvals, then knowledge gaps. Context buckets
    // (ownerHandling, activity) are NOT attention demands and are excluded.
    expect(ATTENTION_PRIORITY).toEqual(['handoffs', 'pendingApprovals', 'openGaps']);
    expect(ATTENTION_PRIORITY).not.toContain('ownerHandling');
    expect(ATTENTION_PRIORITY).not.toContain('activity');
  });

  it('ownership mapping is the M16.1 one (handoffs vs owner-handling)', () => {
    expect(ownershipOf(WAITING_HUMAN_AGENT)).toBe('WAITING_HUMAN');   // → handoffs
    expect(ownershipOf(OWNER_AGENT)).toBe('OWNER_CONTROLLED');        // → ownerHandling
    expect(ownershipOf(null)).toBe('AI');                            // → neither
    expect(ownershipOf('agent-9')).toBe('OWNER_CONTROLLED');         // any human id counts as handling
  });
});

/**
 * M16.2b — the Operations Home renderer. Consumes ONLY the snapshot (the read
 * model is the boundary). Counts only: no urgency score, no percentage, no
 * ranking, no interpretation. Localized (en/zh/ar); RTL is the shell's job.
 */

const populated: OperationsSnapshot = {
  range: 'today',
  attention: { pendingApprovals: 2, handoffs: 1, ownerHandling: 1 },
  activity: { handled: 5, draftsCreated: 4, corrections: 1 },
  knowledge: { openGaps: 3, recentCorrections: 1, recentlyTaught: 2 },
  channel: { status: 'not_connected', provider: 'disabled' },
  hasAttention: true,
};
const emptyFactory: OperationsSnapshot = {
  range: 'today',
  attention: { pendingApprovals: 0, handoffs: 0, ownerHandling: 0 },
  activity: { handled: 0, draftsCreated: 0, corrections: 0 },
  knowledge: { openGaps: 0, recentCorrections: 0, recentlyTaught: 0 },
  channel: { status: 'not_connected', provider: 'disabled' },
  hasAttention: false,
};

describe('M16.2b · operations home (render)', () => {
  it('en: four sections, real counts, deep links into the owning surfaces', () => {
    const html = renderOperationsHome(populated, 'en');
    expect(html).toContain('Needs your attention');
    expect(html).toContain('Waiting for you');       // handoffs
    expect(html).toContain('Approvals needed');      // pending approvals
    expect(html).toContain('Questions to answer');   // gaps (M14 wording, reused)
    expect(html).toContain('System status');
    expect(html).toContain('Conversations handled'); // activity fact
    // counts shown as-is
    for (const n of ['>1<', '>2<', '>3<', '>5<', '>4<']) expect(html).toContain(n);
    // deep links exist
    expect(html).toContain('href="/app/inbox"');
    expect(html).toContain('href="/app/inbox?filter=pending"');
    expect(html).toContain('href="/app/knowledge"');
    expect(html).toContain('href="/app/analytics"');
  });

  it('zh + ar render in their own language', () => {
    const zh = renderOperationsHome(populated, 'zh');
    expect(zh).toContain('需要你处理'); expect(zh).toContain('等你接手'); expect(zh).toContain('系统状态');
    expect(zh).not.toContain('Needs your attention');
    const ar = renderOperationsHome(populated, 'ar');
    expect(ar).toContain('يحتاج انتباهك'); expect(ar).toContain('حالة النظام');
  });

  it('attention is shown in ATTENTION_PRIORITY order — no urgency scoring', () => {
    const html = renderOperationsHome(populated, 'en');
    const waiting = html.indexOf('Waiting for you');
    const approvals = html.indexOf('Approvals needed');
    const gaps = html.indexOf('Questions to answer');
    expect(waiting).toBeGreaterThanOrEqual(0);
    expect(waiting).toBeLessThan(approvals);
    expect(approvals).toBeLessThan(gaps);
  });

  it('empty factory shows the honest all-caught-up state, no attention cards', () => {
    for (const [l, phrase] of [['en', "You're all caught up"], ['zh', '都处理完了'], ['ar', 'أنجزت كل شيء']] as const) {
      const html = renderOperationsHome(emptyFactory, l);
      expect(html).toContain(phrase);
    }
    const en = renderOperationsHome(emptyFactory, 'en');
    expect(en).not.toContain('Waiting for you');   // attention cards only render when non-zero
    expect(en).not.toContain('Approvals needed');
  });

  it('system status is honest pre-Meta — never pretends messaging is live', () => {
    const html = renderOperationsHome(populated, 'en');
    expect(html).toContain('Waiting for connection');
    expect(html).toContain('Messaging is not active yet');
    expect(html).toContain('class="pill warn"');
    expect(html).not.toContain('class="pill ok"');   // not "Connected"
  });

  it('invents no metric — no score / percentage / ranking in any locale', () => {
    for (const l of LOCALES) {
      const html = (renderOperationsHome(populated, l) + renderOperationsHome(emptyFactory, l)).toLowerCase();
      for (const banned of ['score', 'confidence', 'percent', '%', 'ranking', 'rating']) {
        expect(html.includes(banned), `${l}:${banned}`).toBe(false);
      }
    }
  });

  it('never leaks technical / employee-hiding vocabulary — in every locale', () => {
    const LATIN = ['ai', 'llm', 'model', 'token', 'api', 'webhook', 'database', 'confidence', 'automation', 'prompt'];
    const CJK = ['模型', '人工智能', '数据库', '置信度', '接口'];
    for (const l of LOCALES) {
      const html = (renderOperationsHome(populated, l) + renderOperationsHome(emptyFactory, l)).toLowerCase();
      for (const w of LATIN) expect(new RegExp(`\\b${w}\\b`).test(html), `${l}:${w}`).toBe(false);
      for (const w of CJK) expect(html.includes(w), `${l}:${w}`).toBe(false);
    }
  });

  it('escapes nothing buyer-supplied (snapshot carries no free text) and is mobile-first', () => {
    const html = renderOperationsHome(populated, 'en');
    expect(html).not.toContain('<table');
    expect(html).toContain('@media (max-width:560px)');
  });
});

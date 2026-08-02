import { describe, it, expect } from 'vitest';
import { ATTENTION_PRIORITY, needsOwnerAttention, renderOperationsHome, type OperationsSnapshot } from '../../src/api/web/operations.js';
import { ownershipOf, WAITING_HUMAN_AGENT, OWNER_AGENT } from '../../src/core/conversation/ownership.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';

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
    // A buyer waiting for a person first, then replies to review, then the
    // threads the owner took over herself, then knowledge gaps.
    expect(ATTENTION_PRIORITY).toEqual(['handoffs', 'pendingApprovals', 'ownerHandling', 'openGaps']);
    expect(ATTENTION_PRIORITY).not.toContain('activity');
  });

  it('each attention row leads somewhere different — two rows, one destination is a dead tap', () => {
    const s: OperationsSnapshot = { ...emptyFactory, hasAttention: true,
      attention: { pendingApprovals: 1, handoffs: 1, ownerHandling: 1 },
      knowledge: { openGaps: 1, recentCorrections: 0, recentlyTaught: 0 } };
    const hrefs = [...renderOperationsHome(s, 'en').matchAll(/class="need" href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toHaveLength(4);
    expect(new Set(hrefs).size).toBe(4);
  });

  it('a conversation the owner took over is attention, not background', () => {
    // Today used to render "you're all caught up · Lily is looking after your
    // buyers" while the owner personally owed a buyer a reply.
    const s: OperationsSnapshot = { ...emptyFactory,
      attention: { pendingApprovals: 0, handoffs: 0, ownerHandling: 1 }, hasAttention: true };
    expect(needsOwnerAttention(s)).toBe(true);
    const html = renderOperationsHome(s, 'en');
    expect(html).toContain('You are handling these');
    expect(html).not.toContain("You're all caught up");
    expect(html).not.toContain('Nothing needs you right now');
    // and it is reachable, not just stated
    expect(html).toContain('href="/app/inbox?filter=all"');   // its own group, not the approvals list
  });

  it('calm means calm: nothing waiting, nothing drafted, nothing of the owner’s own', () => {
    const s = emptyFactory;
    expect(needsOwnerAttention(s)).toBe(false);
    expect(renderOperationsHome(s, 'en')).toContain("You're all caught up");
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

describe('Nomi Phase B · Today (render)', () => {
  const obs = { conversationsNeedingYou: 3, reasons: [
    { kind: 'human_requested', count: 1 },
    { kind: 'complaint', count: 1 },
  ] };

  it('needs-you rows are tappable, counted, and deep-link to the owning surface', () => {
    const html = renderOperationsHome(populated, 'en', obs);
    expect(html).toContain('Needs your attention');
    expect(html).toContain('Waiting for you');       // handoffs
    expect(html).toContain('Approvals needed');      // approvals
    expect(html).toContain('Questions to answer');   // gaps (M14 wording, reused)
    // each row is a LINK carrying its own count — one thumb, no hunting
    expect(html).toContain('<a class="need" href="/app/inbox"');
    expect(html).toContain('<a class="need" href="/app/inbox?filter=pending"');
    expect(html).toContain('<a class="need" href="/app/knowledge"');
    for (const n of ['>1<', '>2<', '>3<']) expect(html).toContain(n);
  });

  it('rows appear in ATTENTION_PRIORITY order — humans waiting first', () => {
    const html = renderOperationsHome(populated, 'en', obs);
    const waiting = html.indexOf('Waiting for you');
    const approvals = html.indexOf('Approvals needed');
    const gaps = html.indexOf('Questions to answer');
    expect(waiting).toBeLessThan(approvals);
    expect(approvals).toBeLessThan(gaps);
  });

  it('a quiet day is a designed state, not an empty grid', () => {
    for (const [l, phrase] of [['en', "You're all caught up"], ['zh', '都处理完了'], ['ar', 'أنجزت كل شيء']] as const) {
      const html = renderOperationsHome(emptyFactory, l);
      expect(html).toContain(phrase);
      expect(html).toContain('class="block calm"');
    }
    const en = renderOperationsHome(emptyFactory, 'en');
    expect(en).toContain('Lily is looking after your buyers');   // says WHY it is calm
    expect(en).not.toContain('class="need"');                    // no attention rows at all
  });

  it('takeover observation: two real counts as a fraction, with reasons', () => {
    const html = renderOperationsHome(populated, 'en', obs);
    expect(html).toContain('How often you stepped in');
    expect(html).toContain('3 of 5 conversations needed you');   // 5 = activity.handled
    expect(html).toContain('Why you stepped in');
    expect(html).toContain('the buyer asked for a person');      // M16.1 wording reused
    expect(html).toContain('a complaint');
  });

  it('the fraction is only shown when the denominator is honest', () => {
    // needed > handled (possible across ranges) ⇒ drop the denominator, never lie
    const odd = renderOperationsHome(
      { ...populated, activity: { ...populated.activity, handled: 1 } }, 'en',
      { conversationsNeedingYou: 4, reasons: [] });
    expect(odd).toContain('4 conversations needed you');
    expect(odd).not.toContain('4 of 1');
    // and nothing to report reads as such
    const none = renderOperationsHome(populated, 'en', { conversationsNeedingYou: 0, reasons: [] });
    expect(none).toContain('You did not need to step in.');
  });

  it('only reasons backed by events are shown', () => {
    const html = renderOperationsHome(populated, 'en', { conversationsNeedingYou: 1, reasons: [] });
    expect(html).not.toContain('Why you stepped in');            // no invented categories
  });

  it('the section is omitted entirely when no observation is supplied', () => {
    expect(renderOperationsHome(populated, 'en')).not.toContain('How often you stepped in');
  });

  it('learning reads as her learning, not a score', () => {
    const html = renderOperationsHome(populated, 'en', obs);
    expect(html).toContain('Lily is learning from your corrections');
    expect(html).toContain('Facts added');
    expect(html).toContain('Answers corrected');
    const quiet = renderOperationsHome(emptyFactory, 'en', obs);
    expect(quiet).toContain('Nothing new taught yet.');
  });

  it('activity is plain counts — no comparison, no ranking', () => {
    const html = renderOperationsHome(populated, 'en', obs);
    expect(html).toContain('What Lily did');
    expect(html).toContain('Buyers she talked to');
    expect(html).toContain('Replies prepared');
    expect(html).toContain('Replies you corrected');
    for (const w of ['vs', 'compared', 'last week', 'trend', 'better', 'worse']) {
      expect(html.toLowerCase().includes(w), w).toBe(false);
    }
  });

  it('messaging state is one quiet line, never a fake Connected badge', () => {
    const html = renderOperationsHome(populated, 'en', obs);
    expect(html).toContain('Messaging is not active yet');
    expect(html).toContain('class="notlive"');
    expect(html).not.toContain('class="pill ok"');
    // it is no longer a status card competing with real work
    expect(html).not.toContain('System status');
  });

  it('zh + ar render in their own language, and RTL is handled', () => {
    const zh = renderOperationsHome(populated, 'zh', obs);
    expect(zh).toContain('需要你处理'); expect(zh).toContain('等你接手');
    expect(zh).toContain('你出面了几次');
    expect(zh).not.toContain('Needs your attention');
    const ar = renderOperationsHome(populated, 'ar', obs);
    expect(ar).toContain('يحتاج انتباهك'); expect(ar).toContain('كم مرة تدخّلت');
    // the chevron must not point the wrong way in RTL
    expect(ar).toContain('class="go need-go"');                     // the shell mirrors it
  });

  it('invents no metric — no score / percentage / ranking in any locale', () => {
    for (const l of LOCALES) {
      const html = (renderOperationsHome(populated, l, obs) + renderOperationsHome(emptyFactory, l, obs)).toLowerCase();
      for (const banned of ['score', 'confidence', 'percent', '%', 'ranking', 'rating', 'rate']) {
        expect(html.includes(banned), `${l}:${banned}`).toBe(false);
      }
    }
  });

  it('M17.4: infrastructure health stays OFF Today', () => {
    for (const l of LOCALES) {
      const html = renderOperationsHome(populated, l, obs);
      expect(html).not.toContain(t(l, 'ops.health.title'));
      const low = html.toLowerCase();
      for (const infra of ['queue', 'worker', 'uptime', 'latency', 'memory', 'cpu']) {
        expect(low.includes(infra), `${l}:"${infra}"`).toBe(false);
      }
    }
  });

  it('never leaks technical / employee-hiding vocabulary — in every locale', () => {
    const LATIN = ['ai', 'llm', 'model', 'token', 'api', 'webhook', 'database', 'confidence', 'automation', 'prompt'];
    const CJK = ['模型', '人工智能', '数据库', '置信度', '接口'];
    for (const l of LOCALES) {
      const html = (renderOperationsHome(populated, l, obs) + renderOperationsHome(emptyFactory, l, obs)).toLowerCase();
      for (const w of LATIN) expect(new RegExp(`\\b${w}\\b`).test(html), `${l}:${w}`).toBe(false);
      for (const w of CJK) expect(html.includes(w), `${l}:${w}`).toBe(false);
    }
  });

  it('mobile-first: no tables, phone breakpoint present', () => {
    const html = renderOperationsHome(populated, 'en', obs);
    expect(html).not.toContain('<table');
    expect(html).toContain('@media (max-width:560px)');
  });
});

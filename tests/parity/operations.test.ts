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
  attention: { pendingApprovals: 2, handoffs: 1, ownerHandling: 1, blockedMessages: 0 },
  activity: { handled: 5, draftsCreated: 4, corrections: 1 },
  knowledge: { openGaps: 3, recentCorrections: 1, recentlyTaught: 2 },
  channel: { status: 'not_connected', provider: 'disabled' }, budget: null,
  hasAttention: true,
});

describe('M16.2a · operations snapshot (pure)', () => {
  it('is a neutral shape — exactly the expected sections, all plain integers', () => {
    const s = sample();
    // G19 — `budget` joined them: her own ceiling, or null until she nears it.
    expect(Object.keys(s).sort()).toEqual(['activity', 'attention', 'budget', 'channel', 'hasAttention', 'knowledge', 'range']);
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
    // M22: a message that never reached a buyer comes first — it is the only
    // concern here the owner has no other way to find. A handoff at least sits
    // visibly in the inbox; a refused reply left a buyer waiting on nothing.
    // Then a buyer waiting for a person, replies to review, the threads she
    // took over herself, and knowledge gaps.
    expect(ATTENTION_PRIORITY).toEqual(
      ['blockedMessages', 'handoffs', 'pendingApprovals', 'ownerHandling', 'openGaps']);
    expect(ATTENTION_PRIORITY).not.toContain('activity');
  });

  it('each attention row leads somewhere different — two rows, one destination is a dead tap', () => {
    const s: OperationsSnapshot = { ...emptyFactory, hasAttention: true,
      attention: { pendingApprovals: 1, handoffs: 1, ownerHandling: 1, blockedMessages: 0 },
      knowledge: { openGaps: 1, recentCorrections: 0, recentlyTaught: 0 } };
    const hrefs = [...renderOperationsHome(s, 'en').matchAll(/class="need" href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toHaveLength(4);
    expect(new Set(hrefs).size).toBe(4);
  });

  it('a conversation the owner took over is attention, not background', () => {
    // Today used to render "you're all caught up · Lily is looking after your
    // buyers" while the owner personally owed a buyer a reply.
    const s: OperationsSnapshot = { ...emptyFactory,
      attention: { pendingApprovals: 0, handoffs: 0, ownerHandling: 1, blockedMessages: 0 }, hasAttention: true };
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
    // M22 (F-01): with messaging LIVE, a quiet day is genuinely all-clear.
    // M35.5 — that used to be a heading above a sentence. The calm state is now
    // ONE sentence, so this asserts the sentence rather than the heading that
    // repeated it.
    expect(renderOperationsHome({ ...s, channel: { status: 'connected', provider: 'meta' } }, 'en'))
      .toContain(t('en', 'today.calm.body'));
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
  attention: { pendingApprovals: 2, handoffs: 1, ownerHandling: 1, blockedMessages: 0 },
  activity: { handled: 5, draftsCreated: 4, corrections: 1 },
  knowledge: { openGaps: 3, recentCorrections: 1, recentlyTaught: 2 },
  channel: { status: 'not_connected', provider: 'disabled' }, budget: null,
  hasAttention: true,
};
const emptyFactory: OperationsSnapshot = {
  range: 'today',
  attention: { pendingApprovals: 0, handoffs: 0, ownerHandling: 0, blockedMessages: 0 },
  activity: { handled: 0, draftsCreated: 0, corrections: 0 },
  knowledge: { openGaps: 0, recentCorrections: 0, recentlyTaught: 0 },
  channel: { status: 'not_connected', provider: 'disabled' }, budget: null,
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

  const liveQuiet: OperationsSnapshot =
    { ...emptyFactory, channel: { status: 'connected', provider: 'meta' } };

  it('a quiet day is a designed state, not an empty grid', () => {
    // M35.5 — the calm state IS the page now: a rule, one sentence, air. Not a
    // card among cards, and not a heading plus a body saying the same thing
    // twice. What must hold is that it is DESIGNED and that it says WHY.
    for (const l of LOCALES) {
      const html = renderOperationsHome(liveQuiet, l);
      expect(html).toContain(t(l, 'today.calm.body'));
      expect(html).toContain('class="calm-page"');
      expect(html).toContain('class="calm-rule"');
      // M49 — NOT the voice serif. "Lily is looking after your buyers" is the
      // PRODUCT reporting on her, not Lily speaking, and serif on product text
      // was the loudest unpolished signal on these pages. The calm state keeps
      // its own composition — a rule and one large line — and stays sans.
      expect(html).toMatch(/class="calm-say"/);
      expect(html).not.toMatch(/calm-say[^"]*voice/);
    }
    const en = renderOperationsHome(liveQuiet, 'en');
    expect(en).not.toContain('class="need"');                    // no attention rows at all
    // AND NO COUNTS. A quiet day renders no count sections whatever.
    expect(en).not.toContain(t('en', 'ops.activity.title'));
    // CC-05 — BUT THE WAY INTO RESULTS STAYS. This line used to forbid it, and
    // in doing so pinned the bug: Results' only link lived inside the section
    // the quiet branch removes, so a new owner and any quiet week had no door
    // into a whole page except typing the URL. The counts go quiet; the door
    // does not. Changed deliberately.
    expect(en).toContain('href="/app/analytics"');
  });

  it('M22 (F-01) · a quiet day with messaging OFF is not the same quiet day', () => {
    // The defect: "Lily is looking after your buyers. Nothing needs you right
    // now." was shown on a factory where messaging was off and she was looking
    // after nobody. Nothing was wrong, and the product said something untrue.
    const html = renderOperationsHome(emptyFactory, 'en');
    expect(html).not.toContain(t('en', 'today.calm.body'));
    expect(html).not.toContain("You're all caught up");
    // M35.5 — the not-live state is ONE sentence now, and it is the title
    // ("No buyer can reach Lily yet"), which states the consequence rather than
    // the mechanism. The body that said "Messaging is not on." was the second
    // sentence saying the same thing.
    expect(html).toContain(t('en', 'today.calm.notLive.title'));
    // The two quiet days remain visibly different: the live one gets the jade
    // rule, this one does not, and only this one offers a way forward.
    expect(html).toContain('class="calm-page off"');
    expect(html).toContain('href="/app/factory"');               // and a way forward
    // Asserted on the MARKUP: 'calm-mark' also appears in the stylesheet, which
    // ships on every render, so matching the bare string would always pass.
    expect(html).not.toContain('<div class="calm-mark"');        // no ✓ for a non-achievement
  });

  it('M22 (F-01) · says nothing about stepping in when nothing happened', () => {
    // "You did not need to step in" reads as a good outcome. With nothing
    // handled and nothing needed it is not an outcome, it is an absence.
    const quiet = { conversationsNeedingYou: 0, reasons: [] };
    expect(renderOperationsHome(emptyFactory, 'en', quiet))
      .not.toContain('You did not need to step in');
    // But once she HAS handled conversations, "you did not need to" is real.
    const worked = { ...liveQuiet, activity: { handled: 6, draftsCreated: 4, corrections: 1 } };
    expect(renderOperationsHome(worked, 'en', quiet)).toContain('You did not need to step in');
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

  it('learning reads as learning, not a score', () => {
    const html = renderOperationsHome(populated, 'en', obs);
    expect(html).toContain(t('en', 'today.learning.title'));
    expect(html).toContain('Facts added');
    expect(html).toContain('Answers corrected');
    const quiet = renderOperationsHome(emptyFactory, 'en', obs);
    expect(quiet).toContain('Nothing new taught yet.');
  });

  it('activity is plain counts — no comparison, no ranking', () => {
    const html = renderOperationsHome(populated, 'en', obs);
    expect(html).toContain(t('en', 'ops.activity.title'));
    expect(html).toContain(t('en', 'ops.activity.handled'));
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
    expect(ar).toContain('يحتاج انتباهك'); expect(ar).toContain(t('ar', 'today.stepIn.title'));
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

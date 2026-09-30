import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { conversationUrl, esc } from '../../src/api/web/layout.js';
import { renderConversationDetail, type ConversationDetail, type TimelineMessage } from '../../src/api/web/inbox.js';
import { renderSandbox, practiceUrl, type SandboxView } from '../../src/api/web/sandbox.js';
import type { PracticeTrust } from '../../src/trust/practiceChecks.js';
import type { Flash } from '../../src/api/web/flash.js';
import { flashTone } from '../../src/core/owner/flashTone.js';
import { usd } from '../../src/core/types/money.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';

/**
 * CC-25 leftovers — every way into a conversation lands on its newest message,
 * and so does every way back from an action on one (2026-09-27).
 *
 * #95 opened the conversation page on `#latest` from Buyers. Everything else
 * still wrote the bare address: an action on the page (send, skip, take over,
 * reply, hand to, a voice note, a proof link…) sent the owner back to the TOP,
 * where the notice was, a transcript away from where she had been; and the
 * calendar, an order, Today's rows, the samples list and a follow-up's thread
 * opened a conversation at the top too. Practice still drew its approval above
 * its transcript. The owner's decisions: one address (`conversationUrl`) that
 * lands on `#latest`; the notice drawn there, under the newest message and
 * above what she does next; Practice in the conversation page's order. The
 * notice carries the `latest` mark itself when there is one — landing on the
 * message put it off the screen under any long message (an e-mail).
 *
 * The scans are the rule, and the renders are what it is for. Over Postgres,
 * each action's 302 and the pages it lands on:
 * tests/integration/conversation-landing.test.ts.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
/** Every .ts file under a directory of the repo, as repo-relative paths. */
const sources = (dir: string): string[] => readdirSync(join(ROOT, dir)).flatMap((f) => {
  const rel = `${dir}/${f}`;
  return statSync(join(ROOT, rel)).isDirectory() ? sources(rel) : rel.endsWith('.ts') ? [rel] : [];
});

/**
 * Every place a source writes a conversation PAGE's address by hand:
 * `/app/inbox/`, then an interpolated id that is NOT followed by `/`, or a
 * quoted `/app/inbox/` with something concatenated onto it. A form's target
 * (`/app/inbox/${id}/act`) is not the page, and a route's pattern
 * (`/app/inbox/:conversationId`) interpolates nothing.
 */
const handWritten = (src: string): string[] =>
  [...src.matchAll(/\/app\/inbox\/(?:\$\{[^}]*\}(?!\/)|['"`]\s*\+)/g)].map((m) => m[0]);

/** The helper's own definition — the one place allowed to write it. */
const HELPER = /export const conversationUrl = [^;]*;/;
const PRACTICE_HELPER = /export const practiceUrl = [^;]*;/;

describe('CC-25 · one address for a conversation', () => {
  it('the scan tells the page from a form’s target (its own control, on the shapes main wrote)', () => {
    // Each line below is one main shipped before this change: every one opened
    // a conversation at its top, and the scan must see each.
    for (const bad of [
      'return flashTo(reply, `/app/inbox/${encodeURIComponent(conversationId)}`, key);',          // app.ts, /act
      'const back = `/app/inbox/${encodeURIComponent(cid)}`;',                                     // app.ts, /assistant
      '${back(`/app/inbox/${esc(cid)}`, t(localeOf(req), \'inbox.detail.back\'))}',               // app.ts, the voice page
      ': e.conversationId ? `/app/inbox/${encodeURIComponent(e.conversationId)}` : null;',          // calendar.ts
      'return `<div class="dhead">${back(`/app/inbox/${esc(v.conversationId)}`, t(locale, \'order.back\'))}</div>', // orders.ts
      '<a class="deeper" href="/app/inbox/${esc(r.conversationId)}">',                             // settings.ts, samples
      '? `<a href="/app/inbox/${esc(e.conversationId)}">${esc(t(locale, \'seq.enrolment.thread\'))}</a>` : \'\';', // sequences.ts
      'href: `/app/inbox/${encodeURIComponent(quoted.conversation_id)}`, buyer: quoted.buyer },',  // insights.ts, Today
      '${earlier ? back(`/app/inbox/${cid}?before=${earlier}#latest`, t(locale, \'inbox.log.earlier\')) : \'\'}', // inbox.ts, paging
      'reply.redirect(\'/app/inbox/\' + id)',
    ]) expect(handWritten(bad), bad).toHaveLength(1);
    // …and passes what is not the page: forms' targets, the list, its filters, route patterns.
    for (const fine of [
      '<form method="post" action="/app/inbox/${cid}/act" class="acts">',
      'action="/app/inbox/${encodeURIComponent(conversationId)}/answer-now"',
      'src="/app/inbox/${encodeURIComponent(conversationId)}/voice/${encodeURIComponent(m.id)}"',
      "app.post('/app/inbox/:conversationId/act', async (req, reply) => {",
      "return reply.redirect('/app/inbox');", "deeper('/app/inbox?filter=pending', label)",
    ]) expect(handWritten(fine), fine).toEqual([]);
  });

  it('nothing under src/ writes a conversation page’s address but `conversationUrl`', () => {
    const found = sources('src').flatMap((f) => {
      const src = read(f);
      const own = f === 'src/api/web/layout.ts' ? src.replace(HELPER, '') : src;
      return handWritten(own).map((a) => `${f}: ${a}`);
    });
    expect(found).toEqual([]);
  });

  it('the helper writes it once, and every kind of door and return goes through it', () => {
    const def = HELPER.exec(read('src/api/web/layout.ts'))?.[0] ?? '';
    expect(handWritten(def)).toHaveLength(1);
    for (const f of [
      'src/api/web/app.ts',            // every redirect back to a conversation, and the voice page's door
      'src/api/web/inbox.ts',          // Buyers' rows, "Earlier messages", "Latest messages"
      'src/api/web/conversations.ts',  // the buyer file
      'src/api/web/calendar.ts', 'src/api/web/orders.ts', 'src/api/web/settings.ts',   // the calendar, an order, samples
      'src/api/web/sequences.ts', 'src/api/web/insights.ts',                           // a follow-up's thread, Today's rows
    ]) expect(read(f), f).toContain('conversationUrl(');
    // the actions themselves: each route that answers with a redirect back to a conversation
    const app = read('src/api/web/app.ts');
    for (const route of ['/act', '/takeover', '/handto', '/assistant', '/reply', '/answer-now', '/heard', '/resume']) {
      const at = app.indexOf(`app.post('/app/inbox/:conversationId${route}'`);
      expect(at, route).toBeGreaterThan(-1);
      const handler = app.slice(at, app.indexOf('\n  });', at));
      expect(handler, route).toMatch(/conversationUrl\(|takeoverFlash\(/);
    }
    expect(app).toMatch(/const takeoverFlash = [\s\S]{0,300}flashTo\(reply, conversationUrl\(cid\)/);
    expect(app).toMatch(/app\.post\(`\/app\/inbox\/:conversationId\/proof\$\{verb\}`[\s\S]{0,400}conversationUrl\(cid\)/);
    expect(app).toMatch(/const uncertainAction = [\s\S]{0,900}conversationUrl\(r\.conversationId\)/);
  });

  it('lands on the newest message; the id stays one path segment; a real id or cursor carries no %', () => {
    const CONV = '44444444-4444-4444-8444-444444444444';
    const CURSOR = '1790000000123_0b5e7c1a-2f3d-4e8a-9c6b-1d2e3f4a5b6c';
    expect(conversationUrl(CONV)).toBe(`/app/inbox/${CONV}#latest`);
    expect(conversationUrl(CONV, null)).toBe(`/app/inbox/${CONV}#latest`);
    expect(conversationUrl(CONV, CURSOR)).toBe(`/app/inbox/${CONV}?before=${CURSOR}#latest`);
    expect(conversationUrl(CONV, `-${CURSOR}`)).toBe(`/app/inbox/${CONV}?before=-${CURSOR}#latest`);
    for (const u of [conversationUrl(CONV), conversationUrl(CONV, CURSOR)]) expect(u).not.toContain('%');
    // whatever it is handed, it never grows a second segment, a query or a fragment of its own
    expect(conversationUrl('a/b?c#d')).toBe('/app/inbox/a%2Fb%3Fc%23d#latest');
    expect(conversationUrl(CONV, 'x&y#z')).toBe(`/app/inbox/${CONV}?before=x%26y%23z#latest`);
    // Practice lands the same way (P3: there is no mode left to carry).
    expect(practiceUrl()).toBe('/app/sandbox#latest');
    expect(practiceUrl(CURSOR)).toBe(`/app/sandbox?before=${CURSOR}#latest`);
  });

  it('every practice action goes back through `practiceUrl`, and nothing else writes that address', () => {
    const app = read('src/api/web/app.ts');
    const practice = app.slice(app.indexOf('// ── Practice (M12.2; per workspace since P3'));
    expect(practice.length).toBeGreaterThan(1000);
    // In the practice routes, `/app/sandbox…` is written only as a ROUTE: a
    // literal anywhere else is an address somebody is sent to by hand.
    expect([...practice.matchAll(/(?<!(?:app\.get|app\.post|sbxAction)\()['"`]\/app\/sandbox[^'"`]*['"`]?/g)].map((m) => m[0])).toEqual([]);
    expect(practice).toMatch(/flashTo\(reply, practiceUrl\(\), `takeover\.flash\./);
    for (const f of sources('src')) {
      const src = f === 'src/api/web/sandbox.ts' ? read(f).replace(PRACTICE_HELPER, '') : read(f);
      expect(src, f).not.toMatch(/\/app\/sandbox\?mode=/);
    }
  });
});

// ── the pages ──────────────────────────────────────────────────────────────

const ID = '0b5e7c1a-2f3d-4e8a-9c6b-1d2e3f4a5b6c';
const CONV = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-09-27T10:00:00Z');
const SENT: Flash = { text: 'Waiting to send.', bad: false };
const REFUSED: Flash = { text: 'Only the owner may do that.', bad: true };

const msgs = (n: number, from = 1): TimelineMessage[] => Array.from({ length: n }, (_, i) => ({
  direction: (from + i) % 2 === 1 ? 'inbound' : 'outbound', text: `m-${String(from + i).padStart(3, '0')}`,
  at: new Date(NOW.getTime() - (n - i) * 60_000),
}));

const detail = (over: Partial<ConversationDetail> = {}): ConversationDetail => ({
  conversationId: CONV, buyer: 'Ahmed', country: 'AE', status: 'awaiting',
  product: { name: 'Vacuum cup', nameZh: null }, quantity: 5000,
  quote: { unitPrice: usd(0.92), total: usd(4600), quantity: 5000 }, order: null,
  messages: msgs(50, 401), transcript: { earlier: `1790000000123_${ID}`, older: false },
  pendingDraft: { draftId: 'd-1', draftText: 'For 5,000 pcs: $0.92/pc FOB Ningbo.', capability: 'quote' },
  ownership: 'AI', refusals: [], uncertainSends: [], handoffReasons: [], unheardReason: null,
  lastHumanAction: null, knowledgeUsed: ['Lead time'], rate: null, leadTimeBlocked: null, sampleAsked: null,
  proof: { quoteId: null, token: null }, ...over,
});

const at = (html: string, needle: string): number => {
  const i = html.indexOf(needle);
  expect(i, needle).toBeGreaterThan(-1);
  return i;
};
const notices = (html: string) => html.split('class="flash').length - 1;
const marks = (html: string) => html.split('id="latest"').length - 1;
/** Where the page lands after an action: the notice itself, carrying the mark. */
const landing = (html: string): number => {
  const m = /<div class="flash(?: bad)?" role="(?:status|alert)" id="latest">/.exec(html);
  expect(m, 'the notice carries the landing mark').not.toBeNull();
  return m!.index;
};

describe('CC-25 · the conversation page lands on the notice, under the newest message', () => {
  it('under the newest message, above the reply to approve, carrying the mark — in every locale, in both tones', () => {
    for (const l of LOCALES) {
      for (const flash of [SENT, REFUSED]) {
        const html = renderConversationDetail(detail(), l, NOW, flash);
        const newest = at(html, '<bdi>m-450</bdi>');
        const notice = landing(html);
        const draft = at(html, 'class="card draft"');
        expect(notice, l).toBeGreaterThan(newest);
        expect(notice, l).toBeLessThan(draft);
        expect(draft, l).toBeLessThan(at(html, 'class="card takeover'));
        expect(notices(html), `${l}: one notice`).toBe(1);
        expect(marks(html), `${l}: one landing`).toBe(1);   // the message gives the mark up to it
        // nothing between the newest message and the notice but the end of the transcript
        expect(html.slice(newest, notice), l).not.toMatch(/class="card|<form/);
        // and nothing of it above the transcript, where it used to be drawn
        expect(html.slice(0, at(html, '<div class="block">')), l).not.toContain('flash');
        expect(html.slice(notice, draft), l).toContain(`role="${flash.bad ? 'alert' : 'status'}"`);
      }
    }
  });

  it('with no notice, the newest message keeps the mark (#95) and nothing is drawn', () => {
    const html = renderConversationDetail(detail(), 'en', NOW, null);
    expect(notices(html)).toBe(0);
    expect(marks(html)).toBe(1);
    expect(html).toMatch(/id="latest" class="msg (?:inbound|outbound)">\s*<div dir="auto" class="bubble"><bdi>m-450<\/bdi>/);
  });

  it('while she holds the conversation, it sits over her own reply box', () => {
    const html = renderConversationDetail(detail({ ownership: 'OWNER_CONTROLLED', pendingDraft: null }), 'en', NOW, SENT);
    const notice = landing(html);
    expect(notice).toBeGreaterThan(at(html, '<bdi>m-450</bdi>'));
    expect(notice).toBeLessThan(at(html, `action="/app/inbox/${CONV}/reply"`));
    expect(notice).toBeLessThan(at(html, 'class="card takeover'));
  });

  it('a window further back shows a notice after its transcript, with nothing to act on', () => {
    const older = renderConversationDetail(
      detail({ messages: msgs(50, 351), transcript: { earlier: `1790000000000_${ID}`, older: true } }), 'en', NOW, SENT);
    expect(landing(older)).toBeGreaterThan(at(older, t('en', 'inbox.log.latest')));
    expect(marks(older)).toBe(1);
    expect(older).not.toContain('class="card');
  });

  it('an empty conversation: the notice follows its empty transcript, and is where it lands', () => {
    const html = renderConversationDetail(detail({ messages: [], transcript: { earlier: null, older: false } }), 'en', NOW, SENT);
    expect(landing(html)).toBeGreaterThan(at(html, t('en', 'inbox.detail.noMessages')));
    expect(marks(html)).toBe(1);
    // with nothing to say, nothing is marked, as #95 had it
    expect(renderConversationDetail(detail({ messages: [], transcript: { earlier: null, older: false } }), 'en', NOW, null))
      .not.toContain('id="latest"');
  });
});

// ── Practice ───────────────────────────────────────────────────────────────

const trust: PracticeTrust = {
  scenarioId: null, scenarioTitle: null, capability: 'quote', appliedMode: 'draft',
  guardViolations: 0, handoff: false, quote: null,
  checks: [{ invariant: 'priceFloorRespected', pass: true, detail: 'ok' }],
};
const practice = (over: Partial<SandboxView> = {}): SandboxView => ({
  hasConversation: true, lastTurn: trust, ownership: 'AI',
  pendingDraft: { draftId: 'd-1', draftText: 'Our MOQ is 1,000 pcs.' },
  messages: Array.from({ length: 50 }, (_, i) => ({ direction: i % 2 ? 'outbound' : 'inbound', text: `p-${i + 1}`, isImage: false })),
  transcript: { earlier: `1790000000123_${ID}`, older: false }, ...over,
});

describe('CC-25 · Practice reads in the conversation page’s order', () => {
  it('the transcript, the notice, her reply to approve, the take-over card, the checks, the buyer’s next message', () => {
    for (const l of LOCALES) {
      {
        const html = renderSandbox(practice(), l, { flash: SENT });
        const order = [
          at(html, 'class="timeline"'), at(html, '<bdi>p-50</bdi>'), landing(html),
          at(html, 'class="card draft"'), at(html, 'class="card takeover'),
          at(html, 'class="card sbx-trust'), at(html, 'id="compose"'),
        ];
        expect(order, l).toEqual([...order].sort((a, b) => a - b));
        expect(notices(html), l).toBe(1);
        expect(marks(html), l).toBe(1);
        expect(html.slice(at(html, '<bdi>p-50</bdi>'), at(html, 'class="card draft"')), l).not.toMatch(/class="card|<form/);
        // after an action with nothing to say — a line sent, a case loaded — the newest line is the landing
        const quiet = renderSandbox(practice(), l, { flash: null });
        expect(quiet, l).toMatch(/id="latest" class="msg (?:inbound|outbound)">\s*<div dir="auto" class="bubble"><bdi>p-50<\/bdi>/);
        expect(at(quiet, 'id="latest"'), l).toBeLessThan(at(quiet, 'class="card draft"'));
      }
    }
  });

  it('while she holds it, the notice sits over her own reply box; the approval steps aside', () => {
    const html = renderSandbox(practice({ ownership: 'OWNER_CONTROLLED' }), 'en', { flash: SENT });
    expect(html).not.toContain('action="/app/sandbox/act"');
    const notice = landing(html);
    expect(notice).toBeGreaterThan(at(html, '<bdi>p-50</bdi>'));
    expect(notice).toBeLessThan(at(html, 'action="/app/sandbox/reply"'));
  });

  it('Reset empties it, and lands on its notice: under the empty transcript, the box under that', () => {
    const empty = practice({ hasConversation: false, messages: [], pendingDraft: null, lastTurn: null, transcript: { earlier: null, older: false } });
    const html = renderSandbox(empty, 'en', { flash: SENT });
    expect(landing(html)).toBeGreaterThan(at(html, `<div class="empty muted">${esc(t('en', 'sandbox.empty'))}</div>`));
    expect(at(html, 'id="compose"')).toBeGreaterThan(landing(html));
    expect(marks(html)).toBe(1);
    // and what it says is good news: it was painted as a refusal, unseen until she landed on it
    expect(flashTone('sandbox.reset.done')).toBe('ok');
  });

  it('a window further back is for reading: the transcript and the way home, nothing to act on', () => {
    const html = renderSandbox(practice({ transcript: { earlier: null, older: true } }), 'en', { flash: null });
    expect(html).toContain(`href="${practiceUrl()}"`);
    for (const gone of ['class="card draft"', 'class="card takeover', 'class="card sbx-trust', 'id="compose"', 'action="/app/sandbox/message"']) {
      expect(html, gone).not.toContain(gone);
    }
    expect(html).toContain('action="/app/sandbox/reset"');   // starting over is always offered
  });

  it('P3 — no practice form carries a mode: there is one lane, the real worker', () => {
    const html = renderSandbox(practice({ ownership: 'OWNER_CONTROLLED' }), 'en', { flash: null });
    for (const action of ['/app/sandbox/reset', '/app/sandbox/reply', '/app/sandbox/resume', '/app/sandbox/scenario', '/app/sandbox/message']) {
      const form = new RegExp(`<form method="post" action="${action}"[^>]*>[\\s\\S]*?</form>`).exec(html)?.[0] ?? '';
      expect(form.length, action).toBeGreaterThan(0);
      expect(form, action).not.toContain('name="mode"');
    }
  });
});

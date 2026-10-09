import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Locale } from '../../core/owner/i18n/locale.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
import type { Db } from '../../db/client.js';
import type { AdvisorModel } from '../../llm/ports.js';
import { messages } from '../../core/owner/i18n/messages.js';
import { t } from './say.js';
import { esc, deeper, back, ORB_JS } from './layout.js';
import { flashBanner, type Flash } from './flash.js';
import * as show from './values.js';
import { answerFollowUp, type AdvisorAnswer } from '../../advisor/answer.js';
import type { AdvisorMemory, KeptTurn, ThreadRow, MemoryState } from '../../advisor/memory.js';

/**
 * THE ADVISOR (the advisor batch, 2026-10-06; docs/ADVISOR-GROUNDING.md, approved). The owner asks; the
 * answer's facts come only from src/advisor/reads.ts — read-only queries, in the asker's own workspace —
 * and the model only words them, checked (src/advisor/check.ts). Missing data is said in a fixed sentence,
 * never a figure. Advice is labelled as advice.
 *
 * THE WALL, at the code level:
 *   · Signed in only: anyone the session does not know — any customer — is sent to sign in.
 *   · Read-only by construction. This module and what it reaches import no sender, queue, pipeline or
 *     setting; the database is reached only through src/advisor/reads.ts, whose imports are read functions
 *     only, on a pool that is read-only at the server (`createReadOnlyDb`), each read in its own
 *     transaction opened `read only`. app.ts hands it five things: who is asking, their language, the
 *     shell, that pool, and the model. There is no tool, button or path from here to a send, a price or a
 *     setting. tests/parity/advisor-build.test.ts holds the import graph; tests/integration/advisor-build
 *     .test.ts proves a write through its pool is refused, and that asking writes nothing.
 *   · Kept only with consent (0130; docs/ADVISOR-MEMORY.md). The owner switches history on for the workspace
 *     (D1), each person says yes or "Not now" on a card after an answer, and only then is a question and its
 *     answer kept — sealed, in that person's own history, which nobody else can read (D2). Without it, a
 *     question and its answer are drawn once and forgotten. The routes are handed a narrow port for it
 *     (`AdvisorMemory`), never a writable pool. History only helps understand a follow-up; it is NEVER a
 *     source of facts (src/advisor/answer.ts). The routes log quietly: a question is the owner's own words.
 */

/** The longest question the box takes. */
export const ADVISOR_MAX = 1000;

/**
 * THE ADVISOR'S ORB (2026-10-07; the owner's pick, docs/design/advisor-orb/). The library's own orb, drawn as
 * it ships — geometry, dots, count and timing unchanged: its `composing` state (a sash of dotted lanes round a
 * sphere, read as columns), thinking at its tuned 64 px, resting the same orb shown larger (192 px, 144 on a
 * phone — the stylesheet's) at half the pace. Ours: its two ends (the light end, and the ink a far dot recedes
 * into) and the magenta halo behind it — nothing solid: no body, no shadow (the owner, 2026-10-09), so every dot shows.
 * The glow is the palette's `orbGlow`, which is decorative and the orb's alone; never "needs you".
 */
const ORB_STATE = 'composing';
const ORB_GLOW = 'orb-glow';
/** Resting, the orb moves at this fraction of its thinking pace: alive, and calm. */
const ORB_REST_PACE = 0.5;

/**
 * THE PAGE (the redesign, the owner's brief of 2026-10-08): calm and minimal. A lit field — a soft magenta
 * wash, deepest where the orb is, the paper showing at the edges — the orb in it, "Hello, {name}" under it,
 * and a rounded bar pinned at the foot with Ask inside; nothing else at rest. After a question the orb goes
 * down beside the bar, small, and stays there like a chat; the light pools wherever the orb is, and fades
 * before the bar's edge, so the bar sits on clean paper. The one script draws the field, the orb and the
 * glide; with it off the page is plain paper, the greeting and the bar, and nothing waits empty.
 */
const resting = (greeting: string): string =>
  `<div class="adv-hero">
      <div class="orb-rest-row"><canvas class="orb-rest" data-orb-rest data-orb-pace="${ORB_REST_PACE}" width="576" height="576" aria-hidden="true"></canvas></div>
      <p class="adv-hello" dir="auto">${esc(greeting)}</p>
    </div>`;

/**
 * While the question is on its way, and only then (the one script): the question goes up as asked, and under
 * it a calm line that says the orb is looking (what a screen reader hears). Inert until then: a template
 * draws nothing. The orb itself thinks beside the bar.
 */
const pending = (locale: Locale): string =>
  `<template data-orb-pending>${bubble('owner', '<bdi data-orb-asked></bdi>', t(locale, 'advisor.you'))}<div class="msg inbound orb-wait" data-orb-wait role="status">
      <p class="orb-line muted">${esc(t(locale, 'advisor.thinking'))}</p>
    </div></template>`;

export type AdvisorViewer = {
  readonly businessId: string;
  readonly viewerId: string;
  /** The signed-in person's own name, for "Hello, {name}"; null: none on record (the access code's session). */
  readonly name?: string | null;
};

/**
 * A name that is the person's own, or null. The access code's owner is a stand-in ('owner') or a row born with
 * the business's name (people.ts, ownerPerson): neither is a person's name, and the page then says only "Hello".
 */
export function ownName(person: { readonly id: string; readonly name: string } | null | undefined, business: string | null): string | null {
  const name = (person?.name ?? '').trim();
  if (!person || person.id === 'owner' || name === '') return null;
  const same = (x: string) => x.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  return business !== null && same(name) === same(business) ? null : name;
}

/** Everything the advisor's routes are given. Nothing else reaches them. */
export type AdvisorIO = {
  /** Who is asking: a signed-in person of the account, or null (never a customer). */
  readonly viewer: (req: FastifyRequest) => AdvisorViewer | null;
  readonly locale: (req: FastifyRequest) => Locale;
  /** The shell, drawn around the page (read-only: the rail, the business's name, the needs-you count). */
  readonly page: (req: FastifyRequest, o: { readonly title: string; readonly active: string; readonly bodyHtml: string }) => string;
  /** The advisor's pool, read-only at the server; null: this installation cannot answer yet. */
  readonly db: Db | null;
  /** The model that words the facts; null: this installation cannot answer yet. */
  readonly model: AdvisorModel | null;
  /** 0130 — each person's own history (src/advisor/memory.ts); null: this installation keeps none. */
  readonly memory: AdvisorMemory | null;
  /** The provider that words the answers, as the privacy page names it, in the reader's language. */
  readonly processor: (locale: Locale) => string;
  /** Who words the answers, recorded on each kept turn. */
  readonly provider: { readonly name: string; readonly model: string } | null;
  /** The shell's notice: set for the next page, then the redirect; and read on the page it lands on. */
  readonly flashTo: (reply: FastifyReply, path: string, key: MessageKey, params?: Record<string, string>) => FastifyReply;
  readonly takeFlash: (req: FastifyRequest, reply: FastifyReply) => Flash | null;
};

/** What the page shows of a person's history, when they keep it. */
export type HistoryView = {
  /** The conversation this page continues: its turns, oldest first. */
  readonly turns?: readonly (KeptTurn & { readonly askedAt: Date })[];
  /** The conversation a question posted here continues; absent: a new one. */
  readonly threadId?: string | null;
  /** Their other conversations, newest first. */
  readonly earlier?: readonly ThreadRow[];
  /** The opt-in card, after an answer (D6): the provider it names. */
  readonly card?: { readonly processor: string } | null;
  /** A conversation the key cannot open (D8). */
  readonly unreadable?: boolean;
  readonly flash?: Flash | null;
};

/** One line of the exchange, in the conversation page's own pieces: the owner's words, or the advisor's. */
const bubble = (who: 'owner' | 'advisor', inner: string, label: string, latest = false, after = ''): string =>
  `<div${latest ? ' id="latest"' : ''} class="msg ${who === 'owner' ? 'outbound' : 'inbound'}">
      <div dir="auto" class="bubble${who === 'advisor' ? ' adv' : ''}">${inner}</div>
      <div class="ts muted">${esc(label)}</div>${after}
    </div>`;
const words = (s: string): string => `<bdi>${esc(s)}</bdi>`;
const list = (lines: readonly string[]): string => `<ul class="adv-facts">${lines.map((l) => `<li><bdi>${esc(l)}</bdi></li>`).join('')}</ul>`;

const EXAMPLES: readonly MessageKey[] = ['advisor.example.1', 'advisor.example.2', 'advisor.example.3', 'advisor.example.4', 'advisor.example.5'];

/** The answer, as the advisor says it. */
function answerHtml(locale: Locale, a: AdvisorAnswer): string {
  switch (a.kind) {
    case 'fact':
      return a.phrased ? `<p>${words(a.text)}</p>` : `<p>${words(t(locale, 'advisor.fallback.head'))}</p>${list(a.lines)}`;
    case 'opinion':
      return `<p class="adv-label">${esc(t(locale, 'advisor.opinion.label'))}</p>${a.phrased || a.lines.length === 0
        ? `<p>${words(a.text)}</p>` : `<p>${words(t(locale, 'advisor.opinion.unchecked'))}</p>${list(a.lines)}`}${a.based.length
        ? `<p class="small muted">${words(t(locale, 'advisor.opinion.based', { list: a.based.join(' · ') }))}</p>` : ''}`;
    case 'unknown':
      return `<p>${words(a.text)}</p>${list(EXAMPLES.map((k) => t(locale, k)))}`;
    default:
      return `<p>${words(a.text)}</p>`;
  }
}

/** A door's label as kept: a catalogue key of this build, or nothing (a key a later build retired). */
const isKey = (k: string): k is MessageKey => Object.prototype.hasOwnProperty.call(messages.en, k);

/** A kept turn, as the answer it was. */
const asAnswer = (k: KeptTurn): AdvisorAnswer => {
  const door = k.door && isKey(k.door.label) ? { href: k.door.href, label: k.door.label } : undefined;
  switch (k.kind) {
    case 'fact': return { kind: 'fact', text: k.text, lines: k.lines, phrased: k.phrased, ...(door ? { door } : {}) };
    case 'opinion': return { kind: 'opinion', text: k.text, lines: k.lines, phrased: k.phrased, based: k.based };
    case 'none': return { kind: 'none', text: k.text, ...(door ? { door } : {}) };
    default: return { kind: k.kind, text: k.text };
  }
};

/** One exchange: the owner's words, the advisor's answer, and the door that shows the same thing. */
const exchangeHtml = (locale: Locale, asked: string, answer: AdvisorAnswer, latest: boolean): string => {
  const door = 'door' in answer && answer.door ? `<div class="doors">${deeper(answer.door.href, t(locale, answer.door.label))}</div>` : '';
  return `${bubble('owner', words(asked), t(locale, 'advisor.you'))}${bubble('advisor', answerHtml(locale, answer), t(locale, 'nav.advisor'), latest, door)}`;
};

/** D6 — the card, after an answer: two buttons of equal weight, and where to read what is kept. */
const consentCard = (locale: Locale, processor: string): string =>
  `<section class="adv-consent" aria-labelledby="adv-consent-h">
      <h2 id="adv-consent-h">${esc(t(locale, 'advisor.memory.title'))}</h2>
      <p>${esc(t(locale, 'advisor.memory.ask'))}</p>
      <p class="small muted">${esc(t(locale, 'advisor.memory.what', { processor }))} ${esc(t(locale, 'advisor.memory.off'))}</p>
      <form method="post" action="/app/advisor/consent" class="choices">
        <button class="btn" type="submit" name="choice" value="allow">${esc(t(locale, 'advisor.memory.allow'))}</button>
        <button class="btn" type="submit" name="choice" value="notnow">${esc(t(locale, 'advisor.memory.notNow'))}</button>
      </form>
      <div class="doors">${deeper('/privacy#advisor', t(locale, 'advisor.memory.more'))}</div>
    </section>`;

/** Their other conversations, on a page of their own: each opened, or deleted (asked once); newest first. */
export function renderEarlier(locale: Locale, rows: readonly ThreadRow[], flash: Flash | null = null): string {
  return `${back('/app/advisor', t(locale, 'nav.advisor'))}
    <h1 class="page">${esc(t(locale, 'advisor.thread.earlier'))}</h1>
    ${flashBanner(flash)}
    ${rows.length === 0 ? `<p class="muted">${esc(t(locale, 'advisor.thread.none'))}</p>` : `<ul class="rows adv-earlier">${rows.map((r) => `<li class="row lines">
        <a href="/app/advisor/c/${esc(r.id)}#latest"><bdi>${esc(r.title ?? t(locale, 'advisor.thread.unreadable'))}</bdi></a>
        <span class="caption muted">${esc(show.date(locale, r.lastTurnAt))}</span>
        <form method="post" action="/app/advisor/c/${esc(r.id)}/delete" class="inline">
          <button class="btn" type="submit" onclick="return confirm(this.dataset.confirm)"
            data-confirm="${esc(t(locale, 'advisor.thread.deleteConfirm'))}">${esc(t(locale, 'advisor.thread.delete'))}</button></form>
      </li>`).join('')}</ul>`}`;
}

/** The three questions the empty bar types out, one at a time (the owner's brief: never submitted). */
const SUGGEST: readonly MessageKey[] = ['advisor.example.1', 'advisor.example.2', 'advisor.example.3'];

/**
 * The page. At rest: the lit field, the orb, "Hello, {name}", the bar. Talking: the conversation kept so far
 * (if history is kept), the question just asked with its answer and the door to the page that shows the same
 * thing, the card that asks to keep history after an answer (D6), the bar with the orb beside it. "New
 * conversation" and "Earlier conversations" are two small links at the top.
 */
export function renderAdvisor(locale: Locale, exchange: { readonly asked: string; readonly answer: AdvisorAnswer } | null = null, history: HistoryView = {},
  who: { readonly name?: string | null } = {}): string {
  const name = t(locale, 'nav.advisor');
  const turns = history.turns ?? [];
  const atRest = exchange === null && turns.length === 0 && !history.unreadable;
  const thread = history.threadId ?? null;
  const person = (who.name ?? '').trim();
  const greeting = person ? t(locale, 'advisor.greeting', { name: person }) : t(locale, 'advisor.greeting.plain');
  const suggest = SUGGEST.map((k) => t(locale, k));
  const links = [
    ...(!atRest ? [`<a class="adv-link" href="/app/advisor?new=1">${esc(t(locale, 'advisor.thread.new'))}</a>`] : []),
    ...((history.earlier ?? []).some((r) => r.id !== thread) ? [`<a class="adv-link" href="/app/advisor/earlier">${esc(t(locale, 'advisor.thread.earlier'))}</a>`] : []),
  ];
  return `<div class="adv-page" data-adv="${atRest ? 'rest' : 'chat'}">
    <canvas class="adv-field" data-adv-field aria-hidden="true"></canvas>
    <div class="adv-top">${links.join('')}</div>
    <h1 class="sr">${esc(name)}</h1>
    ${flashBanner(history.flash ?? null)}
    ${atRest ? resting(greeting) : ''}
    <div class="timeline adv-line">
      ${history.unreadable ? bubble('advisor', `<p>${words(t(locale, 'advisor.thread.unreadable'))}</p>`, name, exchange === null) : ''}
      ${turns.map((k, i) => exchangeHtml(locale, k.question, asAnswer(k), exchange === null && i === turns.length - 1)).join('')}
      ${exchange === null ? '' : exchangeHtml(locale, exchange.asked, exchange.answer, true)}
      ${history.card && exchange !== null ? consentCard(locale, history.card.processor) : ''}
    </div>
    ${pending(locale)}
    <form method="post" action="/app/advisor" class="adv-bar" data-orb="${ORB_JS}" data-orb-state="${ORB_STATE}" data-orb-glow="${ORB_GLOW}"
      ${atRest ? `data-adv-suggest="${esc(suggest.join('\n'))}"` : ''}>
      <span class="adv-slot" aria-hidden="true"><canvas class="adv-pool" data-adv-pool></canvas><canvas class="orb" data-orb-here width="192" height="192"></canvas></span>
      <span class="adv-box">
        <label class="sr" for="advisor-q">${esc(t(locale, 'advisor.label'))}</label>
        <textarea id="advisor-q" name="q" rows="1" dir="auto" maxlength="${ADVISOR_MAX}" required
          placeholder="${esc(atRest ? suggest[0]! : t(locale, 'advisor.followUp'))}"></textarea>
        ${thread ? `<input type="hidden" name="thread" value="${esc(thread)}">` : ''}
        <button class="btn send" type="submit">${esc(t(locale, 'advisor.ask'))}</button>
      </span>
    </form>
  </div>`;
}

/**
 * The advisor's two routes, and nothing else: the page, and a question asked on it. Both send anyone not
 * signed in to sign in. The question is cut to the box's length and answered from read-only reads.
 */
export function advisorRoutes(app: FastifyInstance, io: AdvisorIO): void {
  const draw = (req: FastifyRequest, reply: FastifyReply, exchange: Parameters<typeof renderAdvisor>[1], history: HistoryView = {}) => {
    const locale = io.locale(req);
    const who = io.viewer(req);
    return reply.type('text/html; charset=utf-8').send(io.page(req, {
      title: t(locale, 'nav.advisor'), active: 'advisor',
      bodyHtml: renderAdvisor(locale, exchange, { ...history, flash: io.takeFlash(req, reply) }, { name: who?.name ?? null }),
    }));
  };
  const OFF: MemoryState = { workspaceOn: false, consent: null, since: null, keep: false, ask: false, keyProblem: null, person: false };
  const stateOf = async (v: AdvisorViewer, now: Date): Promise<MemoryState> =>
    io.memory ? io.memory.state(v.businessId, v.viewerId, now).catch(() => OFF) : OFF;
  const earlierOf = async (v: AdvisorViewer, s: MemoryState): Promise<readonly ThreadRow[]> =>
    io.memory && s.person ? io.memory.threads(v.businessId, v.viewerId).catch(() => []) : [];

  /** The page before a question: the conversation still going on, if one is kept (D3), else the page at rest. */
  const atRest = async (req: FastifyRequest, reply: FastifyReply, viewer: AdvisorViewer, fresh: boolean) => {
    const now = new Date();
    const state = await stateOf(viewer, now);
    const earlier = await earlierOf(viewer, state);
    // D3: the conversation goes on until four hours of quiet, or "New conversation".
    const current = io.memory && state.keep && !fresh ? await io.memory.current(viewer.businessId, viewer.viewerId, now).catch(() => null) : null;
    const opened = current && io.memory ? await io.memory.open(viewer.businessId, viewer.viewerId, current) : null;
    if (opened && opened !== 'unreadable') return draw(req, reply, null, { turns: opened.turns, threadId: opened.id, earlier });
    return draw(req, reply, null, { earlier, ...(opened === 'unreadable' ? { unreadable: true } : {}) });
  };

  // Quiet: the question is the owner's own words, and the request log would keep them.
  app.get('/app/advisor', { logLevel: 'warn' }, async (req, reply) => {
    const viewer = io.viewer(req);
    if (!viewer) return reply.redirect('/login');
    return atRest(req, reply, viewer, (req.query as { new?: unknown } | undefined)?.new !== undefined);
  });

  // Their earlier conversations, on a page of their own (the redesign): opened, or deleted, from here.
  app.get('/app/advisor/earlier', { logLevel: 'warn' }, async (req, reply) => {
    const viewer = io.viewer(req);
    if (!viewer) return reply.redirect('/login');
    const locale = io.locale(req);
    const rows = await earlierOf(viewer, await stateOf(viewer, new Date()));
    return reply.type('text/html; charset=utf-8').send(io.page(req, {
      title: t(locale, 'advisor.thread.earlier'), active: 'advisor', bodyHtml: renderEarlier(locale, rows, io.takeFlash(req, reply)),
    }));
  });

  // One of their own conversations, opened; asking here continues it. Anyone else's is not found (D2).
  app.get('/app/advisor/c/:id', { logLevel: 'warn' }, async (req, reply) => {
    const viewer = io.viewer(req);
    if (!viewer) return reply.redirect('/login');
    if (!io.memory) return reply.callNotFound();
    const id = (req.params as { id: string }).id;
    const opened = await io.memory.open(viewer.businessId, viewer.viewerId, id);
    if (opened === null) return reply.callNotFound();
    const state = await stateOf(viewer, new Date());
    const earlier = await earlierOf(viewer, state);
    if (opened === 'unreadable') return draw(req, reply, null, { unreadable: true, earlier, threadId: null });
    return draw(req, reply, null, { turns: opened.turns, threadId: state.keep ? opened.id : null, earlier });
  });

  app.post('/app/advisor', { logLevel: 'warn' }, async (req, reply) => {
    const viewer = io.viewer(req);
    if (!viewer) return reply.redirect('/login');
    const body = (req.body ?? {}) as { q?: unknown; thread?: unknown };
    const q = String(body.q ?? '').trim().slice(0, ADVISOR_MAX);
    const now = new Date();
    if (q === '') return atRest(req, reply, viewer, false);
    const locale = io.locale(req);
    const state = await stateOf(viewer, now);
    const memory = io.memory && state.keep ? io.memory : null;
    // The conversation it continues: the one the form names (theirs, or row security finds none), else none.
    const said = typeof body.thread === 'string' ? body.thread : '';
    const earlierTurns = memory && said ? await memory.context(viewer.businessId, viewer.viewerId, said).catch(() => []) : [];
    const answered = io.db && io.model
      ? await answerFollowUp({ db: io.db, model: io.model, businessId: viewer.businessId, viewerId: viewer.viewerId, locale, now }, q, earlierTurns)
        .catch(() => null)
      : null;
    const answer: AdvisorAnswer = answered?.answer
      ?? { kind: 'failed', text: t(locale, io.db && io.model ? 'advisor.failed' : 'advisor.unavailable') };
    if (memory && answered) {
      const a = answered.answer;
      const thread = await memory.keep(viewer.businessId, viewer.viewerId, said || null, {
        question: q, entry: answered.entry, params: answered.params, kind: a.kind, text: a.text,
        lines: 'lines' in a ? a.lines : [], based: a.kind === 'opinion' ? a.based : [],
        phrased: 'phrased' in a ? a.phrased : false,
        door: 'door' in a && a.door ? { href: a.door.href, label: a.door.label } : null,
        subjects: answered.subjects, provider: io.provider?.name ?? null, model: io.provider?.model ?? null,
      }, now);
      const opened = thread ? await memory.open(viewer.businessId, viewer.viewerId, thread) : null;
      if (opened && opened !== 'unreadable') {
        return draw(req, reply, null, { turns: opened.turns, threadId: opened.id, earlier: await earlierOf(viewer, state) });
      }
    }
    return draw(req, reply, { asked: q, answer }, {
      earlier: await earlierOf(viewer, state),
      card: state.ask ? { processor: io.processor(locale) } : null,
    });
  });

  // D6 — the card's two answers. "Allow" keeps what is asked from now on; nothing before it is kept.
  app.post('/app/advisor/consent', { logLevel: 'warn' }, async (req, reply) => {
    const viewer = io.viewer(req);
    if (!viewer) return reply.redirect('/login');
    if (!io.memory) return reply.redirect('/app/advisor');
    const choice = String((req.body as { choice?: unknown } | undefined)?.choice ?? '');
    if (choice !== 'allow' && choice !== 'notnow') return reply.redirect('/app/advisor');
    const state = await stateOf(viewer, new Date());
    if (!state.workspaceOn || !state.person || state.keyProblem) return io.flashTo(reply, '/app/advisor', 'advisor.flash.failed');
    const r = await io.memory.consent(viewer.businessId, viewer.viewerId, choice === 'allow' ? 'granted' : 'refused', io.locale(req));
    return io.flashTo(reply, '/app/advisor', r === 'ok' ? (choice === 'allow' ? 'advisor.flash.on' : 'advisor.flash.notNow') : 'advisor.flash.failed');
  });

  // One conversation of their own, deleted from Nomi's database (asked once, in the page).
  app.post('/app/advisor/c/:id/delete', { logLevel: 'warn' }, async (req, reply) => {
    const viewer = io.viewer(req);
    if (!viewer) return reply.redirect('/login');
    if (!io.memory) return reply.redirect('/app/advisor');
    const id = (req.params as { id: string }).id;
    const r = await io.memory.forget(viewer.businessId, viewer.viewerId, viewer.viewerId, id);
    return io.flashTo(reply, '/app/advisor/earlier', r === 'ok' ? 'advisor.flash.threadDeleted' : 'advisor.flash.failed');
  });
}

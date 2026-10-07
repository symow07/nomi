import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Locale } from '../../core/owner/i18n/locale.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
import type { Db } from '../../db/client.js';
import type { AdvisorModel } from '../../llm/ports.js';
import { t } from './say.js';
import { esc, deeper, ORB_JS } from './layout.js';
import { answerQuestion, type AdvisorAnswer } from '../../advisor/answer.js';

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
 *   · Nothing is kept. A question and its answer are drawn once and forgotten; the routes log quietly.
 */

/** The longest question the box takes. */
export const ADVISOR_MAX = 1000;

/**
 * THE ADVISOR'S ORB (2026-10-07; the owner's pick, docs/design/advisor-orb/). The library's own orb, drawn as
 * it ships — geometry, dots, count and timing unchanged: its `composing` state (a sash of dotted lanes round a
 * sphere, read as columns), thinking at its tuned 64 px, resting the same orb shown larger (192 px, 144 on a
 * phone — the stylesheet's) at half the pace. Ours: its two ends (the light end, and the glow it recedes into)
 * and the ground under it — a magenta halo, a body shaded to its rim and base, a soft shadow on the paper.
 * The glow is the palette's `orbGlow`, which is decorative and the orb's alone; never "needs you".
 */
const ORB_STATE = 'composing';
const ORB_GLOW = 'orb-glow';
/** Resting, the orb moves at this fraction of its thinking pace: alive, and calm. */
const ORB_REST_PACE = 0.5;

/**
 * Resting: drawn only while nothing has been asked — the page's "ask me". Its space is kept from the first
 * paint where the page can script (`@media (scripting: none)` gives it none), so nothing moves when the orb is
 * drawn or if it cannot be; the one script draws it, moving only while the page is seen.
 */
const resting = (): string =>
  `<div class="orb-rest-row"><canvas class="orb-rest" data-orb-rest data-orb-pace="${ORB_REST_PACE}" width="576" height="576" aria-hidden="true"></canvas></div>`;

/**
 * While the question is on its way, and only then (the one script, `thinking`): the question goes up as
 * asked, and under it — on the page's paper, where the answer will be — the orb and a calm line that says
 * the same in words (and is what a screen reader hears). Inert until then: a template draws nothing. With
 * the script off, or the orb not to be had, the page works as before; a reader who asked for less motion
 * gets one still frame.
 */
const pending = (locale: Locale): string =>
  `<template data-orb-pending>${bubble('owner', '<bdi data-orb-asked></bdi>', t(locale, 'advisor.you'))}<div class="msg inbound orb-wait" data-orb-wait role="status">
      <div class="orb-row"><canvas class="orb" width="192" height="192" aria-hidden="true"></canvas><p class="orb-line muted">${esc(t(locale, 'advisor.thinking'))}</p></div>
      <div class="ts muted">${esc(t(locale, 'nav.advisor'))}</div>
    </div></template>`;

export type AdvisorViewer = { readonly businessId: string; readonly viewerId: string };

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

/**
 * The page: the advisor's opening line and what can be asked; the question just asked, if one was, with its
 * answer and the door to the page that shows the same thing; then the box.
 */
export function renderAdvisor(locale: Locale, exchange: { readonly asked: string; readonly answer: AdvisorAnswer } | null = null): string {
  const name = t(locale, 'nav.advisor');
  const door = exchange && 'door' in exchange.answer && exchange.answer.door
    ? `<div class="doors">${deeper(exchange.answer.door.href, t(locale, exchange.answer.door.label))}</div>` : '';
  return `<h1 class="page">${esc(name)}</h1>
    ${exchange === null ? resting() : ''}
    <div class="timeline">
      ${bubble('advisor', `<p>${words(t(locale, 'advisor.hello'))}</p>${list(EXAMPLES.slice(0, 3).map((k) => t(locale, k)))}`, name, exchange === null)}
      ${exchange === null ? '' : `${bubble('owner', words(exchange.asked), t(locale, 'advisor.you'))}${bubble('advisor', answerHtml(locale, exchange.answer), name, true, door)}`}
    </div>
    ${pending(locale)}
    <div class="card sbx-compose" id="ask">
      <form method="post" action="/app/advisor" class="msgbar" data-orb="${ORB_JS}" data-orb-state="${ORB_STATE}" data-orb-glow="${ORB_GLOW}">
        <label class="muted" for="advisor-q">${esc(t(locale, 'advisor.label'))}</label>
        <textarea id="advisor-q" name="q" rows="2" dir="auto" maxlength="${ADVISOR_MAX}" required></textarea>
        <div class="msgacts"><button class="btn send" type="submit">${esc(t(locale, 'advisor.ask'))}</button></div>
      </form>
    </div>`;
}

/**
 * The advisor's two routes, and nothing else: the page, and a question asked on it. Both send anyone not
 * signed in to sign in. The question is cut to the box's length and answered from read-only reads.
 */
export function advisorRoutes(app: FastifyInstance, io: AdvisorIO): void {
  const draw = (req: FastifyRequest, reply: FastifyReply, exchange: Parameters<typeof renderAdvisor>[1]) => {
    const locale = io.locale(req);
    return reply.type('text/html; charset=utf-8').send(io.page(req, {
      title: t(locale, 'nav.advisor'), active: 'advisor', bodyHtml: renderAdvisor(locale, exchange),
    }));
  };
  // Quiet: the question is the owner's own words, and the request log would keep them.
  app.get('/app/advisor', { logLevel: 'warn' }, async (req, reply) => {
    if (!io.viewer(req)) return reply.redirect('/login');
    return draw(req, reply, null);
  });
  app.post('/app/advisor', { logLevel: 'warn' }, async (req, reply) => {
    const viewer = io.viewer(req);
    if (!viewer) return reply.redirect('/login');
    const q = String((req.body as { q?: unknown } | undefined)?.q ?? '').trim().slice(0, ADVISOR_MAX);
    if (q === '') return draw(req, reply, null);
    const locale = io.locale(req);
    const answer: AdvisorAnswer = io.db && io.model
      ? await answerQuestion({ db: io.db, model: io.model, businessId: viewer.businessId, viewerId: viewer.viewerId, locale, now: new Date() }, q)
        .catch((): AdvisorAnswer => ({ kind: 'failed', text: t(locale, 'advisor.failed') }))
      : { kind: 'failed', text: t(locale, 'advisor.unavailable') };
    return draw(req, reply, { asked: q, answer });
  });
}

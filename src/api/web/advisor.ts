import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Locale } from '../../core/owner/i18n/locale.js';
import { t } from './say.js';
import { esc } from './layout.js';

/**
 * THE ADVISOR RUN (2026-10-06) — the advisor's page, in the rail's freed slot. The owner: "a chat page for the
 * advisor. For now it is a SHELL: the chat UI only … with a placeholder reply saying it's coming soon. It must
 * NOT answer real questions yet, NOT read customer data yet." What it may read and how it must answer is
 * docs/ADVISOR-GROUNDING.md, which waits for the owner's approval before anything here answers.
 *
 * THE WALL, built in now, at the code level rather than the page's:
 *   · Signed in only. The page is for whoever holds the account's login; a customer has no session, so a
 *     customer never reaches it (`signedIn`, from the session app.ts reads for every /app page).
 *   · Read-only by construction. This module imports nothing that reads the database, sends, prices, queues,
 *     calls a model or saves a setting — and it is handed nothing that can: app.ts gives it exactly three
 *     functions (`AdvisorIO`): whether the request is signed in, its language, and the shell to draw in.
 *     There is no tool, button, form or path from here to a send, a price or a setting.
 *     `tests/parity/advisor-wall.test.ts` reads this file's whole import graph, the routes it registers and
 *     what app.ts hands it, and fails if any of that changes.
 *   · Nothing is kept. A question asked is drawn back once, with the placeholder reply, and forgotten: no
 *     table holds it, no log line carries it (the routes are registered quiet).
 */

/** The longest question the box takes. */
export const ADVISOR_MAX = 1000;

/** Everything the advisor's routes are given. Nothing else reaches them. */
export type AdvisorIO = {
  /** Whether this request carries a signed-in session (the account's people), never a customer. */
  readonly signedIn: (req: FastifyRequest) => boolean;
  readonly locale: (req: FastifyRequest) => Locale;
  /** The shell, drawn around the page (read-only: the rail, the business's name, the needs-you count). */
  readonly page: (req: FastifyRequest, o: { readonly title: string; readonly active: string; readonly bodyHtml: string }) => string;
};

/** One line of the exchange: the owner's own words, or the advisor's. */
const line = (who: 'owner' | 'advisor', text: string, label: string, latest = false): string =>
  `<div${latest ? ' id="latest"' : ''} class="msg ${who === 'owner' ? 'outbound' : 'inbound'}">
      <div dir="auto" class="bubble"><bdi>${esc(text)}</bdi></div>
      <div class="ts muted">${esc(label)}</div>
    </div>`;

/**
 * The page: the advisor's opening line (what is coming, and that nothing is looked up yet); the question just
 * asked, if one was, and the same placeholder in reply; then the box. The conversation page's own pieces — the
 * timeline, the bubbles, the send box — in their plain voice: the light magenta is the assistant's ("the
 * assistant did this"), and the advisor is not the assistant.
 */
export function renderAdvisor(locale: Locale, asked: string | null = null): string {
  const name = t(locale, 'nav.advisor');
  const soon = t(locale, 'advisor.soon');
  return `<h1 class="page">${esc(name)}</h1>
    <div class="timeline">
      ${line('advisor', soon, name, asked === null)}
      ${asked === null ? '' : `${line('owner', asked, t(locale, 'advisor.you'))}${line('advisor', soon, name, true)}`}
    </div>
    <div class="card sbx-compose" id="ask">
      <form method="post" action="/app/advisor" class="msgbar">
        <label class="muted" for="advisor-q">${esc(t(locale, 'advisor.label'))}</label>
        <textarea id="advisor-q" name="q" rows="2" dir="auto" maxlength="${ADVISOR_MAX}" required></textarea>
        <div class="msgacts"><button class="btn send" type="submit">${esc(t(locale, 'advisor.ask'))}</button></div>
      </form>
    </div>`;
}

/**
 * The advisor's two routes, and nothing else: the page, and a question asked on it. Both refuse anyone not
 * signed in. Neither reads or writes anything: the question comes back once, cut to the box's length.
 */
export function advisorRoutes(app: FastifyInstance, io: AdvisorIO): void {
  const draw = (req: FastifyRequest, reply: FastifyReply, asked: string | null) => {
    if (!io.signedIn(req)) return reply.redirect('/login');
    const locale = io.locale(req);
    return reply.type('text/html; charset=utf-8').send(io.page(req, {
      title: t(locale, 'nav.advisor'), active: 'advisor', bodyHtml: renderAdvisor(locale, asked),
    }));
  };
  // Quiet: the question is the owner's own words, and the request log would keep them.
  app.get('/app/advisor', { logLevel: 'warn' }, async (req, reply) => draw(req, reply, null));
  app.post('/app/advisor', { logLevel: 'warn' }, async (req, reply) => {
    const q = String((req.body as { q?: unknown } | undefined)?.q ?? '').trim().slice(0, ADVISOR_MAX);
    return draw(req, reply, q === '' ? null : q);
  });
}

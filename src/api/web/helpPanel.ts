import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Locale } from '../../core/owner/i18n/locale.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
import type { AdvisorModel } from '../../llm/ports.js';
import { t } from './say.js';
import { esc, deeper } from './layout.js';
import { BACK } from './icons.js';
import { flashBanner, type Flash } from './flash.js';
import { hasVideo } from './guide.js';
import { makeThrottle } from './throttle.js';
import { answerHelp, type HelpAnswer, type HelpTopic } from '../../advisor/help.js';
import type { AdvisorSpent } from '../../advisor/answer.js';
import { GUIDES, helpFor, guideTitle, guideDoor, guideLines, pageFrom, type GuideId } from './helpTopics.js';

/**
 * Block 6.1 — HELP THAT ANSWERS. The "?" on every owner page (the shell's `helpDoor`, layout.ts) is a door to
 * `/app/help/page?from=<the page>`: that page's two or three guides, a question box and "Still stuck? Write to us".
 * Without script it is a page of its own; with it, the app's one script lifts the page's `[data-card-body]` into the
 * sheet over the page (the profile card's way, liveScript.ts) — nothing new in the script.
 *
 *   · Who: anyone signed in reads the guides. The owner and team members ask and write; an accountant reads only
 *     (the advisor never answers an accountant, and the accountant's routes are the books').
 *   · Asking: the advisor's two calls over the help's guides (src/advisor/help.ts), the day's allowance asked first
 *     and what it used written on the workspace's ledger after — the advisor's own two ports. Nothing is kept.
 *   · Writing: the operator's mail (`write`), a few a workspace (in memory: three an hour, ten a day).
 *   · `from` is only ever read through `pageFrom` (a same-origin /app path); a value it refuses gives the general
 *     guides and no way back.
 */

export const HELP_MAX = 1000;

export type HelpViewer = { readonly businessId: string; readonly personId: string; readonly role: 'owner' | 'staff' | 'accountant' };

export type HelpIO = {
  readonly viewer: (req: FastifyRequest) => HelpViewer | null;
  readonly locale: (req: FastifyRequest) => Locale;
  readonly page: (req: FastifyRequest, o: { readonly title: string; readonly active: string; readonly bodyHtml: string }) => string;
  /** The model that words the advisor's answers; null: questions cannot be answered here. */
  readonly model: AdvisorModel | null;
  readonly allowanceUsed: (businessId: string) => Promise<boolean>;
  readonly spent: (businessId: string, spent: AdvisorSpent) => Promise<void>;
  /** The operator's mail; null: this installation has none. */
  readonly write: ((businessId: string, req: { words: string; page: string | null; personId: string; role: 'owner' | 'staff' }) => Promise<'sent' | 'skipped' | 'failed'>) | null;
  readonly flashTo: (reply: FastifyReply, path: string, key: MessageKey, params?: Record<string, string>) => FastifyReply;
  readonly takeFlash: (req: FastifyRequest, reply: FastifyReply) => Flash | null;
  /** For tests: the clock the limits read. */
  readonly now?: () => number;
};

/** The guides of a page, as the help question's topics: their English lines are the only facts it may use. */
export const topicsFor = (path: string | null): HelpTopic[] => {
  const ids: GuideId[] = [...helpFor(path ?? '/app')];
  // The page's own guides first, then every other one, so a question about another page still finds its guide.
  for (const id of Object.keys(GUIDES) as GuideId[]) if (!ids.includes(id)) ids.push(id);
  return ids.map((id) => ({ id, title: t('en', guideTitle(id)), lines: guideLines(id).map((k) => t('en', k)) }));
};

// `from` has passed `pageFrom`: plain path characters only.
const helpHref = (from: string | null): string => `/app/help/page${from ? `?from=${from}` : ''}`;

function guideHtml(locale: Locale, id: GuideId): string {
  const g = GUIDES[id];
  const video = g.video && hasVideo(g.video, locale)
    ? `<details class="help-video"><summary dir="auto">${esc(t(locale, 'help.video'))}</summary><video controls preload="none" playsinline poster="/assets/guide/${g.video}.${locale}.jpg" src="/assets/guide/${g.video}.${locale}.webm"><track kind="captions" default srclang="${locale}" src="/assets/guide/${g.video}.${locale}.vtt"></video></details>`
    : '';
  return `<li class="help-guide" id="guide-${id}"><h2 dir="auto">${esc(t(locale, guideTitle(id)))}</h2>
    <ul>${guideLines(id).map((k) => `<li dir="auto">${esc(t(locale, k))}</li>`).join('')}</ul>${video}
    ${deeper(g.door, t(locale, guideDoor(id)))}</li>`;
}

function answerHtml(locale: Locale, a: HelpAnswer): string {
  switch (a.kind) {
    case 'answer': return `<p><bdi>${esc(a.text)}</bdi></p>`;
    case 'guide': return `<p dir="auto">${esc(t(locale, 'help.ask.fromGuide', { guide: t(locale, guideTitle(a.topic.id as GuideId)) }))}</p>
      <ul>${guideLines(a.topic.id as GuideId).map((k) => `<li dir="auto">${esc(t(locale, k))}</li>`).join('')}</ul>`;
    case 'notYet': return `<p dir="auto">${esc(t(locale, 'help.ask.notYet'))}</p>`;
    case 'unknown': return `<p dir="auto">${esc(t(locale, 'help.ask.unknown'))}</p>`;
    case 'failed': return `<p dir="auto">${esc(t(locale, 'help.ask.failed'))}</p>`;
  }
}

export type HelpView = {
  readonly from: string | null;
  readonly role: HelpViewer['role'];
  readonly canAsk: boolean;
  readonly canWrite: boolean;
  readonly asked?: { readonly question: string; readonly answer: string } | null;
  readonly refused?: MessageKey | null;
  readonly flash?: Flash | null;
};

/** The help page: also the card the shell's "?" lifts into its sheet (`data-card-body`). */
export function renderHelp(locale: Locale, v: HelpView): string {
  const asks = v.role !== 'accountant';
  const hidden = v.from ? `<input type="hidden" name="from" value="${esc(v.from)}">` : '';
  const ask = !asks ? '' : `<section class="help-ask" id="ask" aria-labelledby="help-ask-h">
      <h2 id="help-ask-h" dir="auto">${esc(t(locale, 'help.ask.title'))}</h2>
      ${v.asked ? `<div class="help-answer" role="status"><p class="help-you"><span class="muted">${esc(t(locale, 'help.ask.you'))}</span> <bdi>${esc(v.asked.question)}</bdi></p>${v.asked.answer}</div>` : ''}
      ${v.refused ? `<p class="fwarn" role="alert" dir="auto">${esc(t(locale, v.refused))}</p>` : ''}
      ${v.canAsk ? `<form method="post" action="/app/help/ask">${hidden}
        <label for="help-q" dir="auto">${esc(t(locale, 'help.ask.label'))}</label>
        <textarea id="help-q" name="q" rows="2" maxlength="${HELP_MAX}" dir="auto" required></textarea>
        <p class="hint" dir="auto">${esc(t(locale, 'help.ask.hint'))}</p>
        <button class="btn" type="submit">${esc(t(locale, 'help.ask.go'))}</button></form>`
        : `<p class="muted">${esc(t(locale, 'help.ask.unavailable'))}</p>`}
    </section>`;
  const write = !asks ? '' : `<section class="help-write" id="write" aria-labelledby="help-write-h">
      <h2 id="help-write-h" dir="auto">${esc(t(locale, 'help.write.title'))}</h2>
      <p dir="auto">${esc(t(locale, 'help.write.lede'))}</p>
      ${v.canWrite ? `<form method="post" action="/app/help/write">${hidden}
        <label for="help-w" dir="auto">${esc(t(locale, 'help.write.label'))}</label>
        <textarea id="help-w" name="words" rows="3" maxlength="${HELP_MAX}" dir="auto" required>${esc(v.asked?.question ?? '')}</textarea>
        <button class="btn" type="submit">${esc(t(locale, 'help.write.go'))}</button></form>`
        : `<p class="muted">${esc(t(locale, 'help.write.cannot'))}</p>`}
    </section>`;
  return `<article class="help" data-card-body aria-labelledby="pc-name">
    ${v.from ? `<a class="back pc-open" href="${esc(v.from)}">${BACK}${esc(t(locale, 'help.back'))}</a>` : ''}
    <h1 class="page" id="pc-name" dir="auto">${esc(t(locale, 'help.title'))}</h1>
    <p class="muted" dir="auto">${esc(t(locale, 'help.lede'))}</p>
    ${v.flash ? flashBanner(v.flash) : ''}
    <ol class="help-guides">${helpFor(v.from ?? '/app').map((id) => guideHtml(locale, id)).join('')}</ol>
    ${ask}${write}
  </article>`;
}

export function helpRoutes(app: FastifyInstance, io: HelpIO): void {
  const now = io.now ?? Date.now;
  // "Write to us": three an hour and ten a day per workspace. In memory: a deploy forgets it (listed for the owner).
  const hourly = makeThrottle({ max: 3, windowMs: 60 * 60 * 1000 });
  const daily = makeThrottle({ max: 10, windowMs: 24 * 60 * 60 * 1000 });

  const draw = (req: FastifyRequest, reply: FastifyReply, viewer: HelpViewer, from: string | null, extra: Partial<HelpView> = {}) => {
    const locale = io.locale(req);
    return reply.type('text/html; charset=utf-8').header('cache-control', 'no-store').send(io.page(req, {
      title: t(locale, 'help.title'), active: 'home',
      bodyHtml: renderHelp(locale, {
        from, role: viewer.role, canAsk: io.model !== null, canWrite: io.write !== null,
        flash: io.takeFlash(req, reply), ...extra,
      }),
    }));
  };
  const field = (req: FastifyRequest, name: string): string => {
    const v = (req.body as Record<string, unknown> | null | undefined)?.[name];
    return typeof v === 'string' ? v : '';
  };
  const queryFrom = (req: FastifyRequest): string | null => pageFrom((req.query as Record<string, unknown> | undefined)?.['from']);

  app.get('/app/help/page', async (req, reply) => {
    const viewer = io.viewer(req);
    if (!viewer) return reply.redirect('/login');
    return draw(req, reply, viewer, queryFrom(req));
  });

  app.post('/app/help/ask', async (req, reply) => {
    const viewer = io.viewer(req);
    if (!viewer) return reply.redirect('/login');
    const from = pageFrom(field(req, 'from'));
    if (viewer.role === 'accountant') return reply.redirect(helpHref(from));
    const locale = io.locale(req);
    const question = field(req, 'q').trim();
    if (question === '') return draw(req, reply, viewer, from, { refused: 'help.ask.empty' });
    if (question.length > HELP_MAX) return draw(req, reply, viewer, from, { refused: 'help.ask.tooLong' });
    if (!io.model) return draw(req, reply, viewer, from, { refused: 'help.ask.unavailable' });
    if (await io.allowanceUsed(viewer.businessId).catch(() => true)) {
      return draw(req, reply, viewer, from, { refused: 'help.ask.allowance' });
    }
    const r = await answerHelp(io.model, question, topicsFor(from), locale);
    await io.spent(viewer.businessId, r.spent);
    // The question is the owner's own words: nothing here logs it.
    return draw(req, reply, viewer, from, { asked: { question, answer: answerHtml(locale, r.answer) } });
  });

  app.post('/app/help/write', async (req, reply) => {
    const viewer = io.viewer(req);
    if (!viewer) return reply.redirect('/login');
    const from = pageFrom(field(req, 'from'));
    const to = helpHref(from);
    if (viewer.role === 'accountant') return reply.redirect(to);
    const words = field(req, 'words').trim();
    if (words === '') return io.flashTo(reply, `${to}#write`, 'help.write.empty');
    if (!io.write) return io.flashTo(reply, `${to}#write`, 'help.write.cannot');
    const at = now();
    if (daily.spent(viewer.businessId, at) || !hourly.allow(viewer.businessId, at)) return io.flashTo(reply, `${to}#write`, 'help.write.limit');
    daily.allow(viewer.businessId, at);
    const r = await io.write(viewer.businessId, { words: words.slice(0, HELP_MAX), page: from, personId: viewer.personId, role: viewer.role })
      .catch(() => 'failed' as const);
    return io.flashTo(reply, `${to}#write`, r === 'sent' ? 'help.write.sent' : r === 'skipped' ? 'help.write.cannot' : 'help.write.failed');
  });
}

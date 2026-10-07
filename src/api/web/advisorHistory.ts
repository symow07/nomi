import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Locale } from '../../core/owner/i18n/locale.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
import { csvFile, csvFilename } from '../../core/owner/csv.js';
import type { AdvisorMemory, MemoryState } from '../../advisor/memory.js';
import { t } from './say.js';
import { esc, deeper } from './layout.js';
import { icon } from './icons.js';
import { flashBanner, type Flash } from './flash.js';
import * as show from './values.js';

/**
 * SETTINGS → THE ADVISOR'S HISTORY, a door of Your data too (0130; docs/ADVISOR-MEMORY.md §3, §5, D1, D2, D4, D6).
 *
 *   · Everyone: their own switch (the opt-in sentence, word for word), what it is now, and their own
 *     download (D4). Turning it off asks once, with what it means, then deletes at once (§5a). After a
 *     second "Not now" on the advisor's card, this is the only way to turn it on (D6).
 *   · The owner, besides: the workspace's switch (D1; off deletes everyone's), and the team — a control per
 *     person to delete their history WITHOUT reading it (D2), there for everyone on the team whether or not
 *     they kept anything, its result the same either way, so it never tells the owner who said yes.
 *   · Nothing here reads anyone's words but the viewer's own download. The port (src/advisor/memory.ts) is the
 *     only way in; every call names the workspace and the person.
 */

export type HistoryViewer = { readonly businessId: string; readonly personId: string; readonly isOwner: boolean };

export type AdvisorHistoryIO = {
  readonly viewer: (req: FastifyRequest) => HistoryViewer | null;
  readonly locale: (req: FastifyRequest) => Locale;
  readonly page: (req: FastifyRequest, o: { readonly title: string; readonly active: string; readonly bodyHtml: string }) => string;
  readonly memory: AdvisorMemory | null;
  /** The provider that words the answers, as the privacy page names it. */
  readonly processor: (locale: Locale) => string;
  readonly flashTo: (reply: FastifyReply, path: string, key: MessageKey, params?: Record<string, string>) => FastifyReply;
  readonly takeFlash: (req: FastifyRequest, reply: FastifyReply) => Flash | null;
  /** The CSV dialect the reader's spreadsheet expects. */
  readonly dialect: (locale: Locale) => Parameters<typeof csvFile>[2];
};

export const HISTORY_PAGE = '/app/settings/advisor-history';
export const HISTORY_FILE = '/app/settings/advisor-history/history.csv';

export type HistoryPage = {
  readonly state: MemoryState;
  readonly isOwner: boolean;
  readonly team: readonly { readonly id: string; readonly name: string }[];
  readonly processor: string;
};

/** The page. */
export function renderAdvisorHistory(locale: Locale, v: HistoryPage, flash: Flash | null): string {
  const s = v.state;
  const say = (k: MessageKey, p: Record<string, string> = {}) => esc(t(locale, k, p));
  const button = (action: string, name: string, value: string, label: string, confirm?: string) =>
    `<form method="post" action="${action}" class="inline"><button class="btn" type="submit" name="${name}" value="${value}"${confirm
      ? ` onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(confirm)}"` : ''}>${esc(label)}</button></form>`;

  const why = s.keyProblem ? `<p class="muted">${say('advisor.history.keyMissing')}</p>`
    : !s.person ? `<p class="muted">${say('advisor.history.noPerson')}</p>`
    : !s.workspaceOn && !v.isOwner ? `<p class="muted">${say('advisor.history.workspaceWaits')} ${say('staff.ownerDecides')}</p>` : '';
  const mineState = s.keep && s.since ? say('advisor.memory.on', { date: show.date(locale, s.since) }) : say('advisor.memory.offState');
  const mineAct = s.keep
    ? button(`${HISTORY_PAGE}/me`, 'on', 'off', t(locale, 'advisor.history.turnOff'), t(locale, 'advisor.memory.confirm', { processor: v.processor }))
    : s.workspaceOn && s.person && !s.keyProblem ? button(`${HISTORY_PAGE}/me`, 'on', 'on', t(locale, 'advisor.history.turnOn')) : '';
  const mine = `<section class="block" id="mine">
      <h2>${say('advisor.history.mine')}</h2>
      <p>${say('advisor.memory.ask')}</p>
      <p class="muted">${mineState}</p>
      ${why}
      ${mineAct}
      ${s.person ? `<ul class="scard dl-files"><li class="row">
        <span>${say('advisor.history.mine')}</span>
        <a class="dl-get" href="${HISTORY_FILE}" download>${icon('download')}<span>${say('advisor.memory.download')}</span></a>
      </li></ul>` : ''}
      <div class="doors">${deeper('/app/advisor', t(locale, 'advisor.history.open'))}</div>
    </section>`;
  if (!v.isOwner) return `<h1 class="page">${say('advisor.history.title')}</h1>${flashBanner(flash)}${mine}`;

  const workspace = `<section class="block" id="workspace">
      <h2>${say('advisor.history.workspace')}</h2>
      <p class="muted">${say('advisor.history.workspaceHelp')}</p>
      <p class="muted">${say(s.workspaceOn ? 'advisor.flash.workspaceOn' : 'advisor.history.workspaceWaits')}</p>
      ${s.workspaceOn
        ? button(`${HISTORY_PAGE}/workspace`, 'on', 'off', t(locale, 'advisor.history.turnOff'), t(locale, 'advisor.history.workspaceConfirm'))
        : button(`${HISTORY_PAGE}/workspace`, 'on', 'on', t(locale, 'advisor.history.turnOn'))}
    </section>`;
  const team = `<section class="block" id="team">
      <h2>${say('advisor.history.team')}</h2>
      <p class="muted">${say('advisor.history.teamHelp')}</p>
      ${v.team.length === 0 ? `<p class="muted">${say('advisor.history.noTeam')}</p>` : `<ul class="rows">${v.team.map((p) => `<li class="row">
        <span class="grow"><bdi>${esc(p.name)}</bdi></span>
        ${button(`${HISTORY_PAGE}/team/${esc(p.id)}/delete`, 'go', '1', t(locale, 'advisor.memory.ownerDelete', { name: p.name }),
          t(locale, 'advisor.memory.ownerDeleteConfirm', { name: p.name }))}
      </li>`).join('')}</ul>`}
    </section>`;
  return `<h1 class="page">${say('advisor.history.title')}</h1>${flashBanner(flash)}${workspace}${mine}${team}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The page, its switches, the owner's delete-without-reading, and each person's own download. Quiet routes. */
export function advisorHistoryRoutes(app: FastifyInstance, io: AdvisorHistoryIO): void {
  const OFF: MemoryState = { workspaceOn: false, consent: null, since: null, keep: false, ask: false, keyProblem: null, person: false };
  const stateOf = (v: HistoryViewer) => (io.memory ? io.memory.state(v.businessId, v.personId, new Date()).catch(() => OFF) : Promise.resolve(OFF));

  app.get(HISTORY_PAGE, { logLevel: 'warn' }, async (req, reply) => {
    const v = io.viewer(req);
    if (!v) return reply.redirect('/login');
    const locale = io.locale(req);
    const state = await stateOf(v);
    const team = v.isOwner && io.memory ? await io.memory.team(v.businessId, v.personId).catch(() => []) : [];
    return reply.type('text/html; charset=utf-8').send(io.page(req, {
      title: t(locale, 'advisor.history.title'), active: 'settings',
      bodyHtml: renderAdvisorHistory(locale, { state, isOwner: v.isOwner, team, processor: io.processor(locale) }, io.takeFlash(req, reply)),
    }));
  });

  // Their own switch: on is their yes (only where the workspace allows it); off takes it back and deletes at once.
  app.post(`${HISTORY_PAGE}/me`, { logLevel: 'warn' }, async (req, reply) => {
    const v = io.viewer(req);
    if (!v) return reply.redirect('/login');
    if (!io.memory) return io.flashTo(reply, HISTORY_PAGE, 'advisor.flash.failed');
    const on = String((req.body as { on?: unknown } | undefined)?.on ?? '') === 'on';
    const state = await stateOf(v);
    if (on && (!state.workspaceOn || !state.person || state.keyProblem)) return io.flashTo(reply, HISTORY_PAGE, 'advisor.flash.failed');
    if (!on && !state.keep) return reply.redirect(HISTORY_PAGE);
    const r = await io.memory.consent(v.businessId, v.personId, on ? 'granted' : 'withdrawn', io.locale(req));
    return io.flashTo(reply, HISTORY_PAGE, r !== 'ok' ? 'advisor.flash.failed' : on ? 'advisor.flash.on' : 'advisor.flash.deleted');
  });

  // D1 — the workspace's switch, the owner's alone (the database refuses anyone else: NE022). Off deletes everyone's.
  app.post(`${HISTORY_PAGE}/workspace`, { logLevel: 'warn' }, async (req, reply) => {
    const v = io.viewer(req);
    if (!v) return reply.redirect('/login');
    if (!v.isOwner || !io.memory) return io.flashTo(reply, HISTORY_PAGE, 'advisor.flash.failed');
    const on = String((req.body as { on?: unknown } | undefined)?.on ?? '') === 'on';
    const r = await io.memory.workspace(v.businessId, v.personId, on);
    return io.flashTo(reply, HISTORY_PAGE, r !== 'ok' ? 'advisor.flash.failed' : on ? 'advisor.flash.workspaceOn' : 'advisor.flash.workspaceOff');
  });

  // D2 — a team member's history, deleted whole and unread, by the owner. The notice reads the same whether
  // or not anything was kept: it never says who said yes.
  app.post(`${HISTORY_PAGE}/team/:id/delete`, { logLevel: 'warn' }, async (req, reply) => {
    const v = io.viewer(req);
    if (!v) return reply.redirect('/login');
    const id = (req.params as { id: string }).id;
    if (!v.isOwner || !io.memory || !UUID.test(id) || id === v.personId) return io.flashTo(reply, HISTORY_PAGE, 'advisor.flash.failed');
    const member = (await io.memory.team(v.businessId, v.personId).catch(() => [])).find((p) => p.id === id);
    if (!member) return io.flashTo(reply, HISTORY_PAGE, 'advisor.flash.failed');
    const r = await io.memory.forget(v.businessId, v.personId, id, null);
    return io.flashTo(reply, `${HISTORY_PAGE}#team`, r === 'ok' ? 'advisor.flash.ownerDeleted' : 'advisor.flash.failed', { name: member.name });
  });

  // D4 — their own history, and no one else's: the person is the transaction's, and row security answers.
  app.get(HISTORY_FILE, { logLevel: 'warn' }, async (req, reply) => {
    const v = io.viewer(req);
    if (!v) return reply.redirect('/login');
    const locale = io.locale(req);
    const rows = io.memory ? await io.memory.exportOwn(v.businessId, v.personId, locale) : [];
    const header = ['advisor.export.conversation', 'advisor.export.started', 'advisor.export.asked', 'advisor.export.question', 'advisor.export.answer']
      .map((k) => t(locale, k as MessageKey));
    return reply
      .type('text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${csvFilename('advisor-history', new Date())}"`)
      .header('cache-control', 'no-store')
      .send(csvFile(header, rows, io.dialect(locale)));
  });
}

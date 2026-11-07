import { esc, deeper } from './layout.js';
import { t } from './say.js';
import * as show from './values.js';
import { flashBanner, type Flash } from './flash.js';
import type { Locale } from '../../core/owner/i18n/locale.js';
import type { MessageKey } from '../../core/owner/i18n/messages.js';
import type { CaseCheck } from '../../db/cases.js';

/**
 * THE CHECKS, ON THE PAGE (Block 3 PR 3; 0230) — `/app/assistant/knowledge/checks`: every check, newest first, its
 * change in words, how many cases ran and how many changed; one check's page: each case — the customer's words (read
 * now; "erased" when gone), the accepted answer, the reply with the change, the figures beside each — then Keep or
 * Revert for the owner while it waits. A running check's page refreshes itself (a plain meta refresh; no script).
 */
const BASE = '/app/assistant/knowledge/checks';
const text = (locale: Locale, k: MessageKey, p?: Record<string, string | number>) => esc(t(locale, k, p));

export function renderChecksPage(locale: Locale, checks: readonly CaseCheck[], flash: Flash | null): string {
  const rows = checks.length === 0 ? `<p class="muted">${text(locale, 'cases.none')}</p>` : `<ul class="scard kmenu">${checks.map((c) => {
    const changed = c.results.filter((r) => r.changed).length;
    return `<li><a class="srow sr-menu sr-two" href="${BASE}/${esc(c.id)}"><span class="sr-main"><span class="sr-label">${text(locale, `cases.kind.${c.kind}` as MessageKey)} · <bdi>${esc(c.summary)}</bdi></span>
      <span class="sr-desc">${text(locale, `cases.status.${c.status}` as MessageKey)} · ${esc(show.when(locale, c.createdAt, new Date()))}${c.status === 'running' ? '' : ` · ${text(locale, 'cases.cases', { n: c.results.length })} · ${changed ? text(locale, 'cases.changed', { n: changed }) : text(locale, 'cases.unchanged')}`}</span></span></a></li>`;
  }).join('')}</ul>`;
  return `<div class="assistant-knowledge"><h1 class="page">${text(locale, 'cases.title')}</h1>${flashBanner(flash)}<p class="muted">${text(locale, 'cases.lede')}</p>
    <p>${deeper('/app/assistant/knowledge', t(locale, 'nav.knowledge'))}</p>${rows}</div>`;
}

export function renderCheckPage(locale: Locale, owner: boolean, c: CaseCheck, texts: ReadonlyMap<string, { question: string; accepted: string } | null>, flash: Flash | null): string {
  const changed = c.results.filter((r) => r.changed).length;
  const head = `<p class="caption">${text(locale, `cases.kind.${c.kind}` as MessageKey)}</p><h1 class="page"><bdi>${esc(c.summary)}</bdi></h1>${flashBanner(flash)}
    <p class="muted">${text(locale, `cases.status.${c.status}` as MessageKey)}${c.status === 'running' ? '' : ` · ${text(locale, 'cases.cases', { n: c.results.length })} · ${changed ? text(locale, 'cases.changed', { n: changed }) : text(locale, 'cases.unchanged')}`}</p>
    ${c.stoppedByAllowance ? `<p class="muted">${text(locale, 'cases.allowance', { n: c.results.length })}</p>` : ''}`;
  if (c.status === 'running') return `<div class="assistant-knowledge">${head}<p role="status">${text(locale, 'cases.running')}</p><p>${deeper(BASE, t(locale, 'cases.back'))}</p></div>`;
  const cases = c.results.length === 0 ? '' : `<ul class="rows">${c.results.map((r) => {
    const tx = texts.get(`${r.ref.kind}:${r.ref.id}`) ?? null;
    return `<li class="row block"><p><b>${text(locale, 'cases.case.question')}</b> <bdi>${tx ? esc(tx.question) : text(locale, 'cases.case.erased')}</bdi>${r.touching ? '' : ` <span class="muted">· ${text(locale, 'cases.case.unrelated')}</span>`}</p>
      <p><b>${text(locale, 'cases.case.accepted')}</b> <bdi>${tx ? esc(tx.accepted) : text(locale, 'cases.case.erased')}</bdi>${r.figuresAccepted.length ? ` <span class="muted">(${esc(r.figuresAccepted.join(' · '))})</span>` : ''}</p>
      <p><b>${text(locale, 'cases.case.reply')}</b> ${r.reply === null ? `<span class="muted">${text(locale, 'cases.case.silent')}</span>` : `<bdi>${esc(r.reply)}</bdi>`}${r.figuresReply.length ? ` <span class="muted">(${esc(r.figuresReply.join(' · '))})</span>` : ''}</p>
      <p class="${r.changed ? 'stateline' : 'muted'}">${text(locale, r.changed ? 'cases.case.changed' : 'cases.case.same')}</p></li>`;
  }).join('')}</ul>`;
  const decide = owner && c.status === 'done' ? `<div class="pform"><form method="post" action="${BASE}/${esc(c.id)}/keep" class="inline"><button class="btn send" type="submit">${text(locale, 'cases.keep')}</button></form>
    <form method="post" action="${BASE}/${esc(c.id)}/revert" class="inline"><button class="btn ghost" type="submit" onclick="return confirm(this.dataset.confirm)" data-confirm="${text(locale, 'cases.revertAsk')}">${text(locale, 'cases.revert')}</button></form></div>` : '';
  return `<div class="assistant-knowledge">${head}${decide}${cases}<p>${deeper(BASE, t(locale, 'cases.back'))}</p></div>`;
}

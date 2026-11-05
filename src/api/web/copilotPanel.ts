import type { Locale } from '../../core/owner/i18n/locale.js';
import { markSmall } from '../../core/owner/brand.js';
import type { CopilotPanelView } from './conversationAdvisor.js';
import { esc, conversationUrl } from './layout.js';
import { t } from './say.js';

/** One optional pane shared by customer facts and contextual questions. */
export function renderConversationTools(customer: string, conversationId: string, locale: Locale): string {
  const href = `/app/inbox/${encodeURIComponent(conversationId)}/copilot`;
  return `<aside class="conversation-tools" id="conversation-tools" data-conversation-tools data-copilot-url="${href}" aria-label="${esc(t(locale, 'inbox.tools.label'))}">
    <header class="ct-head"><a href="#latest" data-close-tool>${esc(t(locale, 'inbox.tools.close'))}</a>
      <nav class="ct-tabs" aria-label="${esc(t(locale, 'inbox.tools.label'))}">
        <a href="#customer" data-tool-tab="customer">${esc(t(locale, 'inbox.tools.customer'))}</a>
        <a href="${href}" data-tool-tab="ask">${markSmall(16, null)}${esc(t(locale, 'inbox.tools.ask'))}</a>
      </nav>
    </header>
    <div data-tool-content="customer">${customer}</div>
    <div data-tool-content="ask" hidden><div data-copilot-slot><p class="muted" role="status">${esc(t(locale, 'inbox.tools.loading'))}</p></div></div>
    <p class="ct-status" data-tool-status role="status" aria-live="polite"
      data-loading="${esc(t(locale, 'inbox.tools.loading'))}" data-busy="${esc(t(locale, 'inbox.tools.busy'))}"
      data-failed="${esc(t(locale, 'inbox.tools.failed'))}" data-stale="${esc(t(locale, 'inbox.tools.stale'))}"
      data-no-composer="${esc(t(locale, 'inbox.tools.noComposer'))}" data-used="${esc(t(locale, 'inbox.tools.used'))}"></p>
  </aside>`;
}

/** Server sources are links into this workspace only, never model-supplied external destinations. */
function sourceHref(href: string): string | null {
  return /^\/app\/(?!\/)[^\s<>"\\]*$/.test(href) ? href : null;
}

export function renderCopilotPanel(locale: Locale, view: CopilotPanelView): string {
  const base = `/app/inbox/${encodeURIComponent(view.conversationId)}/copilot`;
  const disabled = view.allowance !== 'available';
  const prompts = [
    ['last_order', 'inbox.tools.lastOrder'], ['summarise_chat', 'inbox.tools.summary'], ['draft_reply', 'inbox.tools.draft'],
  ] as const;
  const fact = (f: NonNullable<CopilotPanelView['answer']>['facts'][number], i: number): string => {
    const links = f.sources.flatMap((s) => {
      const href = s.href === `${base}#copilot-question` ? '#copilot-question' : sourceHref(s.href);
      return href ? [`<a href="${esc(href)}">${esc(s.label)}</a>`] : [];
    });
    return `<details class="cp-fact" id="cp-fact-${i}"><summary>${esc(f.label)} <bdi>${esc(f.value)}</bdi></summary>
      ${f.calculation ? `<p dir="auto">${esc(f.calculation)}</p>` : ''}
      ${links.length ? `<ul>${links.map((s) => `<li>${s}</li>`).join('')}</ul>` : `<p>${esc(t(locale, 'inbox.tools.unsupported'))}</p>`}</details>`;
  };
  const reply = view.answer?.reply;
  return `<section class="copilot-panel" data-copilot-panel data-conversation-id="${esc(view.conversationId)}" data-revision="${esc(view.revision)}" aria-labelledby="copilot-title">
    <a class="cp-back" href="${conversationUrl(view.conversationId)}">${esc(t(locale, 'inbox.tools.close'))}</a>
    <header class="cp-head"><h2 id="copilot-title" tabindex="-1">${markSmall(24, null)} ${esc(t(locale, 'inbox.tools.ask'))}</h2>
      <p>${esc(t(locale, 'inbox.tools.context', { customer: '\u0000' })).replace('\u0000', `<bdi>${esc(view.customerName ?? t(locale, 'common.buyer'))}</bdi>`)}</p>
    </header>
    <p class="cp-intro">${esc(t(locale, 'inbox.tools.intro'))}</p>
    <p class="cp-allowance" role="status">${esc(t(locale, `inbox.tools.allowance.${view.allowance}`))}</p>
    <div class="cp-prompts">${prompts.map(([intent, key]) => `<form method="post" action="${base}" data-copilot-ask><input type="hidden" name="intent" value="${intent}" /><input type="hidden" name="q" value="${esc(t(locale, key))}" /><button class="btn ghost" type="submit"${disabled ? ' disabled' : ''}>${esc(t(locale, key))}</button></form>`).join('')}</div>
    <form method="post" action="${base}" class="cp-question" data-copilot-ask>
      <label for="copilot-question">${esc(t(locale, 'inbox.tools.question'))}</label>
      <textarea id="copilot-question" name="q" maxlength="1000" rows="3" required dir="auto" placeholder="${esc(t(locale, 'inbox.tools.placeholder'))}"${disabled ? ' disabled' : ''}>${esc(view.asked)}</textarea>
      <button class="btn" type="submit"${disabled ? ' disabled' : ''}>${esc(t(locale, 'inbox.tools.submit'))}</button>
    </form>
    ${view.answer ? `<section class="cp-answer" aria-label="${esc(t(locale, 'inbox.tools.answer'))}"><div class="cp-attribution">${markSmall(16, null)}<span>${esc(t(locale, 'inbox.tools.ask'))}</span></div><p dir="auto">${esc(view.answer.text)}</p></section>
      ${view.answer.facts.length ? `<section class="cp-sources"><h3>${esc(t(locale, 'inbox.tools.sources'))}</h3>${view.answer.facts.map(fact).join('')}</section>` : ''}` : ''}
    ${reply ? `<section class="cp-suggestion"><h3>${esc(t(locale, 'inbox.tools.suggestion'))}</h3><blockquote dir="auto">${esc(reply.text)}</blockquote>
      <p>${esc(t(locale, 'inbox.tools.useHint'))}</p><form method="post" action="${base}/reply" data-copilot-use>
        <input type="hidden" name="q" value="${esc(view.asked)}" /><input type="hidden" name="intent" value="draft_reply" />
        <input type="hidden" name="revision" value="${esc(reply.revision)}" />
        <button class="btn" type="submit" data-use-reply hidden>${esc(t(locale, 'inbox.tools.use'))}</button>
      </form><noscript><p>${esc(t(locale, 'inbox.tools.copyHint'))}</p></noscript></section>` : ''}
    <footer class="cp-history">${view.history.threadHref && sourceHref(view.history.threadHref) ? `<a href="${esc(view.history.threadHref)}">${esc(t(locale, 'inbox.tools.history'))}</a>` : ''}
      ${view.history.consent ? `<section class="cp-consent"><h3>${esc(t(locale, 'advisor.memory.title'))}</h3><p>${esc(t(locale, 'advisor.memory.ask'))}</p><p>${esc(t(locale, 'advisor.memory.what', { processor: view.history.processor }))} ${esc(t(locale, 'advisor.memory.off'))}</p><form method="post" action="/app/advisor/consent"><button class="btn" type="submit" name="choice" value="allow">${esc(t(locale, 'advisor.memory.allow'))}</button><button class="btn ghost" type="submit" name="choice" value="notnow">${esc(t(locale, 'advisor.memory.notNow'))}</button></form><a href="/privacy#advisor">${esc(t(locale, 'advisor.memory.more'))}</a></section>` : ''}
      ${view.history.keeping ? '' : `<p>${esc(t(locale, 'inbox.tools.noHistory'))}</p>`}
      ${view.history.processor ? `<p>${esc(view.history.processor)}</p>` : ''}</footer>
  </section>`;
}

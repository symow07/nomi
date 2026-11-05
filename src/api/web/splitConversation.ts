import type { Locale } from '../../core/owner/i18n/locale.js';
import { countryName } from '../../core/owner/i18n/messages.js';
import type { Viewer } from '../../core/conversation/people.js';
import { markSmall } from '../../core/owner/brand.js';
import type { StageFacts } from '../../db/customerStage.js';
import { esc, back, LIVE_SLOT } from './layout.js';
import { t, assistantName } from './say.js';
import { face } from './faces.js';
import { approvalChecks, channelName, conversationParts, productName, replyRows, type ConversationDetail } from './inbox.js';
import { whole } from './splitToday.js';
import type { Flash } from './flash.js';
import * as show from './values.js';

/**
 * A CONVERSATION, IN THE SPLIT LOOK (the owner, 2026-11-05; docs/DESIGN-SYSTEM.md). Behind `SPLIT_TODAY=on`, with Today and
 * the Inbox. Their serif head on the wash, with the customer's face, name, product, stage and value; the messages as a chat,
 * the customer at the start of the line and ours at its end, so Arabic mirrors it; the reply waiting in a box with Send,
 * Edit and Hand to me, and where each figure in it came from, open and large enough to read.
 *
 * Only the arrangement is this file's. Every message, card and act comes from `conversationParts`, and every check on the
 * draft from `approvalChecks`, the same as the plain page's; Send posts to the same approval path.
 */

function draftCard(d: ConversationDetail, locale: Locale, now: Date): string {
  const p = d.pendingDraft;
  if (!p) return '';
  const cid = encodeURIComponent(d.conversationId);
  const to = { act: `/app/inbox/${cid}/act`, handTo: `/app/inbox/${cid}/takeover`, translate: `/app/inbox/${cid}/translate` };
  const name = assistantName(locale);
  const channel = d.channel ? channelName(locale, d.channel) : null;
  const { closing, state, foreign, how, window } = approvalChecks(d, p, locale, now, to, { readingOpen: true });
  return `<section class="sp-card sc-draft" id="approve" aria-labelledby="approve-h">
    <h2 id="approve-h" class="sr">${esc(t(locale, 'buyers.review.title', { name }))}</h2>
    <p class="sp-from">${esc(t(locale, 'card.drafted', { name }))}${channel ? ` · ${esc(t(locale, 'card.goes', { channel }))}` : ''}</p>
    ${closing}${state}${foreign}
    <form method="post" action="${esc(to.act)}" class="sp-form">
      <input type="hidden" name="draftId" value="${esc(p.draftId)}" />
      <label for="reply" class="sr">${esc(t(locale, 'card.reply'))}</label>
      ${p.ownerEdit ? `<p class="muted" role="note">${esc(t(locale, 'inbox.edit.kept'))}</p>` : ''}
      <textarea id="reply" class="sp-reply" name="edit" rows="${replyRows(p.ownerEdit ?? p.draftText)}" dir="auto" data-keep="${esc(`${d.conversationId}:edit`)}">${esc(p.ownerEdit ?? p.draftText)}</textarea>
      <div class="sp-acts">
        <button class="sp-btn sp-send" type="submit" name="command" value="send">${esc(t(locale, 'inbox.action.send'))}</button>
        <label class="sp-btn" for="reply">${esc(t(locale, 'split.edit'))}</label>
        <button class="sp-btn" type="submit" formaction="${esc(to.handTo)}">${esc(t(locale, 'card.handToMe'))}</button>
      </div>
      <div class="sc-after">
        <button class="sp-btn sc-noreply" type="submit" name="command" value="不回"
          onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(t(locale, 'card.noReply.confirm'))}">${esc(t(locale, 'card.noReply'))}</button>
        ${window ? `<p class="sp-window">${window}</p>` : ''}
      </div>
    </form>
    ${how}
  </section>`;
}

export function renderSplitConversation(
  d: ConversationDetail, facts: StageFacts | null, panel: string, locale: Locale, now: Date, flash: Flash | null, viewer: Viewer,
): string {
  const part = conversationParts(d, locale, now, flash, viewer, { draftCard: draftCard(d, locale, now), replySend: 'sp-btn sp-send' });
  const who = d.buyer ?? t(locale, 'common.buyer');
  const stage = facts?.stage ?? 'asked';
  const country = countryName(locale, d.country);
  const product = productName(locale, d.product);
  const thumb = facts?.thumb
    ? `<img class="sp-thumb" src="${esc(facts.thumb)}" alt="${esc(facts.product ?? product ?? '')}" width="36" height="36" loading="lazy" decoding="async">` : '';
  return `<div class="sp sc">
    <header class="sp-head sc-head">
      <div class="sc-top">${back('/app/inbox', t(locale, 'inbox.detail.back'))}${LIVE_SLOT}<span class="sp-headmark">${markSmall(32, null)}</span></div>
      <div class="sc-who">
        ${part.catchUp.face || face({ clientId: d.conversationId, name: d.buyer }, 'l')}
        <div class="sc-whot">
          <h1 class="page"><bdi>${esc(who)}</bdi></h1>
          <p class="sc-deal">${thumb}<span class="sp-chip${stage === 'order' ? ' is-order' : ''}">${esc(t(locale, `split.stage.${stage}`))}</span>${
            facts?.value ? `<span class="sc-value">${esc(whole(show.money(locale, facts.value)))}</span>` : ''}</p>
        </div>
      </div>
      <div class="sc-story">${country ? `<p class="cu-where">${esc(country)}</p>` : ''}${part.catchUp.where}${part.catchUp.facts}${part.catchUp.state}</div>
    </header>
    <div class="sc-body">
      <div class="sc-main">
        <section class="sc-chat" aria-labelledby="sc-log">
          <h2 id="sc-log" class="sr">${esc(t(locale, 'inbox.detail.log'))}</h2>
          ${part.earlierDoor}
          ${part.timeline}
          ${part.latestDoor}
        </section>
        ${part.flashHtml}
        ${part.acts}
        <div class="sc-more">
          ${part.answeredBy}
          ${part.about}
          ${part.control}
          ${part.doors}
          ${part.testing}
        </div>
      </div>
      ${panel ? `<div class="sc-aside">${panel}</div>` : ''}
    </div>
  </div>`;
}

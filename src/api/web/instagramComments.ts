import type { InstagramComment } from '../../db/instagramComments.js';
import type { Locale } from '../../core/owner/i18n/locale.js';
import { esc, back } from './layout.js';
import { t } from './say.js';
import { t as catalogue, type MessageKey } from '../../core/owner/i18n/messages.js';
import * as show from './values.js';
import { suggestCommentReply } from '../../core/channel/commentSuggestion.js';
import { COMMENT_REPLY_MAX } from '../../db/commentReplyQueue.js';
export type CommentPage = {comments:readonly InstagramComment[];enabled:boolean;configured:boolean;connected:boolean;owner:boolean;now:Date;deleting?:InstagramComment|null};
const ROOT='/app/channels/instagram/comments';
/**
 * A sentence this page's language has no words for yet is the English one (the catalogue's fallback): it is set apart
 * as English, left to right, so on an Arabic page its colon and full stop stay on its own side ("Hours left to reply: 163").
 * Its figures are already isolated by `t` through values.ts. Text only: never inside an attribute.
 */
export function sayOnPage(locale:Locale,key:MessageKey,params?:Record<string,string|number>):string {
  const words=esc(t(locale,key,params));
  return locale!=='en'&&catalogue(locale,key)===catalogue('en',key)?`<bdi lang="en" dir="ltr">${words}</bdi>`:words;
}
export function renderInstagramComments(locale:Locale,data:CommentPage):string {
  const word=(key:MessageKey)=>sayOnPage(locale,key);
  const title=`${back('/app/settings/channels/meta',t(locale,'nav.channels'))}<h1>${word('igComments.title')}</h1>`;
  if(data.deleting&&data.owner)return `${title}<h2>${word('igComments.delete')}</h2><p>${word('igComments.deleteHelp')}</p>
    <blockquote><bdi dir="auto">${esc(data.deleting.words)}</bdi></blockquote>
    <form method="post" action="${ROOT}/${encodeURIComponent(data.deleting.id)}/delete"><button class="btn send" type="submit" name="confirm" value="delete" onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(t(locale,'igComments.deleteHelp'))}">${word('igComments.delete')}</button></form>
    <p><a class="deeper" href="${ROOT}">${word('igComments.cancel')}</a></p>`;
  const control=!data.owner?'':!data.connected?`<p>${word('igComments.connect')}</p>`:!data.configured&&!data.enabled?`<p>${word('igComments.unavailable')}</p>`:
    `<form method="post" action="${ROOT}/switch"><button class="btn" type="submit" name="on" value="${data.enabled?'0':'1'}">${word(data.enabled?'igComments.disable':'igComments.enable')}</button></form>`;
  const rows=data.comments.map(c=>{
    const left=c.created_at?c.created_at.getTime()+7*86400000-data.now.getTime():null;
    const age=left===null||c.created_at!.getTime()>data.now.getTime()?word('igComments.ageUnknown'):left<=0?word('igComments.expired'):
      sayOnPage(locale,'igComments.hours',{hours:show.count(locale,Math.ceil(left/3600000))});
    const href=c.post_url&&/^https:\/\/(www\.)?instagram\.com\//.test(c.post_url)?c.post_url:null;
    return `<article class="card" id="comment-${esc(c.id)}"><h2>${c.username?`<bdi dir="auto">${esc(`@${c.username}`)}</bdi>`:word('igComments.person')}</h2>
      <blockquote><bdi dir="auto">${esc(c.words)}</bdi></blockquote>
      <p>${c.match_state==='matched'&&c.product_name?`<bdi dir="auto">${esc(c.product_name)}</bdi>`:word('igComments.noProduct')}</p>
      <p class="muted">${age}</p>${replyArea(locale,data,c,left!==null&&left>0&&c.created_at!.getTime()<=data.now.getTime())}<p>${href?`<a class="deeper" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${word('igComments.post')}</a>`:word('igComments.noPost')}</p>
      ${data.owner?`<p><a class="deeper" href="${ROOT}/${encodeURIComponent(c.id)}/delete">${word('igComments.delete')}</a></p>`:''}</article>`;
  }).join('');
  return `${title}<p>${word('igComments.intro')}</p><section class="card"><h2>${word('igComments.switch')}</h2><p>${word(data.enabled?'igComments.on':'igComments.off')}</p>${control}<p class="muted">${word('igComments.help')}</p></section>
    <p>${word('igComments.partA')}</p>${rows||`<p>${word('igComments.empty')}</p>`}`;
}

/** 5.4 — the one private reply: its state as it stands, and the owner's form while one may still be sent. */
function replyArea(locale:Locale,data:CommentPage,c:InstagramComment,inTime:boolean):string {
  const word=(key:MessageKey)=>sayOnPage(locale,key);
  const line=(key:MessageKey)=>`<p>${word(key)}</p>`;
  const canceled=c.reply_outcome==='reserved'&&c.reply_attempted_at===null&&c.reply_status==='canceled';
  const states:string[]=[];
  if(canceled)states.push(line('igComments.state.canceled'));
  else if(c.reply_outcome==='reserved')states.push(line('igComments.state.queued'));
  else if(c.reply_outcome==='accepted')states.push(line('igComments.state.accepted'));
  else if(c.reply_outcome==='uncertain')states.push(line('igComments.state.uncertain'));
  else if(c.reply_outcome==='refused')states.push(line('igComments.state.refused'));
  if(c.public_requested&&c.reply_outcome!==null&&!canceled){
    states.push(line(c.public_outcome==='accepted'?'igComments.state.publicAccepted':c.public_outcome==='failed'?'igComments.state.publicFailed'
      :c.public_outcome==='uncertain'?'igComments.state.publicUncertain':c.reply_outcome==='accepted'?'igComments.state.publicPosting'
      // Neither is ever tried again (the worker queues the public reply only on an accepted private one), so nothing waits.
      :c.reply_outcome==='refused'?'igComments.state.publicNotAfterRefused':c.reply_outcome==='uncertain'?'igComments.state.publicNotAfterUncertain'
      :'igComments.state.publicWaiting'));
  }
  if(c.attribution_ambiguous)states.push(`<p class="muted">${word('igComments.ambiguous')}</p>`);
  const open=(c.reply_outcome===null||canceled)&&c.asking&&inTime&&data.enabled;
  if(!open)return states.join('');
  if(!data.owner)return states.join('')+`<p class="muted">${word('igComments.ownerReplies')}</p>`;
  const id=esc(c.id);
  return states.join('')+`<form method="post" action="${ROOT}/${encodeURIComponent(c.id)}/reply">
      <label for="reply-${id}">${word('igComments.reply')}</label>
      <textarea id="reply-${id}" name="body" rows="4" dir="auto" required maxlength="${COMMENT_REPLY_MAX}">${esc(suggestCommentReply({words:c.words,productName:c.match_state==='matched'?c.product_name:null}))}</textarea>
      <p class="muted">${word('igComments.replyHelp')}</p>
      <label class="chkbox"><input type="checkbox" name="public" value="1" /> ${word('igComments.public')}</label>
      <button class="btn send" type="submit">${word('igComments.send')}</button></form>`;
}

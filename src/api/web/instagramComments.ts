import type { InstagramComment } from '../../db/instagramComments.js';
import type { Locale } from '../../core/owner/i18n/locale.js';
import { esc, back } from './layout.js';
import { t } from './say.js';
import * as show from './values.js';
export type CommentPage = {comments:readonly InstagramComment[];enabled:boolean;configured:boolean;connected:boolean;owner:boolean;now:Date;deleting?:InstagramComment|null};
const ROOT='/app/channels/instagram/comments';
export function renderInstagramComments(locale:Locale,data:CommentPage):string {
  const word=(key:Parameters<typeof t>[1])=>esc(t(locale,key));
  const title=`${back('/app/settings/channels/meta',t(locale,'nav.channels'))}<h1>${word('igComments.title')}</h1>`;
  if(data.deleting&&data.owner)return `${title}<h2>${word('igComments.delete')}</h2><p>${word('igComments.deleteHelp')}</p>
    <blockquote><bdi dir="auto">${esc(data.deleting.words)}</bdi></blockquote>
    <form method="post" action="${ROOT}/${encodeURIComponent(data.deleting.id)}/delete"><button class="btn send" type="submit" name="confirm" value="delete">${word('igComments.delete')}</button></form>
    <p><a class="deeper" href="${ROOT}">${word('igComments.cancel')}</a></p>`;
  const control=!data.owner?'':!data.connected?`<p>${word('igComments.connect')}</p>`:!data.configured&&!data.enabled?`<p>${word('igComments.unavailable')}</p>`:
    `<form method="post" action="${ROOT}/switch"><button class="btn" type="submit" name="on" value="${data.enabled?'0':'1'}">${word(data.enabled?'igComments.disable':'igComments.enable')}</button></form>`;
  const rows=data.comments.map(c=>{
    const left=c.created_at?c.created_at.getTime()+7*86400000-data.now.getTime():null;
    const age=left===null||c.created_at!.getTime()>data.now.getTime()?word('igComments.ageUnknown'):left<=0?word('igComments.expired'):
      esc(t(locale,'igComments.hours',{hours:show.count(locale,Math.ceil(left/3600000))}));
    const href=c.post_url&&/^https:\/\/(www\.)?instagram\.com\//.test(c.post_url)?c.post_url:null;
    return `<article class="card" id="comment-${esc(c.id)}"><h2><bdi dir="auto">${esc(c.username?`@${c.username}`:t(locale,'igComments.person'))}</bdi></h2>
      <blockquote><bdi dir="auto">${esc(c.words)}</bdi></blockquote>
      <p>${c.match_state==='matched'&&c.product_name?`<bdi dir="auto">${esc(c.product_name)}</bdi>`:word('igComments.noProduct')}</p>
      <p class="muted">${age}</p><p>${href?`<a class="deeper" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${word('igComments.post')}</a>`:word('igComments.noPost')}</p>
      ${data.owner?`<p><a class="deeper" href="${ROOT}/${encodeURIComponent(c.id)}/delete">${word('igComments.delete')}</a></p>`:''}</article>`;
  }).join('');
  return `${title}<p>${word('igComments.intro')}</p><section class="card"><h2>${word('igComments.switch')}</h2><p>${word(data.enabled?'igComments.on':'igComments.off')}</p>${control}<p class="muted">${word('igComments.help')}</p></section>
    <p>${word('igComments.partA')}</p>${rows||`<p>${word('igComments.empty')}</p>`}`;
}

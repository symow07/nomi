import { describe, expect, it } from 'vitest';
import { renderSavedReplies, renderSavedReply } from '../../src/api/web/savedReplies.js';
const row={id:'11111111-1111-4111-8111-111111111111',title:'Delivery',texts:{en:'Your parcel is ready.',ar:'الطرد جاهز.'},archived:false,updatedAt:'2026-11-16T08:00:00Z'};
describe('Block 3 F16 — browse and edit saved replies separately',()=>{
 it('opens the browser without a permanent creation form',()=>{
  const html=renderSavedReplies('en',[row]);
  expect(html).toContain('method="get" action="/app/inbox/replies"');
  expect(html).toContain('name="q"');
  expect(html).toContain('/app/inbox/replies?new=1');
  expect(html).not.toContain('action="/app/replies"');
 });
 it('searches titles and all language versions, including archived replies, without changing the records',()=>{
  const rows=[row,{...row,id:'two',title:'Returns',texts:{en:'Please keep the receipt.'},archived:true}];
  const html=renderSavedReplies('en',rows,{query:'receipt'});
  expect(html).toContain('Returns');expect(html).not.toContain('>Delivery<');
  expect(html).toMatch(/<details class="saved-archive" open/);
  expect(renderSavedReplies('en',rows,{query:'الطرد'})).toContain('>Delivery<');
  expect(renderSavedReplies('en',rows,{query:'<missing>'})).toContain('&lt;missing&gt;');
  expect(rows[0]?.title).toBe('Delivery');
 });
 it('keeps every language and the original create command in the focused form',()=>{
  const html=renderSavedReplies('en',[row],{create:true});
  expect(html).toContain('action="/app/replies"');
  expect(html).not.toContain('class="saved-reply-rows"');
  expect(html).toContain('form="saved-reply-form"');
  for(const l of ['en','zh','ar','es','fr'])expect(html).toContain(`name="text_${l}"`);
  expect(html).toContain('>Cancel</a>');
 });
 it('places Save, Cancel and the confirmed archive command together, and saving an archive does not restore it',()=>{
  const html=renderSavedReply('en',row);
  const actions=html.slice(html.indexOf('class="saved-editor-actions"'));
  expect(actions).toContain('form="saved-reply-form"');expect(actions).toContain('>Cancel</a>');
  expect(actions).toContain(`/app/replies/${row.id}/archive`);expect(actions).toContain('data-confirm=');
  const archived=renderSavedReply('en',{...row,archived:true});
  expect(archived).toContain('stays archived');expect(archived).toContain(`/app/replies/${row.id}/restore`);
 });
});

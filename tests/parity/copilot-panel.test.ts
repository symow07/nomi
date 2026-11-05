import { describe, it, expect } from 'vitest';
import { renderCopilotPanel } from '../../src/api/web/copilotPanel.js';
import type { CopilotPanelView } from '../../src/api/web/conversationAdvisor.js';
const view: CopilotPanelView = {
  conversationId:'c1',customerId:'customer',customerName:'Maya <shop>',revision:'revision',allowance:'available',asked:'Offer 5% off',intent:'draft_reply',
  answer:{kind:'fact',text:'From current records.',facts:[{id:'unit',label:'Unit price',value:'$9.50',calculation:'10 × (1 − 5/100)',sources:[{label:'Product',href:'/app/products/p1'}]},
    {id:'unknown',label:'Unsupported',value:'£50',sources:[{label:'Bad link',href:'https://outside.invalid/'}]}],reply:{text:'It is $9.50 each. <script>',revision:'revision'}},
  history:{threadHref:'/app/advisor/c/thread',consent:true,processor:'Existing provider notice'},
};
describe('grounded panel presentation',()=>{
  it('keeps answer, inspectable values and proposed customer words separate, escaped and sourced',()=>{
    const html=renderCopilotPanel('en',view);
    expect(html).toContain('<details class="cp-fact"');
    expect(html).toContain('Unit price <bdi>$9.50</bdi>');expect(html).toContain('href="/app/products/p1"');
    expect(html).toContain('10 × (1 − 5/100)');expect(html).toContain('No supporting record');
    expect(html).not.toContain('outside.invalid');expect(html).not.toContain('<script>');expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('name="revision" value="revision"');expect(html).toContain('action="/app/inbox/c1/copilot/reply"');
    expect(html).not.toContain('/act');expect(html).not.toContain('name="draftId"');
  });
  it('initial panel offers three explicit requests and disables paid questions when allowance is unavailable',()=>{
    const initial=renderCopilotPanel('en',{...view,asked:'',answer:null,allowance:'used',history:{threadHref:null,consent:false,processor:''}});
    expect(initial.match(/data-copilot-ask/g)).toHaveLength(4);
    for(const intent of ['last_order','summarise_chat','draft_reply']) expect(initial).toContain(`value="${intent}"`);
    expect(initial).toContain('value="Draft a reply offering 5% off"');
    expect(initial.match(/type="submit" disabled/g)).toHaveLength(4);
    expect(initial).not.toContain('data-copilot-use');expect(initial).toContain('not saved to your personal history');
  });
  it('offers the existing per-person history choice and never says kept questions are unrecorded', () => {
    const ask = renderCopilotPanel('en', { ...view, history: { threadHref: null, consent: true, keeping: false, processor: 'provider' } });
    expect(ask).toContain('action="/app/advisor/consent"');
    expect(ask).toContain('name="choice" value="allow"');
    expect(ask).toContain('name="choice" value="notnow"');
    const kept = renderCopilotPanel('en', { ...view, history: { ...view.history, consent: false, keeping: true } });
    expect(kept).not.toContain('not saved to your personal history');
    expect(kept).toContain('href="/app/advisor/c/thread"');
  });
  it('links the request source to the question still on this page, rather than a fresh blank question',()=>{
    const html=renderCopilotPanel('en',{...view,answer:{...view.answer!,facts:[{id:'request',label:'Requested discount',value:'5%',sources:[{label:'Your request',href:'/app/inbox/c1/copilot#copilot-question'}]}]}});
    expect(html).toContain('href="#copilot-question"');expect(html).toContain('>Offer 5% off</textarea>');
  });
});

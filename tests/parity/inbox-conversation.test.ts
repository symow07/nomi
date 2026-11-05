import { describe, expect, it } from 'vitest';
import { renderConversationDetail, type ConversationDetail } from '../../src/api/web/inbox.js';
import { moneyFromRow } from '../../src/core/types/money.js';
import { renderPanes, renderListPane, paneRowOf } from '../../src/api/web/panes.js';
const cid = '00000000-0000-0000-0000-000000000002';
const detail: ConversationDetail = {
  conversationId: cid, buyer: 'Maya <shop>', country: null, status: 'awaiting', product: { name: null, nameZh: null }, quantity: null,
  quote: null, order: null, messages: [], pendingDraft: { draftId: 'real-draft', draftText: 'Original words', capability: 'quote' },
  ownership: 'AI', refusals: [], uncertainSends: [], handoffReasons: [], unheardReason: null, lastHumanAction: null,
  knowledgeUsed: [], rate: null, leadTimeBlocked: null, sampleAsked: null, proof: { quoteId: null, token: null },
};
describe('conversation tools preserve the command boundary', () => {
  it('opens Ask Nomi through a real GET and keeps the approval identity and actions', () => {
    const html = renderConversationDetail(detail, 'en', new Date('2026-11-05'), null);
    expect(html).toContain(`method="get" action="/app/inbox/${cid}/copilot"`);
    expect(html).toContain('Ask Nomi');
    expect(html).toContain('data-open-tool="ask"');
    expect(html).toContain('name="draftId" value="real-draft"');
    expect(html).toContain(`action="/app/inbox/${cid}/act"`);
    expect(html).toContain('value="不回"');
    expect(html).toContain(`formaction="/app/inbox/${cid}/takeover"`);
    expect(html).toContain('Original words</textarea>');
  });
  it('links a sourced draft figure to the quoted product and exposes its arithmetic, leaving unknown figures marked', () => {
    const html = renderConversationDetail({ ...detail, product: { id: 'identified-product', name: 'Serum', nameZh: null },
      quote: { productId: 'quoted-product', unitPrice: moneyFromRow('10', 'USD')!, total: moneyFromRow('100', 'USD')!, quantity: 10 },
      pendingDraft: { ...detail.pendingDraft!, draftText: 'Serum is $10 each, $100 total. Another $999.' } }, 'en', new Date('2026-11-05'), null);
    expect(html).toContain('href="/app/products/quoted-product"');
    expect(html).toContain('class="reading-proof"');
    expect(html).toContain('10 × $10.00 = $100.00');
    expect(html).toContain('no source found');
  });
  it('inspects customer quantities and saved lead-time/discount rules without attributing them to the current product', () => {
    const html = renderConversationDetail({ ...detail, product: { id: 'current-product', name: 'Serum', nameZh: null }, quantity: 120,
      messages: [{ direction: 'inbound', text: 'Please quote 120 pieces <today>', at: new Date('2026-11-05T08:00:00Z') }],
      quote: { productId: 'quoted-product', unitPrice: moneyFromRow('9', 'USD')!, total: moneyFromRow('1080', 'USD')!, quantity: 120,
        appliedRules: ['discount_pct:10', 'lead_time_days:30'] },
      reading: { intent: null, quantity: null, language: null, differsOn: null,
        quote: { unitPrice: 9, total: 1080, quantity: 120, discountPct: 10, leadTimeDays: 30, moq: null } },
      pendingDraft: { ...detail.pendingDraft!, draftText: '120 pieces, 10% off, ships in 30 days.' } }, 'en', new Date('2026-11-05'), null);
    expect(html).toContain('Inspect 120');expect(html).toContain('Please quote 120 pieces &lt;today&gt;');
    expect(html).toContain('href="#message-0"');expect(html).toContain('id="message-0"');
    expect(html).toContain('href="/app/products/price-limits#volume"');
    expect(html).toContain('Lead-time rule saved with this price offer: 30 days.');
    expect(html).not.toContain('href="/app/products/current-product"');
  });
  it('shows sources for small customer quantities and a 12-day rule, and marks an unsupported small number honestly', () => {
    const html = renderConversationDetail({ ...detail, quantity: 4,
      messages: [{direction:'inbound',text:'I need 4 pieces',at:null}],
      quote: { productId:'quoted-product',unitPrice:moneyFromRow('9','USD')!,total:moneyFromRow('36','USD')!,quantity:4,appliedRules:['lead_time_days:12'] },
      reading: {intent:null,quantity:null,language:null,differsOn:null,quote:{unitPrice:9,total:36,quantity:4,discountPct:0,leadTimeDays:12,moq:null}},
      pendingDraft:{...detail.pendingDraft!,draftText:'4 pieces, ships in 12 days, plus 2 extras.'} }, 'en',new Date('2026-11-05'),null);
    expect(html).toContain('Inspect 4');expect(html).toContain('<blockquote dir="auto">I need 4 pieces</blockquote>');
    expect(html).toContain('Inspect 12');expect(html).toContain('Lead-time rule saved with this price offer: 12 days.');
    expect(html).toContain('<bdi>2</bdi></span><span>no source found');
    expect(html).toContain('No source for 2');
  });
  it('does not display an unsupported five-day promise as a sourced five-dollar price', () => {
    const html=renderConversationDetail({...detail,
      quote:{productId:'quoted-product',unitPrice:moneyFromRow('5','USD')!,total:moneyFromRow('500','USD')!,quantity:100},
      reading:{intent:null,quantity:null,language:null,differsOn:null,quote:{unitPrice:5,total:500,quantity:100,discountPct:0,leadTimeDays:30,moq:null}},
      pendingDraft:{...detail.pendingDraft!,draftText:'Ships in 5 days.'}},'en',new Date('2026-11-05'),null);
    const reading=html.slice(html.indexOf('<details class="reading">'),html.indexOf('</section>',html.indexOf('<details class="reading">')));
    expect(reading).toContain('No source for 5 days');expect(reading).toContain('<bdi>5 days</bdi></span><span>no source found');
    expect(reading).not.toContain('$5.00');expect(reading).not.toContain('href="/app/products/quoted-product"');
  });
  it('returns to the validated list address supplied by the route', () => {
    const html = renderConversationDetail(detail, 'en', new Date('2026-11-05'), null, undefined, { returnHref: '/app/inbox?filter=quiet&q=Maya' });
    expect(html).toContain('href="/app/inbox?filter=quiet&amp;q=Maya"');
  });
  it('pins a current row below the first screen once, without duplicate return anchors', () => {
    const rows = Array.from({ length: 9 }, (_, n) => paneRowOf({ ...detail, conversationId: `c-${n}`, buyer: `Customer ${n}` }));
    const current = rows[8]!;
    const html = renderListPane({ conversations: rows, filter: 'all', waitingCount: 9, blockedCount: 0, returnHref: '/app/inbox?filter=all&after=cursor' }, 'en', new Date('2026-11-05'), current.conversationId, [], current);
    expect(html.match(/id="inbox-c-8"/g)).toHaveLength(1);
    expect(html.indexOf('id="inbox-c-8"')).toBeLessThan(html.indexOf('id="inbox-c-0"'));
  });
  it('provides one optional shared pane, without duplicating the composer', () => {
    const html = renderPanes('<aside>list</aside>', '<textarea>kept</textarea>', '<aside id="customer">facts</aside>', { conversationId: cid, locale: 'en' });
    expect(html).toContain('data-conversation-tools');
    expect(html.match(/data-copilot-slot/g)).toHaveLength(1);
    expect(html.match(/<textarea/g)).toHaveLength(1);
    expect(html).toContain('data-tool-tab="customer"');
    expect(html).toContain('data-tool-tab="ask"');
  });
});

import { describe, it, expect } from 'vitest';
import { renderSplitConversation } from '../../src/api/web/splitConversation.js';
import { SPLIT_CSS } from '../../src/api/web/splitStyle.js';
import { renderConversationDetail, type ConversationDetail } from '../../src/api/web/inbox.js';
import { withWorkspace } from '../../src/api/web/say.js';
import { withZone } from '../../src/api/web/zone.js';
import type { StageFacts } from '../../src/db/customerStage.js';
import { moneyFromRow } from '../../src/core/types/money.js';
import { buttonsAndDoors } from './buttons-and-doors.js';
import { unisolatedFigures, withoutIsolates } from './isolates.js';

/**
 * A CONVERSATION IN THE SPLIT LOOK (the owner, 2026-11-05): the head of Today and the Inbox; the messages as a chat; the
 * reply with Send, Edit and Hand to me; where each figure came from, open. Only the arrangement is new: the plain page's
 * parts, and its checks on the draft, are the ones drawn here.
 */

const NOW = new Date('2026-11-05T12:00:00Z');
const SCOPE = { name: 'Lily', several: false, outreach: false, setup: null, business: 'Atlas', zone: 'UTC', needsYou: 2 };
const usd = (n: string) => moneyFromRow(n, 'USD')!;
const QUOTE = { unitPrice: 34.9, total: 349, quantity: 10, discountPct: 0, leadTimeDays: 5, moq: null };
const OWNER = { id: 'p-1', isOwner: true, role: 'owner', name: 'Moe' };
const STAFF = { ...OWNER, isOwner: false, role: 'sales' };

const base: ConversationDetail = {
  conversationId: 'c-1', buyer: 'Maya Rahman', country: 'GB', status: 'awaiting',
  product: { name: 'Rose Face Serum', nameZh: '玫瑰精华' }, quantity: 10,
  quote: { unitPrice: usd('34.9'), total: usd('349'), quantity: 10 }, order: null,
  messages: [
    { direction: 'inbound', text: 'how much for 10 of the rose serum?', at: new Date('2026-11-05T09:58:00Z') },
    { direction: 'outbound', text: 'Which size would you like?', at: new Date('2026-11-05T10:00:00Z') },
    { direction: 'inbound', text: 'the 50 ml', at: new Date('2026-11-05T10:02:00Z') },
  ],
  pendingDraft: { draftId: 'd-1', draftText: 'The Rose Face Serum is $34.90 each, $349 for 10.', capability: 'quote' },
  ownership: 'AI', refusals: [], uncertainSends: [], handoffReasons: [], unheardReason: null, lastHumanAction: null,
  knowledgeUsed: ['Ships from Leeds'], rate: null, leadTimeBlocked: null, sampleAsked: null, proof: { quoteId: null, token: null },
  channel: 'instagram',
  reading: { intent: 'price_request', quantity: { value: 10, unit: 'bottles' }, language: 'en', differsOn: [], quote: QUOTE },
} as unknown as ConversationDetail;
const GIVEN = { stage: 'price', value: usd('349'), thumb: '/media/rose', product: 'Rose Face Serum' } as unknown as StageFacts;

const draw = (d: ConversationDetail, facts: StageFacts | null = GIVEN, locale: 'en' | 'ar' = 'en', viewer = OWNER, panel = '<aside class="panel" id="customer"></aside>'): string =>
  withWorkspace(SCOPE, () => withZone('UTC', () => renderSplitConversation(d, facts, panel, locale, NOW, null, viewer as never)));
const plain = (d: ConversationDetail, locale: 'en' | 'ar' = 'en', viewer = OWNER): string =>
  withWorkspace(SCOPE, () => withZone('UTC', () => renderConversationDetail(d, locale, NOW, null, viewer as never)));
const head = (html: string): string => html.split('<header class="sp-head sc-head">')[1]!.split('</header>')[0]!;
const rule = (selector: string): string => {
  const at = SPLIT_CSS.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  return SPLIT_CSS.slice(at, SPLIT_CSS.indexOf('}', at));
};

describe('the head', () => {
  it('a door back to the Inbox, the face, the name as the one heading, the product, the stage and the figure', () => {
    const h = withoutIsolates(head(draw(base)));
    expect(h).toContain('href="/app/inbox"');
    expect(h).toContain('class="face');
    expect(h).toMatch(/<h1 class="page"><bdi>Maya Rahman<\/bdi><\/h1>/);
    expect(h).toContain('src="/media/rose"');
    expect(h).toContain('>Price given<');
    expect(h).toContain('class="sc-value">$349');
    expect(draw(base).match(/<h1\b/g)).toHaveLength(1);
  });

  it('no stage on record is "Asked"; no figure is no figure; no photo is no photo', () => {
    const h = withoutIsolates(head(draw(base, null)));
    expect(h).toContain('>Asked<');
    expect(h).not.toContain('sc-value');
    expect(h).not.toContain('<img class="sp-thumb"');
  });

  it('the state and the story stay: who has it, and what they asked about', () => {
    const h = withoutIsolates(head(draw(base)));
    expect(h).toContain('cu-state');
    expect(h).toContain('Rose Face Serum');
  });

  it('a customer with no name on record has the word for one', () => {
    expect(withoutIsolates(head(draw({ ...base, buyer: null } as unknown as ConversationDetail)))).toMatch(/<h1 class="page"><bdi>Customer<\/bdi>/);
  });
});

describe('the chat', () => {
  it('draws the plain page\'s own messages, with the ids the live line needs', () => {
    const html = draw(base);
    const timeline = (x: string): string => x.slice(x.indexOf('<div class="timeline'), x.indexOf('</section>', x.indexOf('<div class="timeline')));
    expect(html.match(/class="msg inbound/g)).toHaveLength(2);
    expect(html.match(/class="msg outbound/g)).toHaveLength(1);
    expect(html).toContain('id="latest"');
    expect(timeline(html)).toContain('how much for 10 of the rose serum?');
    for (const words of ['how much for 10 of the rose serum?', 'Which size would you like?', 'the 50 ml']) expect(plain(base)).toContain(words);
  });

  it('the customer at the start of the line and ours at its end, by logical properties alone, so Arabic mirrors itself', () => {
    expect(SPLIT_CSS).toContain('.sc .msg.inbound .bubble { background:var(--color-surface);');
    expect(rule('.sc .msg.inbound .bubble')).toContain('border-start-start-radius');
    expect(rule('.sc .msg.outbound .bubble, .sc .msg.outbound .bubble.by-as')).toContain('border-start-end-radius');
    const ours = SPLIT_CSS.slice(SPLIT_CSS.indexOf('/* A conversation.'), SPLIT_CSS.indexOf('/* The Inbox:'));
    expect(ours).not.toMatch(/\b(?:margin|padding|border)-(?:left|right)\b|text-align:(?:left|right)|float:/);
    expect(ours).not.toContain('[dir=');
  });
});

describe('the reply waiting', () => {
  const card = (html: string): string => html.slice(html.indexOf('id="approve"'), html.indexOf('</section>', html.indexOf('id="approve"')));

  it('its words once, in the box; Send, Edit, Hand to me; No reply needed still asks first', () => {
    const c = withoutIsolates(card(draw(base)));
    expect(c.match(/The Rose Face Serum is \$34\.90 each/g)).toHaveLength(1);
    expect(c).toContain('<button class="sp-btn sp-send" type="submit" name="command" value="send">Send</button>');
    expect(c).toContain('<label class="sp-btn" for="reply">Edit</label>');
    expect(c).toContain('formaction="/app/inbox/c-1/takeover"');
    expect(c).toContain('value="不回"');
    expect(c).toContain('data-confirm=');
  });

  it('Send is the only magenta on the page', () => {
    const html = draw(base);
    expect(html.match(/sp-send/g)).toHaveLength(1);
    expect(html).not.toContain('btn send needs');
  });

  it('every check the plain card makes is made here: the same reading, opened', () => {
    const between = (x: string): string => x.slice(x.indexOf('<details class="reading"'), x.indexOf('</details>', x.indexOf('<details class="reading"')));
    const here = between(card(draw(base)));
    expect(here).toContain('<details class="reading" open>');
    expect(here.replace(' open>', '>')).toBe(between(card(plain(base))));
    expect(withoutIsolates(here)).toContain('$34.90');
    expect(here).toContain('class="reasons"');
  });

  it('a figure nobody can source says so, up where it is seen', () => {
    const d = { ...base, pendingDraft: { ...base.pendingDraft!, draftText: 'It is $29 today.' } } as ConversationDetail;
    expect(card(draw(d))).toContain('class="c check"');
  });

  it('the owner\'s kept edit opens the box and says it is kept', () => {
    const d = { ...base, pendingDraft: { ...base.pendingDraft!, ownerEdit: 'My own words' } } as ConversationDetail;
    const c = card(draw(d));
    expect(c).toContain('My own words</textarea>');
    expect(c).toContain('role="note"');
  });

  it('nothing waiting, no card, and no empty box', () => {
    const html = draw({ ...base, pendingDraft: null } as unknown as ConversationDetail);
    expect(html).not.toContain('id="approve"');
    expect(html).not.toContain('sc-draft');
  });
});

describe('what else the page offers', () => {
  it('owner only stays owner only: "my own test" is not offered to staff, on either look', () => {
    expect(draw(base)).toContain('/testing');
    expect(draw(base, GIVEN, 'en', STAFF)).not.toContain('/testing');
    expect(plain(base, 'en', STAFF)).not.toContain('/testing');
  });

  it('the panel is beside the chat from 1100 px; narrower, the door to the customer\'s page stands instead', () => {
    expect(draw(base)).toContain('<div class="sc-aside"><aside class="panel" id="customer">');
    expect(draw(base, GIVEN, 'en', OWNER, '')).not.toContain('sc-aside');
    const wide = SPLIT_CSS.slice(SPLIT_CSS.indexOf('@media (min-width: 1100px)'));
    expect(rule('.sc-aside')).toContain('display:none');
    expect(wide.slice(0, wide.indexOf('/* The Inbox:'))).toContain('.sc-more .file-door { display:none; }');
  });
});

describe('in Arabic', () => {
  it('every figure isolated, one heading, buttons do things and doors go places', () => {
    const html = draw(base, GIVEN, 'ar');
    expect(unisolatedFigures(html)).toEqual([]);
    expect(buttonsAndDoors(html)).toEqual([]);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
  });
});

describe('the look', () => {
  it('the reply on a phone: buttons fill the row and are 44 px tall, like Today\'s', () => {
    expect(rule('.sc-draft .sp-acts .sp-btn')).toContain('flex:1 1 auto');
    expect(rule('.sp-btn')).toContain('min-block-size:44px');
  });

  it('Confirm the order and every other primary act is ink here, never the ochre the base rule would give, nor magenta', () => {
    expect(rule('.split .sc .btn.send, .split .sc .btn.send.needs')).toContain('background:var(--color-ink)');
    expect(rule('.split .sc .btn.send, .split .sc .btn.send.needs')).not.toContain('magenta');
  });

  it('a long name wraps beside the face: the face\'s door does not shrink under it', () => {
    expect(rule('.sc-who > .face-link')).toContain('flex:none');
    expect(rule('.sc-whot')).toContain('min-inline-size:0');
    expect(rule('.split .sc-head h1.page')).toContain('overflow-wrap:anywhere');
  });

  it('the sources are as large as the page\'s text, and open', () => {
    expect(rule('.split .sc-draft .reasons li > :nth-child(2)')).toContain('font-size:var(--font-size-base)');
    expect(rule('.split .sc-draft .reasons')).toContain('font-size:var(--font-size-small)');
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { channelName } from '../../src/api/web/conversations.js';
import { renderConversationDetail, type ConversationDetail } from '../../src/api/web/inbox.js';
import { checkMetaReadiness } from '../../src/core/channel/metaReadiness.js';
import { OUTREACH_CHANNELS } from '../../src/core/channel/registry.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { messages } from '../../src/core/owner/i18n/messages.js';
import { withAssistantName } from '../../src/api/web/say.js';

/**
 * D3–D7 — four small truths from the site review of 2026-09-18, each of which
 * the owner met in his first days: a key printed as a word, his own typed reply
 * signed by his employee, a card that contradicted itself, and a page that said
 * "live" on the day nothing could be sent.
 */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');

describe('D3 · every channel a conversation can be on has a name', () => {
  it('for every kind the registry knows, in every language — no key reaches the owner', () => {
    for (const locale of LOCALES) {
      for (const kind of [...OUTREACH_CHANNELS, 'wechat', 'rednote', 'webhook_test']) {
        const name = channelName(locale, kind);
        expect(name, `${locale}/${kind}`).not.toBe(`conv.channel.${kind}`);
        expect(name.length, `${locale}/${kind}`).toBeGreaterThan(0);
      }
      // …and the catalogue is where they live, not a ternary in one renderer.
      for (const kind of OUTREACH_CHANNELS) {
        expect(messages[locale], `${locale}/${kind}`).toHaveProperty(`conv.channel.${kind}`);
      }
    }
  });
});

const base: ConversationDetail = {
  conversationId: '44444444-4444-4444-8444-444444444444', buyer: 'Ahmed', country: 'AE', status: 'awaiting',
  product: { name: null, nameZh: null }, quantity: null, quote: null, order: null, pendingDraft: null,
  ownership: 'AI', refusals: [], uncertainSends: [], handoffReasons: [], unheardReason: null, lastHumanAction: null,
  knowledgeUsed: [], rate: null, leadTimeBlocked: null, sampleAsked: null, proof: { quoteId: null, token: null },
  messages: [
    { direction: 'inbound', text: 'Hello', at: new Date('2026-09-19T14:00:00Z') },
    { direction: 'outbound', text: 'hello sir', at: new Date('2026-09-19T14:28:00Z'), by: 'owner' },
    { direction: 'outbound', text: 'Hi there! What are you looking for today?', at: new Date('2026-09-19T14:41:00Z') },
  ],
};

describe('D4 · a reply the owner typed is his, not his employee\'s', () => {
  it('his line says "You"; the assistant\'s line carries the assistant\'s name; the buyer stays the buyer', () => {
    const html = withAssistantName('Lily', () =>
      renderConversationDetail(base, 'en', new Date('2026-09-19T15:00:00Z'), null));
    // The three signature lines, in the order the three messages appear.
    const signed = [...html.matchAll(/<div class="ts muted">([^<]*)<\/div>/g)].map((m) => m[1]!.trim());
    expect(signed).toHaveLength(3);
    expect(signed[0], 'the buyer').toContain('Buyer');
    expect(signed[1], 'what the owner typed').toContain('You');
    expect(signed[1], 'what the owner typed').not.toContain('Lily');
    expect(signed[2], 'what the assistant wrote').toContain('Lily');
  });

  it('it is read from the sent row\'s own origin, not guessed from the words', () => {
    const src = read('src/api/web/inbox.ts');
    expect(src).toMatch(/left join outbound_messages o\s*\n\s*on m\.direction = 'outbound' and m\.external_id = 'out:' \|\| o\.id::text/);
    expect(src).toMatch(/m\.by === 'owner' \? esc\(t\(locale, 'conv\.by\.you'\)\)/);
  });
});

describe('D6 · the card and the line below it agree', () => {
  it('connected-but-not-started says so, instead of "until this is connected"', () => {
    const f = read('src/api/web/factory.ts');
    expect(f).toMatch(/lc === 'ready' \? 'factory\.reach\.nextReady'/);
    for (const locale of LOCALES) {
      expect(messages[locale]).toHaveProperty('factory.reach.nextReady');
      expect(messages[locale]['factory.reach.nextReady']).not.toBe(messages[locale]['factory.reach.nextNot']);
    }
  });
});

describe('D7 · "live" means a buyer can actually be answered', () => {
  const GOOD = {
    accessToken: `EAA${'x'.repeat(60)}`, phoneNumberId: '123456789012345', businessAccountId: '123456789012345',
    appSecret: 'a'.repeat(32), verifyToken: 'v'.repeat(24), graphVersion: 'v23.0',
  };

  it('a connected channel nobody started is NOT live, and says which step is missing', () => {
    const wired = checkMetaReadiness({ values: GOOD, provider: 'meta', channelStatus: 'connected' });
    expect(wired.live).toBe(false);
    expect(wired.blockers).toEqual(['not_started']);
    expect(checkMetaReadiness({ values: GOOD, provider: 'meta', channelStatus: 'connected', activated: true }).live).toBe(true);
  });

  it('the page asks the database whether she was started, rather than assuming', () => {
    expect(read('src/api/web/app.ts')).toMatch(/activated: ch\.activated/);
    expect(read('src/api/web/channels.ts')).toMatch(/ch\.activated_at is not null as activated/);
  });
});

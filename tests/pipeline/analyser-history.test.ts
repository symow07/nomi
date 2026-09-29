import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { anthropicAnalyzer } from '../../src/llm/anthropic.js';
import { computeTurn, HISTORY_TURNS } from '../../src/pipeline/turn.js';
import { emptyState, CONVERSATION } from '../parity/fixtures.js';
import { FakeAnalyzer, FakeReplyWriter, FakeRetriever, FakeTenant } from './fakes.js';

/**
 * Q1 — THE ANALYSER SEES WHAT WAS SAID BEFORE (the one-month build order,
 * 2026-09-29). prompts/analysis.txt has always promised the model the
 * conversation's last six turns; the turn handed it an empty list, so "yes,
 * 500 of those" was read with no idea what "those" were. Now the turn loads
 * the last six messages, both sides, and leaves out the ones it is answering
 * (they are the message itself). The real repository's query is
 * tests/integration/analyser-history.test.ts.
 */

const PROMPT = readFileSync(fileURLToPath(new URL('../../prompts/analysis.txt', import.meta.url)), 'utf8');

describe('Q1 · the turn hands the analyser its history', () => {
  const run = async (tenant: FakeTenant, req: { messageId: string; text: string; answering?: readonly string[] }) => {
    const analyzer = new FakeAnalyzer();
    analyzer.next = {
      language: { detected: 'en', replyIn: 'en' },
      intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
      recommendedPhase: 'clarification',
    };
    const asked: { limit: number; excluding: readonly string[] }[] = [];
    const real = tenant.conversations.recentMessages;
    tenant.conversations = { ...tenant.conversations, recentMessages: async (id, opts) => { asked.push(opts); return real(id, opts); } };
    await computeTurn({ tenant, retriever: new FakeRetriever(), analyzer, replyWriter: new FakeReplyWriter(), now: () => new Date('2026-07-14T04:00:00Z') },
      { conversationId: CONVERSATION, ...req });
    return { analyzer, asked };
  };

  it('the last six messages, both sides, oldest first — as the prompt promises', async () => {
    expect(HISTORY_TURNS).toBe(6);
    expect(PROMPT).toContain('Conversation history (last 6 turns)');
    const tenant = new FakeTenant();
    tenant.seed(CONVERSATION, emptyState({ phase: 'clarification' }));
    tenant.history = [
      { direction: 'inbound', text: 'Hi, do you make tote bags?' },
      { direction: 'outbound', text: 'Yes — canvas or jute?' },
      { direction: 'inbound', text: 'Canvas, natural colour' },
      { direction: 'outbound', text: 'We have 12oz natural canvas totes.' },
      { direction: 'inbound', text: 'With a zip?' },
      { direction: 'outbound', text: 'No zip, but an inner pocket.' },
      { direction: 'inbound', text: 'OK' },
    ];
    const { analyzer, asked } = await run(tenant, { messageId: 'm-8', text: 'yes, 500 of those please' });
    expect(analyzer.histories).toEqual([tenant.history.slice(-6)]);
    expect(asked).toEqual([{ limit: 6, excluding: ['m-8'] }]);
  });

  it('the messages this turn answers (a batch) are the question, not its history', async () => {
    const tenant = new FakeTenant();
    tenant.seed(CONVERSATION, emptyState({ phase: 'clarification' }));
    const { asked } = await run(tenant, { messageId: 'm-3', text: 'hello\nhow much for 500?', answering: ['m-2', 'm-3'] });
    expect(asked).toEqual([{ limit: 6, excluding: ['m-3', 'm-2', 'm-3'] }]);
  });

  it('a first message has an empty history, and says so', async () => {
    const tenant = new FakeTenant();
    tenant.seed(CONVERSATION, emptyState({ phase: 'warm_intake' }));
    const { analyzer } = await run(tenant, { messageId: 'm-1', text: 'Hello' });
    expect(analyzer.histories).toEqual([[]]);
  });
});

describe('Q1 · the adapter puts the history where the prompt says it is', () => {
  it('each earlier message on its own line, [CLIENT] or [US]; a message with no words is [media]', async () => {
    let sent: { messages: { content: string }[] } | undefined;
    const client = {
      messages: {
        create: async (req: { messages: { content: string }[] }) => {
          sent = req;
          return { content: [{ type: 'text', text: '{}' }], usage: { input_tokens: 1, output_tokens: 1 } };
        },
      },
    } as unknown as Anthropic;
    await anthropicAnalyzer(client).analyze({
      text: 'yes, 500 of those', state: emptyState({ phase: 'clarification' }), candidates: [],
      recentMessages: [
        { direction: 'inbound', text: 'Do you make canvas totes?' },
        { direction: 'outbound', text: 'Yes — 12oz natural.' },
        { direction: 'inbound', text: '' },
      ],
    });
    expect(sent!.messages[0]!.content).toContain(
      'CONVERSATION HISTORY:\n[CLIENT] Do you make canvas totes?\n[US] Yes — 12oz natural.\n[CLIENT] [media]\n\nCLIENT MESSAGE:\nyes, 500 of those');
  });
});

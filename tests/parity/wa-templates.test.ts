import { describe, it, expect } from 'vitest';
import {
  REOPEN_BODY, REOPEN_TEMPLATE, REOPEN_LANGUAGES, pickReopenLanguage, reopenLanguageOf, renderReopen, reopenParam,
} from '../../src/core/channel/reopen.js';
import { submitReopenTemplate, reopenTemplateStatuses } from '../../src/channels/whatsapp/templates.js';
import { whatsappClient } from '../../src/channels/whatsapp/client.js';
import {
  driveConversationOutbound, type OutboundStore, type OutboundWorkRow, type ConversationSendContext,
} from '../../src/outbound/worker.js';
import type { ChannelAdapter } from '../../src/channels/contract.js';

/**
 * WA-S — reopening a customer's closed 24 hours with ONE approved template:
 * the sentences, Meta's calls, and the worker's branch — a reply someone
 * approved goes as the template and its words wait for the owner; an
 * automated one, a first message or a picture is refused as before.
 */

const NOW = new Date('2026-10-02T10:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

describe('WA-S · the sentences', () => {
  it('one name, six languages, each naming the business and nothing else', () => {
    expect(REOPEN_TEMPLATE).toMatch(/^[a-z0-9_]+$/);
    expect(Object.values(REOPEN_LANGUAGES).sort()).toEqual(Object.keys(REOPEN_BODY).sort());
    for (const [lang, body] of Object.entries(REOPEN_BODY)) {
      expect(body.split('{{1}}').length, lang).toBe(2);
      expect(body, lang).not.toMatch(/\{\{2\}\}|\bAI\b|\bbot\b|robot|assistant|asistente|助手|مساعد/i);
    }
    expect(renderReopen('es', 'Tienda Sol')).toBe('Hola, te escribimos de Tienda Sol. Tenemos una respuesta a tu mensaje. Contesta a este mensaje para verla.');
    expect(reopenParam('  ')).toBe('Nomi');
    expect(reopenParam('x'.repeat(80))).toHaveLength(60);
  });
  it('the customer\'s language, then the business\'s, then English, then any approved', () => {
    expect(reopenLanguageOf('es-MX')).toBe('es');
    expect(reopenLanguageOf('pt-BR')).toBe('pt_BR');
    expect(reopenLanguageOf('zh-Hans')).toBe('zh_CN');
    expect(reopenLanguageOf('de')).toBeNull();
    expect(pickReopenLanguage(['en', 'es'], 'es', 'en')).toBe('es');
    expect(pickReopenLanguage(['en', 'ar'], 'de', 'ar')).toBe('ar');
    expect(pickReopenLanguage(['en', 'fr'], 'de', 'ru')).toBe('en');
    expect(pickReopenLanguage(['fr'], 'de', 'ru')).toBe('fr');
    expect(pickReopenLanguage([], 'es', 'en')).toBeNull();
    expect(pickReopenLanguage(['xx'], 'es', 'en')).toBeNull();
  });
});

describe('WA-S · Meta, over the wire (faked as documented)', () => {
  type Call = { method: string; url: string; headers: Record<string, string>; body?: string };
  const fake = (status: number, body: unknown) => {
    const calls: Call[] = [];
    const f = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
      calls.push({ method: init.method, url, headers: init.headers, ...(init.body ? { body: init.body } : {}) });
      return { status, text: async () => JSON.stringify(body) };
    };
    return { f, calls };
  };
  it('asked as UTILITY, one language at a time, with an example for the business\'s name', async () => {
    const m = fake(200, { id: '1234', status: 'PENDING', category: 'UTILITY' });
    expect(await submitReopenTemplate({ wabaId: '222222', token: 'tok', graphVersion: 'v23.0', language: 'es', example: 'Tienda Sol' }, m.f))
      .toEqual({ ok: true, id: '1234', status: 'PENDING' });
    expect(m.calls[0]).toMatchObject({ method: 'POST', url: 'https://graph.facebook.com/v23.0/222222/message_templates' });
    expect(m.calls[0]!.headers['Authorization']).toBe('Bearer tok');
    expect(JSON.parse(m.calls[0]!.body!)).toEqual({
      name: REOPEN_TEMPLATE, language: 'es', category: 'UTILITY',
      components: [{ type: 'BODY', text: REOPEN_BODY.es, example: { body_text: [['Tienda Sol']] } }],
    });
    expect(await submitReopenTemplate({ wabaId: '222222', token: 'tok', graphVersion: 'v23.0', language: 'es', example: 'x' },
      fake(400, { error: { error_user_msg: 'Too similar to an existing template' } }).f))
      .toEqual({ ok: false, reason: 'refused', detail: 'Too similar to an existing template' });
    expect(await submitReopenTemplate({ wabaId: '222222', token: 'tok', graphVersion: 'v23.0', language: 'es', example: 'x' }, async () => { throw new Error('down'); }))
      .toMatchObject({ ok: false, reason: 'unavailable' });
  });
  it('Meta\'s answers read back: only this template, its languages and statuses', async () => {
    const m = fake(200, { data: [
      { name: REOPEN_TEMPLATE, language: 'es', status: 'APPROVED', id: '1', rejected_reason: 'NONE' },
      { name: REOPEN_TEMPLATE, language: 'en', status: 'REJECTED', id: '2', rejected_reason: 'INVALID_FORMAT' },
      { name: 'someone_else', language: 'en', status: 'APPROVED', id: '3' },
    ] });
    expect(await reopenTemplateStatuses({ wabaId: '222222', token: 'tok', graphVersion: 'v23.0' }, m.f)).toEqual([
      { language: 'es', status: 'APPROVED', id: '1', reason: null },
      { language: 'en', status: 'REJECTED', id: '2', reason: 'INVALID_FORMAT' },
    ]);
    expect(new URL(m.calls[0]!.url).searchParams.get('name')).toBe(REOPEN_TEMPLATE);
    expect(await reopenTemplateStatuses({ wabaId: '222222', token: 'tok', graphVersion: 'v23.0' }, fake(500, {}).f)).toBeNull();
  });
  it('the template message on the wire: its name, its language, the business\'s name as {{1}}', async () => {
    const sent: { body: string }[] = [];
    const client = whatsappClient({ baseUrl: 'https://graph.facebook.com/v23.0/333333', apiKey: 'tok', authHeaders: { Authorization: 'Bearer tok' },
      fetchImpl: async (_url, init) => { sent.push({ body: init.body }); return { status: 200, text: async () => JSON.stringify({ messages: [{ id: 'wamid.1' }] }) }; } });
    await client.sendTemplate('34600000000', { name: REOPEN_TEMPLATE, language: 'es', params: ['Tienda Sol'] });
    expect(JSON.parse(sent[0]!.body)).toEqual({
      messaging_product: 'whatsapp', recipient_type: 'individual', to: '34600000000', type: 'template',
      template: { name: REOPEN_TEMPLATE, language: { code: 'es' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'Tienda Sol' }] }] },
    });
  });
});

describe('WA-S · the worker, after the 24 hours', () => {
  const REOPEN = { name: REOPEN_TEMPLATE, language: 'es', params: ['Tienda Sol'], text: renderReopen('es', 'Tienda Sol') };
  const run = async (row: Partial<OutboundWorkRow>, ctx: Partial<ConversationSendContext> = {}) => {
    const rows: OutboundWorkRow[] = [{
      id: 'r1', seq: 1, status: 'queued', requiresOrder: true, attempts: 0, sentAt: null, to: '34600000000',
      body: 'Sí, enviamos a Valencia.', origin: 'owner', sendingSince: null, channel: 'whatsapp', ...row,
    } as OutboundWorkRow];
    const log: string[] = [];
    const store: OutboundStore = {
      async load() {
        return { rows, ctx: {
          assignedTo: null, paused: false, lastInboundAt: daysAgo(3), template: 'approved', pilotMode: false, activated: true,
          silenced: false, stopped: false, reopen: REOPEN, ...ctx,
        } };
      },
      async transition(id, to, detail) { log.push(`${id}:${to}${detail ? `(${detail})` : ''}`); },
      async recordProviderId(id, pid) { log.push(`${id}:pid=${pid}`); },
      async scheduleRetry(id, ms) { log.push(`${id}:retry ${ms}`); },
      async deadLetter(id) { log.push(`${id}:dead`); },
      async recordRefusal(id, _to, reason) { log.push(`${id}:refused=${reason}`); },
      async reopenedWith(id, conv, text, kept) { log.push(`${id}:reopened text=${text === REOPEN.text} kept=${kept}`); },
    };
    const templates: unknown[] = [];
    const texts: string[] = [];
    const adapter: ChannelAdapter = {
      kind: 'whatsapp', provider: 'meta', verifyWebhook: () => true, parseWebhook: () => [],
      sendText: async (_to, body) => { texts.push(body); return { ok: true, providerMessageId: 'wamid.text' }; },
      sendTemplate: async (_to, t) => { templates.push(t); return { ok: true, providerMessageId: 'wamid.tpl' }; },
    } as ChannelAdapter;
    const effects = await driveConversationOutbound({ store, adapter, now: () => NOW }, 'conv1');
    return { effects, log, templates, texts };
  };

  it('a reply the owner sent goes as the approved template; the words wait in the box; never as free text', async () => {
    const r = await run({});
    expect(r.templates).toEqual([{ name: REOPEN_TEMPLATE, language: 'es', params: ['Tienda Sol'] }]);
    expect(r.texts).toEqual([]);
    expect(r.log).toEqual(['r1:sending', 'r1:pid=wamid.tpl', 'r1:reopened text=true kept=Sí, enviamos a Valencia.', 'r1:sent']);
    expect(r.effects).toEqual([{ kind: 'sent', id: 'r1', providerMessageId: 'wamid.tpl' }]);
  });
  it('a draft of the assistant\'s the owner approved reopens too', async () => {
    expect((await run({ origin: 'employee', approved: true })).templates).toHaveLength(1);
  });
  // 0136 (the messaging-policy audit, 2026-10-10) — before, origin alone decided, and this went as the template.
  it('a reply the assistant sent alone, that waited past the 24 hours: refused, never the template', async () => {
    const r = await run({ origin: 'employee' });
    expect(r.templates).toEqual([]);
    expect(r.texts).toEqual([]);
    expect(r.effects).toEqual([{ kind: 'canceled', id: 'r1', reason: 'window_needs_owner' }]);
  });
  // D4 (the owner, 2026-10-10) — seven days since their last message, and no template at all.
  it('their last message more than seven days ago: no template, for the owner either', async () => {
    const r = await run({}, { lastInboundAt: daysAgo(8) });
    expect(r.templates).toEqual([]);
    expect(r.texts).toEqual([]);
    expect(r.effects).toEqual([{ kind: 'canceled', id: 'r1', reason: 'window_closed' }]);
    expect((await run({}, { lastInboundAt: daysAgo(6) })).templates).toHaveLength(1);
  });
  it('an automated follow-up, a first message, a picture, or no approved template: refused as before, nothing sent', async () => {
    for (const [row, ctx] of [
      [{ origin: 'employee', automated: true }, {}],
      [{ kind: 'image', mediaUrl: 'https://x/y.jpg' }, {}],
      [{}, { reopen: undefined, template: 'approved' as const }],
    ] as const) {
      const r = await run(row as Partial<OutboundWorkRow>, ctx as Partial<ConversationSendContext>);
      expect(r.templates, JSON.stringify(row)).toEqual([]);
      expect(r.texts).toEqual([]);
      expect(r.effects).toEqual([{ kind: 'canceled', id: 'r1', reason: 'window_needs_owner' }]);
    }
  });
  it('inside the 24 hours nothing changes: the words go as written', async () => {
    const r = await run({}, { lastInboundAt: new Date(NOW.getTime() - 3_600_000) });
    expect(r.texts).toEqual(['Sí, enviamos a Valencia.']);
    expect(r.templates).toEqual([]);
  });
});

// D4 — the owner's own precheck asks the worker's plan, so the seven days bind both in one place.
describe('D4 · one plan for the worker and the owner\'s precheck', () => {
  it('the precheck reads channelSendPlan, never its own copy of the window', async () => {
    const { readFileSync } = await import('node:fs');
    const app = readFileSync(new URL('../../src/api/web/app.ts', import.meta.url), 'utf8');
    const win = app.slice(app.indexOf('const ownerSendWindow = async'), app.indexOf('const ownerSendWindow = async') + 4000);
    expect(win).toContain('channelSendPlan(pre.channel, pre.lastInboundAt, new Date(), templateState).action');
    expect(win).not.toMatch(/sendPlan\(windowState\(/);
  });
});


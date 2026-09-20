import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ASSISTANT_CHANNELS, NAME_MAX, NOTE_MAX, assistantFor, validateAssistant, type Assistant,
} from '../../src/core/owner/assistants.js';
import { assistantFlash, channelsFromForm, renderAssistantsSection } from '../../src/api/web/assistants.js';
import { renderPeople } from '../../src/api/web/people.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { renderConversationDetail, type ConversationDetail } from '../../src/api/web/inbox.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

/**
 * A5 — more than one assistant. v1 as the owner decided it: they differ by
 * name, job and channels, and by nothing that could change what a buyer may be
 * told. These are the rules and the page; Postgres proves the rest.
 */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');

const lily: Assistant = { id: '11111111-1111-4111-8111-111111111111', name: 'Lily', role: 'sales', note: null, channels: [], isDefault: true };
const noor: Assistant = { id: '22222222-2222-4222-8222-222222222222', name: 'Noor', role: 'support', note: null, channels: ['instagram', 'messenger'], isDefault: false };

describe('A5 · what an assistant is', () => {
  it('needs a name and a known job; tidies the name', () => {
    expect(validateAssistant({ name: '  ', role: 'sales', note: '', channels: [] })).toEqual({ ok: false, problem: 'name_missing' });
    expect(validateAssistant({ name: 'x'.repeat(NAME_MAX + 1), role: 'sales', note: '', channels: [] })).toEqual({ ok: false, problem: 'name_long' });
    expect(validateAssistant({ name: 'Noor', role: 'boss', note: '', channels: [] })).toEqual({ ok: false, problem: 'role_invalid' });
    expect(validateAssistant({ name: 'Noor', role: 'sales', note: 'x'.repeat(NOTE_MAX + 1), channels: [] })).toEqual({ ok: false, problem: 'note_long' });
    const ok = validateAssistant({ name: '  Noor   Al  ', role: 'after_sales', note: '  ', channels: [] });
    expect(ok).toEqual({ ok: true, value: { name: 'Noor Al', role: 'after_sales', note: null, channels: [] } });
  });

  it('keeps only real channels, once each', () => {
    const r = validateAssistant({ name: 'Noor', role: 'sales', note: '', channels: ['instagram', 'instagram', 'fax', 'email'] });
    expect(r.ok && r.value.channels).toEqual(['instagram', 'email']);
  });

  it('a form gives one name per box, because a repeated name keeps only its last value', () => {
    expect(channelsFromForm({ channel_instagram: 'on', channel_email: 'on', channel_fax: 'on', channels: 'whatsapp' }))
      .toEqual(['instagram', 'email']);
  });
});

describe('A5 · who answers a conversation', () => {
  it('the one given the channel; otherwise the main one', () => {
    expect(assistantFor([lily, noor], 'instagram')?.name).toBe('Noor');
    expect(assistantFor([lily, noor], 'whatsapp')?.name).toBe('Lily');
  });

  it('the main one claims no channel of its own, whatever its row says', () => {
    const greedy: Assistant = { ...lily, channels: ['instagram'] };
    expect(assistantFor([greedy, noor], 'instagram')?.name).toBe('Noor');
  });

  it('nobody yet is null — read everywhere as "the main one", as before 0059', () => {
    expect(assistantFor([], 'whatsapp')).toBeNull();
  });

  it('is decided once, where a conversation is created, and nowhere else', () => {
    const src = read('src/db/channels.ts');
    expect(src).toMatch(/assistantIdForChannel\(tx, businessId, channel\)/);
    expect(src).toMatch(/insert into conversations \(business_id, client_id, channel, assistant_id\)/);
  });
});

describe('A5 · the section on the team page', () => {
  for (const locale of LOCALES) {
    it(`${locale}: the main one cannot be removed or given channels; the other can`, () => {
      const html = renderAssistantsSection([lily, noor], locale);
      expect(html).not.toContain(`/assistants/${lily.id}/archive`);
      expect(html).toContain(`/assistants/${noor.id}/archive`);
      const lilyForm = html.slice(html.indexOf(`action="/app/settings/people/assistants/${lily.id}"`),
        html.indexOf(`action="/app/settings/people/assistants/${noor.id}"`));
      expect(lilyForm).not.toContain('type="checkbox"');
      for (const c of ASSISTANT_CHANNELS) expect(html).toContain(`name="channel_${c}"`);
      expect(html).not.toMatch(/\{(who|channels|name)\}/);
      // Noor's own channels arrive ticked.
      expect(html).toMatch(/name="channel_instagram" checked/);
    });
  }

  it('is part of the team page only when the caller loaded it', () => {
    const base = { people: [], justIssued: null };
    expect(renderPeople(base, 'en', null)).not.toContain('id="assistants"');
    expect(renderPeople({ ...base, assistants: [lily] }, 'en', null)).toContain('id="assistants"');
  });

  it('says what happened in her words, and never a code name', () => {
    expect(t('en', assistantFlash('saved', 'added'), { who: 'Noor' })).toContain('Noor');
    expect(t('en', assistantFlash('channel_taken', 'saved'))).toMatch(/channel/i);
    expect(t('en', assistantFlash('is_default', 'archived'))).not.toMatch(/is_default|default/);
    expect(assistantFlash('not_found', 'saved')).toBe(assistantFlash('role_invalid', 'saved'));
  });
});

describe('A5 · only the owner decides who answers', () => {
  it('every assistants route passes the owner-only gate for people', () => {
    const src = read('src/api/web/app.ts');
    const routes = [...src.matchAll(/app\.post\('\/app\/settings\/people\/assistants[^']*', async \(req, reply\) => \{\n([^\n]+)\n/g)];
    expect(routes.length).toBe(3);
    for (const r of routes) expect(r[1]).toContain("ownerOnly(req, reply, 'people'");
  });

  it('the migration gives the app no way to erase one', () => {
    const m = read('migrations/0059_assistants.sql');
    expect(m).toMatch(/grant select, insert, update on assistants to nomi_app/i);
    expect(m).not.toMatch(/grant[^;]*delete[^;]*on assistants/i);
    expect(m).toMatch(/assistant_added','assistant_changed','assistant_archived/);
  });
});

describe('A5.4 · handing one buyer to another assistant', () => {
  const base: ConversationDetail = {
    conversationId: '33333333-3333-4333-8333-333333333333', buyer: 'Ahmed', country: 'AE', status: 'awaiting',
    product: { name: null, nameZh: null }, quantity: null, quote: null, order: null, messages: [], pendingDraft: null,
    ownership: 'AI', refusals: [], uncertainSends: [], handoffReasons: [], unheardReason: null, lastHumanAction: null,
    knowledgeUsed: [], rate: null, leadTimeBlocked: null, sampleAsked: null, proof: { quoteId: null, token: null },
  };
  const choices = [{ id: lily.id, name: 'Lily', current: true }, { id: noor.id, name: 'Noor', current: false }];
  const NOW = new Date('2026-09-19T08:00:00Z');

  it('the owner is offered every live assistant, with the one answering now chosen', () => {
    const html = renderConversationDetail({ ...base, assistantChoices: choices }, 'en', NOW, null);
    expect(html).toContain(`action="/app/inbox/${base.conversationId}/assistant"`);
    expect(html).toMatch(new RegExp(`<option value="${lily.id}" selected>Lily</option>`));
    expect(html).toContain(`<option value="${noor.id}">Noor</option>`);
  });

  it('not with one assistant, not to staff, and not on a finished conversation', () => {
    const form = '/assistant"';
    expect(renderConversationDetail(base, 'en', NOW, null)).not.toContain(form);
    expect(renderConversationDetail({ ...base, assistantChoices: [choices[0]!] }, 'en', NOW, null)).not.toContain(form);
    expect(renderConversationDetail({ ...base, assistantChoices: choices }, 'en', NOW, null, { isOwner: false })).not.toContain(form);
    expect(renderConversationDetail({ ...base, status: 'done', assistantChoices: choices }, 'en', NOW, null)).not.toContain(form);
  });

  it('is the only other writer of who answers, is owner-only, and leaves a line in the history', () => {
    const step = read('src/conversations/assistant.ts');
    expect(step).toMatch(/update conversations set assistant_id/);
    expect(step).toMatch(/events\.append\(\s*input\.conversationId as ConversationId, 'assistant_changed'/);
    expect(step).toMatch(/archived_at is null/);
    const app = read('src/api/web/app.ts');
    const route = app.slice(app.indexOf("app.post('/app/inbox/:conversationId/assistant'"));
    expect(route.slice(0, 400)).toContain("ownerOnly(req, reply, 'people', back)");
  });
});

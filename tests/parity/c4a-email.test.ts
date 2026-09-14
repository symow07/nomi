import { describe, it, expect } from 'vitest';
import {
  driveConversationOutbound, type ConversationSendContext, type OutboundStore, type OutboundWorkRow,
} from '../../src/outbound/worker.js';
import type { ChannelAdapter, SendResult } from '../../src/channels/contract.js';
import { emailAdapter } from '../../src/channels/email/adapter.js';
import { fakeMailTransport } from '../../src/channels/email/transport.js';
import { channelSendPlan, channelHasWindow } from '../../src/core/channel/window.js';
import { CHANNEL_REGISTRY, OUTREACH_CHANNELS, type Requirement } from '../../src/core/channel/registry.js';
import { DAILY_OUTBOUND_CEILING, DAILY_OUTREACH_CEILING } from '../../src/core/channel/limits.js';
import type { OutreachInput } from '../../src/core/outreach/gate.js';
import { renderContacts, renderWriteFirst, type ContactsView } from '../../src/api/web/contacts.js';
import type { ContactRow } from '../../src/db/contacts.js';
import { renderReach } from '../../src/api/web/channels.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';

/**
 * C4.a — one e-mail, written by her, sent to one contact.
 *
 * What is on trial is not that a mail can be handed to a transport; a fake
 * transport would accept anything. It is that e-mail arrived WITHOUT a second
 * way out of the building: the same worker, the same gate, the same refusal
 * machinery, choosing a transport by the row's own channel — and that every
 * reason a first message must not go is a refusal she can read, not a send.
 */

const NOW = new Date('2026-09-12T10:00:00Z');
const ADDRESS = 'buyer@example.test';
const VERIFIED: ReadonlySet<Requirement> = new Set(['verified_sending_domain']);

/** Everything the outreach gate needs, all of it saying yes. Tests take one away. */
const facts = (over: Partial<OutreachInput> = {}): OutreachInput => ({
  channel: 'email', availableHere: true, enabled: true, satisfied: VERIFIED,
  consent: { evidence: 'owner_attestation', obtainedAt: NOW, recordedBy: 'Lily' },
  suppression: null, ceilingReached: false, ...over,
});

const mailRow = (over: Partial<OutboundWorkRow> = {}): OutboundWorkRow => ({
  id: 'o1', seq: 1, status: 'queued', requiresOrder: false, attempts: 0, sentAt: null,
  to: ADDRESS, body: 'We make canvas totes.', origin: 'outreach', sendingSince: null,
  channel: 'email', subject: 'Canvas totes from Yiwu', ...over,
});

function store(
  rows: readonly OutboundWorkRow[], ctx: Partial<ConversationSendContext> = {},
  opts: { readonly noOutreach?: boolean } = {},
): OutboundStore & { statuses: string[]; refusals: string[] } {
  const statuses: string[] = [];
  const refusals: string[] = [];
  const full: ConversationSendContext = {
    assignedTo: null, paused: false, lastInboundAt: null, template: 'none', silenced: false,
    // An e-mail conversation, as the store resolves it: no channels row, so
    // activation is not its gate and the WhatsApp allowlist is not its list.
    activated: true, pilotMode: false, recipientAllowed: true, dailyCeilingReached: false,
    outreach: facts(),
    ...ctx,
  };
  // A store that could not resolve the facts leaves the field OUT, which is
  // what the worker must refuse on.
  const { outreach: _dropped, ...withoutOutreach } = full;
  return {
    statuses, refusals,
    load: async () => ({ rows, ctx: opts.noOutreach ? withoutOutreach : full }),
    transition: async (_id, to, detail) => { statuses.push(detail ? `${to}:${detail}` : to); },
    recordProviderId: async () => {},
    scheduleRetry: async () => {},
    deadLetter: async () => {},
    recordRefusal: async (_id, _to, reason) => { refusals.push(reason); },
  };
}

function whatsapp(): ChannelAdapter & { texts: string[] } {
  const texts: string[] = [];
  return {
    kind: 'whatsapp', provider: 'test', texts,
    verifyWebhook: () => true, parseWebhook: () => [],
    sendText: async (_to, body) => { texts.push(body); return { ok: true, providerMessageId: 'wamid.1' }; },
  };
}

const HEADERS = { 'List-Unsubscribe': '<https://nomi.test/u?t=x>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };

function rig(opts: {
  readonly outcome?: (m: { to: string }) => SendResult;
  readonly headers?: Readonly<Record<string, string>>;
  readonly withEmail?: boolean;
} = {}) {
  const transport = fakeMailTransport(opts.outcome);
  const wa = whatsapp();
  const byChannel: Record<string, ChannelAdapter> = { whatsapp: wa };
  if (opts.withEmail !== false) byChannel['email'] = emailAdapter({ transport });
  const locales: string[] = [];
  const drive = (s: OutboundStore) => driveConversationOutbound({
    store: s, adapter: wa, adapters: (k) => byChannel[k],
    mailHeaders: (_row, o) => { locales.push(o.locale); return opts.headers ?? HEADERS; },
    now: () => NOW,
  }, 'c1');
  return { transport, wa, drive, locales };
}

describe('C4.a · the window is the channel’s, not WhatsApp’s', () => {
  it('a channel with no reply window has nothing to be outside of', () => {
    expect(channelHasWindow(CHANNEL_REGISTRY.email.replyWindowHours)).toBe(false);
    expect(channelSendPlan('email', null, NOW, 'none').action).toBe('send_free');
  });

  it('WhatsApp still waits for the buyer, exactly as before', () => {
    expect(channelSendPlan('whatsapp', null, NOW, 'none').action).toBe('wait_for_buyer');
    const recent = new Date(NOW.getTime() - 3600_000);
    expect(channelSendPlan('whatsapp', recent, NOW, 'none').action).toBe('send_free');
  });

  it('a channel the registry does not know is WINDOWED — the refusing answer, not the open one', () => {
    expect(channelSendPlan('carrier-pigeon', null, NOW, 'none').action).toBe('wait_for_buyer');
  });

  it('the rule reads the registry, so every channel answers by its own entry', () => {
    for (const ch of OUTREACH_CHANNELS) {
      const expected = CHANNEL_REGISTRY[ch].replyWindowHours === null ? 'send_free' : 'wait_for_buyer';
      expect(channelSendPlan(ch, null, NOW, 'none').action, ch).toBe(expected);
    }
  });
});

describe('C4.a · the adapter and the transport', () => {
  it('the adapter will not send a mail without a subject — it refuses rather than inventing one', async () => {
    const a = emailAdapter({ transport: fakeMailTransport() });
    expect(a.kind).toBe('email');
    const r = await a.sendText(ADDRESS, 'hello');
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.retryable).toBe(false);
  });

  it('inbound mail is refused outright until C4.c, never half-parsed', () => {
    const a = emailAdapter({ transport: fakeMailTransport() });
    expect(a.verifyWebhook('{}', 'sha256=anything')).toBe(false);
    expect(a.parseWebhook({})).toEqual([]);
  });

  it('the fake transport RECORDS what would have left, and names every message it accepted', async () => {
    const tr = fakeMailTransport();
    const r1 = await tr.send({ to: ADDRESS, subject: 's', text: 'b', headers: HEADERS });
    const r2 = await tr.send({ to: ADDRESS, subject: 's', text: 'b', headers: {} });
    expect(r1.ok && r2.ok && r1.providerMessageId !== r2.providerMessageId).toBe(true);
    expect(r1.ok && r1.providerMessageId.length).toBeGreaterThan(0);
    expect(tr.sent.map((m) => m.headers)).toEqual([HEADERS, {}]);
  });

  it('A RESTART DOES NOT REUSE AN ID — the column is unique across every process that ever sent', async () => {
    // Two transports stand for two boots of the same installation. A counter
    // per instance gave both "fake-mail-1", the second insert violated the
    // unique constraint after the mail had gone, and the job re-sent it.
    const before = await fakeMailTransport().send({ to: ADDRESS, subject: 's', text: 'b', headers: {} });
    const after = await fakeMailTransport().send({ to: ADDRESS, subject: 's', text: 'b', headers: {} });
    expect(before.ok && after.ok).toBe(true);
    expect(before.ok && after.ok && before.providerMessageId !== after.providerMessageId).toBe(true);
  });
});

describe('C4.a · a first e-mail goes out through the one send path', () => {
  it('SENT: through sendMail, with her subject, her words and the way out', async () => {
    const r = rig();
    const s = store([mailRow()]);
    const effects = await r.drive(s);
    expect(effects).toContainEqual(expect.objectContaining({ kind: 'sent', id: 'o1' }));
    expect(r.transport.sent).toHaveLength(1);
    const m = r.transport.sent[0]!;
    expect({ to: m.to, subject: m.subject, text: m.text }).toEqual({
      to: ADDRESS, subject: 'Canvas totes from Yiwu', text: 'We make canvas totes.',
    });
    expect(m.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(r.wa.texts, 'an e-mail left as a WhatsApp text').toEqual([]);
    expect(s.statuses).toEqual(['sending', 'sent']);
  });

  it('the unsubscribe page is in the BUYER’s language when the store knows it, and says when it does not', async () => {
    const known = rig();
    await known.drive(store([mailRow()], { buyerLocale: 'ar' }));
    expect(known.locales).toEqual(['ar']);
    const unknown = rig();
    await unknown.drive(store([mailRow()]));
    expect(unknown.locales).toEqual(['en']);
  });

  it('a WhatsApp reply beside it is untouched — e-mail changed nothing for every message that exists today', async () => {
    const r = rig();
    const s = store([{
      id: 'w1', seq: 1, status: 'queued', requiresOrder: false, attempts: 0, sentAt: null,
      to: '971500001111', body: 'Yes, 500 pcs.', origin: 'employee', sendingSince: null,
    }], { lastInboundAt: new Date(NOW.getTime() - 60_000), pilotMode: true, recipientAllowed: true });
    const effects = await r.drive(s);
    expect(effects).toContainEqual(expect.objectContaining({ kind: 'sent' }));
    expect(r.wa.texts).toEqual(['Yes, 500 pcs.']);
    expect(r.transport.sent).toEqual([]);
  });

  it('a single-adapter caller still serves only its own kind: a mail row is refused, not sent as text', async () => {
    const wa = whatsapp();
    const s = store([mailRow()]);
    const effects = await driveConversationOutbound({ store: s, adapter: wa, now: () => NOW }, 'c1');
    expect(effects).toContainEqual(expect.objectContaining({ kind: 'canceled', reason: 'channel_unavailable' }));
    expect(wa.texts).toEqual([]);
  });
});

describe('C4.a · every reason a first message must not go is a refusal she can read', () => {
  const refusedFor = async (
    reason: string, rows: readonly OutboundWorkRow[], ctx: Partial<ConversationSendContext> = {},
    opts: Parameters<typeof rig>[0] & { readonly noOutreach?: boolean } = {},
  ) => {
    const r = rig(opts);
    const s = store(rows, ctx, { noOutreach: opts.noOutreach === true });
    const effects = await r.drive(s);
    expect(effects, reason).toContainEqual(expect.objectContaining({ kind: 'canceled', reason }));
    expect(s.refusals, `${reason} was not recorded where she reads it`).toEqual([reason]);
    expect(r.transport.sent, `${reason} still left the building`).toEqual([]);
  };

  it('no consent', () => refusedFor('no_consent', [mailRow()], { outreach: facts({ consent: null }) }));
  it('suppressed — even with consent on record', () => refusedFor('suppressed', [mailRow()], {
    outreach: facts({ suppression: { reason: 'unsubscribed', at: NOW } }),
  }));
  it('she has not turned writing first on', () => refusedFor('outreach_not_enabled', [mailRow()], {
    outreach: facts({ enabled: false }),
  }));
  it('her sending domain is not verified', () => refusedFor('channel_cannot_initiate', [mailRow()], {
    outreach: facts({ satisfied: new Set() }),
  }));
  it('over her daily cap', () => refusedFor('outreach_ceiling', [mailRow()], {
    outreach: facts({ ceilingReached: true }),
  }));
  it('the facts could not be resolved at all — refused, never waved through', () =>
    refusedFor('outreach_unchecked', [mailRow()], {}, { noOutreach: true }));
  it('a mail with no subject', () => refusedFor('subject_missing', [mailRow({ subject: null })]));
  it('an outreach mail that cannot carry a way out', () =>
    refusedFor('no_unsubscribe', [mailRow()], {}, { headers: {} }));
  it('no transport for its channel in this build', () =>
    refusedFor('channel_unavailable', [mailRow()], {}, { withEmail: false }));
  it('the ops kill switch does not bind her own first message — it silences the employee, not her', async () => {
    // Outreach is her typing, like an owner reply: `silenced` binds the employee only.
    const r = rig();
    const s = store([mailRow()], { silenced: true });
    expect(await r.drive(s)).toContainEqual(expect.objectContaining({ kind: 'sent' }));
  });
});

describe('C4.a · a failed mail is classified like any other send', () => {
  it('a permanent rejection is not retried', async () => {
    const r = rig({ outcome: () => ({ ok: false, retryable: false, error: '550 no such user' }) });
    const effects = await r.drive(store([mailRow()]));
    expect(effects).toContainEqual(expect.objectContaining({ kind: 'failed_permanent' }));
  });

  it('a temporary one is', async () => {
    const r = rig({ outcome: () => ({ ok: false, retryable: true, error: '421 try later' }) });
    const effects = await r.drive(store([mailRow()]));
    expect(effects).toContainEqual(expect.objectContaining({ kind: 'retry_scheduled' }));
  });
});

describe('C4.a · her ceiling', () => {
  it('first messages are capped far below replies — her address is the thing at risk', () => {
    expect(DAILY_OUTREACH_CEILING).toBeGreaterThan(0);
    expect(DAILY_OUTREACH_CEILING * 4).toBeLessThanOrEqual(DAILY_OUTBOUND_CEILING);
  });

  it('the number sits beside the switch, for her and not for staff, and says the default', () => {
    const owner = renderReach('en', VERIFIED, new Map([['email', true]]), null, undefined, new Map([['email', 12]]));
    expect(owner).toContain('action="/app/channels/outreach/cap"');
    expect(owner).toMatch(/name="cap"[^>]*value="12"/);
    expect(owner).toContain(`placeholder="${DAILY_OUTREACH_CEILING}"`);
    const staff = renderReach('en', VERIFIED, new Map([['email', true]]), null, { isOwner: false });
    expect(staff).not.toContain('/app/channels/outreach/cap');
  });

  it('no box where a first message cannot go — a limit on nothing is not a control', () => {
    // WhatsApp's requirements are unmet here, so its card has the switch's
    // state but no ceiling to set.
    const html = renderReach('en', VERIFIED, new Map([['whatsapp', true]]));
    expect(html.match(/action="\/app\/channels\/outreach\/cap"/g) ?? []).toHaveLength(1);
    expect(renderReach('en', new Set(), new Map())).not.toContain('/app/channels/outreach/cap');
  });

  it('no cap stated reads as empty, never as a number she did not choose', () => {
    const html = renderReach('en', VERIFIED, new Map([['email', true]]));
    expect(html).toMatch(/name="cap"[^>]*value=""/);
  });
});

describe('C4.a · the button appears only where the gate has said yes', () => {
  const row = (over: Partial<ContactRow>): ContactRow => ({
    id: 'k1', channel: 'email', identity: ADDRESS, displayName: 'Ahmed', company: null,
    source: 'manual', firstSeen: NOW, archivedAt: null,
    consent: { evidence: 'owner_attestation', obtainedAt: NOW, recordedBy: 'Lily' },
    suppression: null, ...over,
  });
  const view = (contacts: ContactRow[], over: Partial<ContactsView> = {}): ContactsView => ({
    contacts, outreach: new Map([['email', true]]), satisfied: VERIFIED, ...over,
  });
  const WRITE = '/app/contacts/write?';

  it('yes: consent, switch on, domain verified', () => {
    expect(renderContacts(view([row({})]), 'en', null)).toContain(WRITE);
  });
  it('no consent — the button to record it instead, not a send that would be refused', () => {
    expect(renderContacts(view([row({ consent: null })]), 'en', null)).not.toContain(WRITE);
  });
  it('suppressed — nothing', () => {
    expect(renderContacts(view([row({ suppression: { reason: 'bounced', at: NOW } })]), 'en', null))
      .not.toContain(WRITE);
  });
  it('switch off, or domain unverified — nothing', () => {
    expect(renderContacts(view([row({})], { outreach: new Map() }), 'en', null)).not.toContain(WRITE);
    expect(renderContacts(view([row({})], { satisfied: new Set() }), 'en', null)).not.toContain(WRITE);
  });

  it('the composer asks for both halves of a mail and says what is true of it, in every locale', () => {
    for (const locale of LOCALES) {
      const html = renderWriteFirst({ channel: 'email', identity: ADDRESS, displayName: 'Ahmed' }, locale);
      expect(html).toContain('action="/app/contacts/write"');
      expect(html).toMatch(/name="subject"[^>]*required/);
      expect(html).toMatch(/<textarea name="body"[^>]*required/);
      expect(html).toContain(`value="${ADDRESS}"`);
      expect(html, locale).toContain(t(locale, 'contacts.write.hint').slice(0, 12));
    }
  });

  it('what she typed comes back to her when the form was the problem', () => {
    const html = renderWriteFirst({ channel: 'email', identity: ADDRESS, displayName: null }, 'en', {
      draft: { subject: 'Totes', body: '' }, flash: 'Write both.',
    });
    expect(html).toMatch(/name="subject"[^>]*value="Totes"/);
    expect(html).toContain('role="status"');
  });
});

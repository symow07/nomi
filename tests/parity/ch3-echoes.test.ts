import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseMetaMessaging } from '../../src/channels/meta/messaging.js';
import { META_PAGE_FIELDS } from '../../src/channels/meta/connect.js';
import { echoIsOurs, ECHO_SETTLE_SECONDS } from '../../src/pipeline/echo.js';

/**
 * CH3 — Meta's echoes: what the business's own account sent, coming back.
 * Never a turn; an event of its own, the account as the sender and the
 * customer as the recipient, with the app it came from. Over Postgres:
 * tests/integration/echoes.test.ts.
 */

const payload = (object: string, message: Record<string, unknown>, from = 'PAGE_1', to = 'PSID_1') => ({
  object, entry: [{ id: from, time: 1_700_000_000_000, messaging: [{ sender: { id: from }, recipient: { id: to }, timestamp: 1_700_000_000_000, message }] }],
});

describe('CH3 · the parser', () => {
  it('an echo is its own event: never a message to answer', () => {
    const events = parseMetaMessaging('messenger', payload('page', { mid: 'm.1', text: 'Yes, we ship.', is_echo: true, app_id: 263902037430900 }));
    expect(events).toEqual([{
      kind: 'echo', eventId: 'm.1', dedupKey: 'echo:m.1', waId: 'PSID_1', phoneNumberId: 'PAGE_1',
      occurredAt: new Date(1_700_000_000_000), text: 'Yes, we ship.', received: 'text', appId: '263902037430900',
    }]);
  });
  it('on Instagram too, and with no app id when Meta gives none', () => {
    const [e] = parseMetaMessaging('instagram', payload('instagram', { mid: 'm.2', text: 'ok', is_echo: true }, 'IG_1', 'IGSID_1'));
    expect(e).toMatchObject({ kind: 'echo', waId: 'IGSID_1', phoneNumberId: 'IG_1', appId: null });
  });
  it('a customer\'s message is unchanged', () => {
    const [e] = parseMetaMessaging('messenger', payload('page', { mid: 'm.3', text: 'hi' }, 'PSID_1', 'PAGE_1'));
    expect(e).toMatchObject({ kind: 'message', waId: 'PSID_1', phoneNumberId: 'PAGE_1', text: 'hi' });
  });
});

describe('CH3 · ours or the owner\'s', () => {
  it('ours: from Nomi\'s app, or an id a send of ours recorded; anything else is the owner\'s', () => {
    expect(echoIsOurs({ appId: '111' }, ['111'], false)).toBe(true);
    expect(echoIsOurs({ appId: null }, ['111'], true)).toBe(true);
    expect(echoIsOurs({ appId: '263902037430900' }, ['111'], false)).toBe(false);
    expect(echoIsOurs({ appId: null }, [], false)).toBe(false);
  });
  it('an echo is read only after our own send has had time to record its id', () => {
    expect(ECHO_SETTLE_SECONDS).toBeGreaterThanOrEqual(30);
    const main = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8');
    expect(main).toMatch(/QUEUES\.echo, \{[\s\S]{0,300}startAfter: overrides\?\.echoSettleSeconds \?\? ECHO_SETTLE_SECONDS/);
  });
  it('a Page is subscribed to the echoes when it is connected', () => {
    expect(META_PAGE_FIELDS.split(',')).toEqual(['messages', 'messaging_postbacks', 'message_echoes']);
  });
});

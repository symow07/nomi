import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderOwnerAlert, interrupts, DELETION_ALERT_KINDS, deletionAlertLink } from '../../src/pipeline/notify.js';
import { renderCustomerFile, DELETION_FLAG_DAYS, type CustomerFile } from '../../src/api/web/conversations.js';
import { renderOperationsHome, type OperationsSnapshot } from '../../src/api/web/operations.js';
import { NOTHING_TODAY } from '../../src/api/web/today.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, tn, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';
import { OWNER_VIEW } from '../../src/core/conversation/people.js';
// @ts-expect-error — the operator tool, plain JS on purpose (tools/ is not type-checked).
import { RULES } from '../../tools/erase-buyer.mjs';
import { withoutIsolates } from './isolates.js';

/**
 * D4 (the owner's decision, 2026-10-12; 0147) — A DELETION REQUEST NOBODY
 * ANSWERS IS CHASED: the owner is reminded at 7 days and again at 30, the app
 * flags it at 60, and every chase is recorded. Nomi never erases on its own —
 * the business is the controller. The database half (what is claimed, once,
 * and recorded) is tests/integration/deletion-chase.test.ts.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (f: string) => readFileSync(`${ROOT}${f}`, 'utf8');
const MIGRATION = read('migrations/0147_deletion_chases.sql');
const DAY = 86_400_000;
const NOW = new Date('2026-12-01T10:00:00Z');
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

describe('D4 · the chase is recorded, once per step, and deletes nothing', () => {
  it('the three steps, the furthest one due only, each written once', () => {
    expect(MIGRATION).toMatch(/step\s+text not null check \(step in \('7d', '30d', '60d'\)\)/);
    expect(MIGRATION).toMatch(/unique \(subject, subject_id, step\)/);
    expect(MIGRATION).toMatch(/values \('7d'::text, interval '7 days', 1\), \('30d', interval '30 days', 2\), \('60d', interval '60 days', 3\)/);
    expect(MIGRATION).toMatch(/distinct on \(w\.subject, w\.id\)[\s\S]*order by w\.subject, w\.id, s\.rank desc/);
    expect(MIGRATION).toMatch(/on conflict \(subject, subject_id, step\) do nothing/);
    // Its result columns share the tables' names: without this every claim fails as "ambiguous" (found by the integration test).
    expect(MIGRATION).toContain('#variable_conflict use_column');
    // A request recorded from a noted message carries the message's chases.
    expect(MIGRATION).toMatch(/c\.subject = 'ask'[\s\S]*a\.request_id = f\.request_id/);
  });

  it('waiting means waiting for the owner: a noted request not yet decided, or a recorded one not carried out', () => {
    expect(MIGRATION).toMatch(/from deletion_asks a where a\.state = 'waiting'/);
    expect(MIGRATION).toMatch(/from deletion_requests r where r\.scope = 'buyer' and r\.state = 'open'/);
  });

  it('Nomi never erases: the migration changes no customer row, and the app may only read the record', () => {
    // The only write is the chase record itself.
    const writes = [...MIGRATION.matchAll(/\b(insert into|update|delete from)\s+([a-z_]+)/gi)].map((m) => m[2]);
    expect(writes.filter((w) => w !== 'deletion_chases' && w !== '_migrations')).toEqual([]);
    expect(MIGRATION).toMatch(/grant select on deletion_chases to nomi_app;/);
    expect(MIGRATION).not.toMatch(/grant (insert|update|delete)[^;]*deletion_chases/);
    expect(MIGRATION).toMatch(/for select using \(business_id = current_business_id\(\)\)/);
  });

  it('the record holds ids and dates only, and the erasure tools have decided it (it outlives the erasure that answers it)', () => {
    const table = /create table if not exists deletion_chases \(([\s\S]*?)\n\);/.exec(MIGRATION)![1]!;
    const cols = [...table.matchAll(/^\s+([a-z_]+)\s+(uuid|text|timestamptz)/gm)].map((m) => m[1]);
    expect(cols).toEqual(['id', 'business_id', 'subject', 'subject_id', 'step', 'asked_at', 'at']);
    expect((RULES as Record<string, { do: string }>)['deletion_chases']?.do).toBe('unrelated');
    expect(MIGRATION).toMatch(/\('deletion_chases', 'unrelated'/);
  });

  it('once a day: 7 and 30 days remind the owner; 60 sends nothing (the app flags it)', () => {
    const main = read('src/main.ts');
    expect(main).toContain("await boss.schedule(QUEUES.deletionChase, '15 7 * * *', {});");
    expect(main).toContain("if (c.step === '60d') continue;");
    // Every alert goes through `sendAlert` since the time-to-send guard (its priority comes from its kind).
    expect(main).toContain("await sendAlert(boss, { businessId: c.business_id, kind: 'deletion_reminder', conversationId: null } satisfies NotifyJob);");
    expect(read('src/pipeline/notify.ts')).toContain("mailOwnerAlways: job.kind === 'deletion_requested' || job.kind === 'deletion_reminder',");
    expect(interrupts('deletion_reminder')).toBe(true);
  });
});

describe('D4 · a deletion alert carries no customer data (the owner, 2026-10-12)', () => {
  it('"a deletion request is waiting, open Nomi" and nothing more — the first alert and the reminders alike, in five languages', () => {
    const said = { en: 'A deletion request is waiting. Open Nomi.', zh: '有一条删除要求在等待。请打开 Nomi。',
      ar: 'طلب حذف بانتظار الرد. يُرجى فتح Nomi.', es: 'Hay una solicitud de borrado esperando. Abre Nomi.',
      fr: 'Une demande de suppression attend. Ouvrez Nomi.' } as const;
    for (const l of LOCALES) {
      for (const kind of DELETION_ALERT_KINDS) {
        const text = withoutIsolates(renderOwnerAlert(l, kind, 'Shop'));
        expect(text, `${l} ${kind}`).toBe(said[l]);
        // No date, no count, no name: nothing that could say who asked or when.
        expect(text, `${l} ${kind}`).not.toMatch(/\d|\{|\}|Shop/);
        const subject = t(l, `notify.${kind}.subject` as MessageKey);
        expect(subject, `${l} ${kind}`).not.toMatch(/\d|\{|\}/);
      }
    }
    expect([...DELETION_ALERT_KINDS].sort()).toEqual(['deletion_reminder', 'deletion_requested']);
  });
  it('its link opens Your data — never a conversation — on every way it leaves', () => {
    expect(deletionAlertLink('https://app.example.test/')).toBe('https://app.example.test/app/settings/data#buyers');
    const notify = read('src/pipeline/notify.ts');
    // The conversation is dropped before anything reads it, so neither the words, the link, the
    // e-mail, the phone alert nor the WhatsApp text can carry it.
    expect(notify).toContain('const conversationId = !bare && job.conversationId && UUID.test(job.conversationId) ? job.conversationId : null;');
    expect(notify).toMatch(/: bare \? deletionAlertLink\(deps\.publicBaseUrl\)/);
    expect(notify).toContain("const text = !link ? words : bare ? `${words}\\n\\n${link}` :");
    expect(notify).toContain('sendPush(phone, { title: subject, body: words, url: link }');
  });
});

const file = (over: Partial<CustomerFile> = {}): CustomerFile => ({
  conversationId: 'c1', buyer: 'Ahmed', country: 'AE', channel: 'whatsapp',
  status: { t: 'talking' }, statusTone: 'ok', needsOwner: false,
  profile: { firstContact: null, products: [], quoteCount: 0, orderCount: 0 },
  timeline: [],
  context: { products: [], latestQuote: null, order: null, corrections: [] },
  ...over,
});
const ask = (askedAt: Date) => ({ id: 'a1', askedAt, asks: 1, conversationId: 'c1', words: 'Please delete my data', buyer: 'Ahmed' });
const section = (f: CustomerFile, l: (typeof LOCALES)[number]) => {
  const html = withoutIsolates(renderCustomerFile(f, l, NOW, null, OWNER_VIEW));
  return html.slice(html.indexOf('id="deletion"'));
};

describe('D4 · at 60 days the app flags it, and still decides nothing', () => {
  it('the customer’s page: a noted request, or a recorded one not carried out, flagged from day 60', () => {
    expect(DELETION_FLAG_DAYS).toBe(60);
    for (const l of LOCALES) {
      const flag = esc(t(l, 'conv.deletion.waiting60'));
      expect(section(file({ deletionAsk: ask(ago(60)) }), l), l).toContain(flag);
      expect(section(file({ deletionAsk: ask(ago(59)) }), l), l).not.toContain(flag);
      expect(section(file({ deletion: { state: 'open', askedAt: ago(75), closedAt: null, closedNote: null } }), l), l).toContain(flag);
      expect(section(file({ deletion: { state: 'open', askedAt: ago(20), closedAt: null, closedNote: null } }), l), l).not.toContain(flag);
      // Answered is answered: a done request is never flagged, however old.
      expect(section(file({ deletion: { state: 'done', askedAt: ago(90), closedAt: ago(80), closedNote: null } }), l), l).not.toContain(flag);
      // The flag adds no act: the same two forms as before.
      const flagged = section(file({ deletionAsk: ask(ago(61)) }), l);
      expect([...flagged.matchAll(/<form /g)].length, l).toBe(2);
    }
  });

  const today: OperationsSnapshot = {
    range: 'today',
    attention: { pendingApprovals: 0, handoffs: 0, ownerHandling: 0, blockedMessages: 0, deletionAsks: 0, deletionAsksLong: 1 },
    activity: { handled: 0, draftsCreated: 0, corrections: 0 },
    knowledge: { openGaps: 0, recentCorrections: 0, recentlyTaught: 0 },
    channel: { status: 'connected', provider: 'meta' }, budget: null,
    hasAttention: true,
  };
  const QUIET = NOTHING_TODAY(new Date('2026-12-01T08:00:00Z'));

  it('Today: its own line, a door to Your data — and never "caught up" over it (a recorded request is on no other line)', () => {
    for (const l of LOCALES) {
      const html = withoutIsolates(renderOperationsHome(today, l, QUIET));
      const first = html.slice(html.indexOf('aria-labelledby="today-now"'), html.indexOf('</section>', html.indexOf('aria-labelledby="today-now"')));
      expect(first, l).toContain(esc(tn(l, 'today.deletion.long', 1)));
      expect(first, l).toContain('href="/app/settings/data#buyers"');
      expect(first, l).not.toContain(esc(t(l, 'today.calm.title')));
      expect(first, l).not.toContain(esc(t(l, 'today.needs.none')));
    }
    const none = withoutIsolates(renderOperationsHome({ ...today, attention: { ...today.attention, deletionAsksLong: 0 } }, 'en', QUIET));
    expect(none).not.toContain(esc(tn('en', 'today.deletion.long', 1)));
  });

  it('the count is of both kinds, from day 60', () => {
    const ops = read('src/api/web/operations.ts');
    expect(ops).toMatch(/from deletion_asks where business_id = \$\{B\} and state = 'waiting'\s+and asked_at <= now\(\) - interval '60 days'/);
    expect(ops).toMatch(/from deletion_requests where business_id = \$\{B\} and scope = 'buyer' and state = 'open'\s+and asked_at <= now\(\) - interval '60 days'/);
  });
});

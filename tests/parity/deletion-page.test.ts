import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderDataDeletion, renderPrivacy } from '../../src/api/web/legal.js';
import { DEFAULT_PROCESSOR, HOSTING } from '../../src/core/legal/processors.js';
import { renderCustomerFile, type CustomerFile } from '../../src/api/web/conversations.js';
import { renderDataRights, buyerDeletionNote, BUYER_NOTE_MAX, type BuyerDeletionRequest } from '../../src/api/web/dataRights.js';
import { renderOwnerAlert, OPERATOR_ALERT_KINDS } from '../../src/pipeline/notify.js';
import { DELETION_DAYS, deletionDueBy, deletionOverdue } from '../../src/core/ops/deletions.js';
import { QUEUES } from '../../src/queue/boss.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { messages, t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { formatDate } from '../../src/core/owner/i18n/format.js';
import { esc } from '../../src/api/web/layout.js';
import { OWNER_VIEW } from '../../src/core/conversation/people.js';
import { withoutIsolates } from './isolates.js';

/**
 * CC-02a — /data-deletion SAYS WHAT HAPPENS, AND NOTHING THE CODE DOES NOT DO.
 *
 * The audit's P0: the page promised that a person at the business removes a
 * buyer's records within 30 days and tells them "on the same channel", when
 * the business could not record the request, nothing counted the days and
 * nothing told anyone. The owner's decision: the page describes what actually
 * happens, and states no promise the code cannot keep.
 *
 * So this holds, in all three languages: the 30 days, that the BUSINESS
 * records the request, that Nomi's OPERATOR carries it out by hand, what is
 * deleted and what is kept — and holds OUT every promise that was never kept.
 * Each negative assertion is run against the old copy first (a negative
 * control), so a pattern that could never fire is not mistaken for coverage.
 */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ');
const page = (l: Locale, email: string | null = 'privacy@nomi.test') => withoutIsolates(renderDataDeletion(l, email));

/** The page as it read before CC-02a, verbatim, for the negative controls. */
const OLD: Record<Locale, string> = {
  en: 'Delete your data You can have everything a business kept about you through Nomi removed. '
    + 'Ask. From the Instagram, Facebook or WhatsApp account you wrote from, send the business a message saying you want your data deleted — or write to the address below from the e-mail address you used. '
    + 'A person at the business receives the request and removes your records by hand — this product deletes nothing on its own. It is done within 30 days, and you are told on the same channel when it is. '
    + 'What stays: records the business must keep by law, such as an invoice for an order you placed; and the copies Meta itself holds, which you manage in your own Instagram or Facebook settings. '
    + 'Removing Nomi from your Meta account settings stops new messages from reaching it. It does not remove what was already kept — ask for that here.',
  zh: '删除你的数据 商家通过 Nomi 保存的关于你的一切，都可以删除。'
    + '提出要求。用你当时写信的 Instagram、Facebook 或 WhatsApp 账号给商家发一条消息，说你要删除数据；或者用你当时使用的邮箱，写信到下面的地址。'
    + '商家的人收到请求后，手动删除你的记录——产品本身不会自己删掉任何记录。30 天内完成，完成后用同一个渠道告诉你。'
    + '会保留的：商家依法必须留存的记录，比如你下过的订单的发票；以及 Meta 自己保存的副本，那部分在你自己的 Instagram 或 Facebook 设置里管理。',
  ar: 'حذف بياناتك يمكنك حذف كل ما حفظته شركة عنك عبر Nomi. '
    + 'الطلب: رسالة إلى الشركة من حساب إنستغرام أو فيسبوك أو واتساب الذي جرت منه المراسلة، فيها طلب حذف بياناتك — أو رسالة إلى العنوان أدناه من عنوان البريد المستخدَم في المراسلة. '
    + 'يستلم شخص في الشركة الطلب ويحذف سجلاتك يدويًا — هذا المنتج لا يحذف شيئًا من تلقاء نفسه. يتم ذلك خلال 30 يومًا، ويصل إشعار بالانتهاء على القناة نفسها. '
    + 'ما يبقى: السجلات التي يلزم الشركة الاحتفاظ بها قانونًا، مثل فاتورة طلب شراء منك؛ والنسخ التي تحتفظ بها Meta نفسها، وإدارتها من إعدادات إنستغرام أو فيسبوك الخاصة بك.',
};

/**
 * What the page must state, per language: the contract the operator's tool
 * implements, named by the words that carry it.
 */
const MUST: Record<Locale, Record<string, RegExp>> = {
  en: {
    thirtyDays: /within 30 days of the business recording the request/,
    businessRecords: /The business records your request in Nomi/,
    operatorByHand: /Nomi's operator[^.]*carries out the deletion by hand/,
    doneSeenByBusiness: /the business sees it marked as done/,
    erasedIdentity: /Who you are on every channel/,
    erasedMessages: /Every message between you and the business/,
    erasedPrepared: /Replies, quotes and sample requests prepared for you/,
    erasedNotes: /Notes and signals about your conversations/,
    erasedConversations: /except what is needed to keep an order/,
    keptOrders: /Orders you placed[^.]*without your contact details or your messages/,
    keptDoNotContact: /never written to again/,
    keptRecord: /A record that you asked, and when it was done/,
    keptMeta: /copies Meta itself holds/,
  },
  zh: {
    thirtyDays: /记录要求后的 30 天内/,
    businessRecords: /商家在 Nomi 里记录你的要求/,
    operatorByHand: /Nomi 的运营方[^。]*手动执行删除/,
    doneSeenByBusiness: /商家会在 Nomi 里看到这条要求已完成/,
    erasedIdentity: /你在各个渠道上的身份/,
    erasedMessages: /往来的每一条消息/,
    erasedPrepared: /回复、报价和样品申请/,
    erasedNotes: /备注和标记/,
    erasedConversations: /为保留你下过的订单所必需的部分除外/,
    keptOrders: /你下过的订单[^。]*不再关联你的联系方式和消息/,
    keptDoNotContact: /不会再向这个地址发送/,
    keptRecord: /你提出过删除要求，以及何时完成/,
    keptMeta: /Meta 自己保存的副本/,
  },
  ar: {
    thirtyDays: /خلال 30 يومًا من تسجيل الشركة للطلب/,
    businessRecords: /تسجّل الشركة الطلب في Nomi/,
    operatorByHand: /ينفّذ مشغّل Nomi[^.]*يدويًا/,
    doneSeenByBusiness: /يظهر الطلب في Nomi لدى الشركة على أنه منفَّذ/,
    erasedIdentity: /هويتك على كل قناة/,
    erasedMessages: /كل رسالة متبادلة بينك وبين الشركة/,
    erasedPrepared: /الردود والعروض وطلبات العيّنات/,
    erasedNotes: /الملاحظات والإشارات/,
    erasedConversations: /إلا ما يلزم للاحتفاظ بطلب شراء/,
    keptOrders: /طلبات الشراء المقدَّمة منك[^.]*دون بيانات التواصل معك ودون رسائلك/,
    keptDoNotContact: /عدم المراسلة/,
    keptRecord: /سجلّ بتقديم الطلب وتاريخ تنفيذه/,
    keptMeta: /النسخ التي تحتفظ بها Meta نفسها/,
  },
};

/** What the page must never say again: a confirmation sent to the buyer, "the same channel", anything instant or automatic. */
const NEVER: Record<Locale, readonly RegExp[]> = {
  en: [/same channel/i, /we will (tell|notify|confirm|let you know)/i, /you (are|will be|get) (told|notified)/i,
       /(receive|get|are sent) a confirmation/i, /confirm(ed|ation)? (to you|on the)/i, /automatic/i,
       /immediately/i, /instantly/i, /right away/i],
  zh: [/同一个渠道/, /同一渠道/, /会(通知|告诉)你/, /给你确认/, /自动/, /立即/, /立刻/, /马上/],
  ar: [/القناة نفسها/, /نفس القناة/, /يصل إشعار/, /سنبلغك|سنخبرك|سنعلمك/, /تلقائي/, /فورًا|فورا|على الفور|فوري/],
};

/** The one promise the old page made in every language: a confirmation on "the same channel". */
const SAME_CHANNEL: Record<Locale, RegExp> = { en: /same channel/i, zh: /同一个渠道/, ar: /القناة نفسها/ };

describe('CC-02a · /data-deletion states the contract, in every language', () => {
  for (const l of LOCALES) {
    it(`${l}: the 30 days, the business records it, the operator carries it out by hand, what goes and what stays`, () => {
      const body = text(page(l));
      for (const [what, re] of Object.entries(MUST[l])) {
        expect(re.test(body), `${l} does not state ${what}`).toBe(true);
      }
    });

    it(`${l}: no confirmation to the buyer, no "same channel", nothing instant or automatic — and the checks can fire`, () => {
      const body = text(page(l));
      for (const re of NEVER[l]) {
        expect(re.test(body), `${l} still says ${re}`).toBe(false);
      }
      // NEGATIVE CONTROL: the old page is caught by these same patterns — its
      // "same channel" promise above all — so a pass here is not a pattern
      // that could never fire.
      expect(NEVER[l].map(String)).toContain(String(SAME_CHANNEL[l]));
      expect(SAME_CHANNEL[l].test(OLD[l]), `${l}: the same-channel check does not fire on the old copy`).toBe(true);
      expect(NEVER[l].filter((re) => re.test(OLD[l])).length, `${l}: nothing fires on the old copy`).toBeGreaterThanOrEqual(1);
      // …and did NOT state what the new one must: the positives discriminate too.
      for (const what of ['businessRecords', 'keptDoNotContact', 'keptRecord'] as const) {
        expect(MUST[l][what]!.test(OLD[l]), `${l}: the old copy already satisfied ${what}`).toBe(false);
      }
    });
  }

  it('the patterns for instant or automatic deletion fire on the sentences they exist for', () => {
    // Synthetic controls for the promises the old copy happened not to make.
    expect(NEVER.en.some((re) => re.test('Your data is deleted immediately.'))).toBe(true);
    expect(NEVER.en.some((re) => re.test('You receive a confirmation when it is done.'))).toBe(true);
    expect(NEVER.en.some((re) => re.test('Removal is automatic.'))).toBe(true);
    expect(NEVER.en.some((re) => re.test('We will tell you when it is done.'))).toBe(true);
    expect(NEVER.zh.some((re) => re.test('你的数据会立即删除。'))).toBe(true);
    expect(NEVER.zh.some((re) => re.test('完成后我们会通知你。'))).toBe(true);
    expect(NEVER.ar.some((re) => re.test('تُحذف بياناتك فورًا.'))).toBe(true);
    expect(NEVER.ar.some((re) => re.test('يتم الحذف بشكل تلقائي.'))).toBe(true);
  });

  it('every step and every item is on the page, in order: how, what is deleted, what is kept', () => {
    for (const l of LOCALES) {
      const html = page(l);
      const w = (key: string) => esc(t(l, key as MessageKey));
      // Each looked for as the element it must be — a heading, a list item —
      // because a short heading ("What is kept") also occurs inside the intro.
      const h2 = (key: string) => `<h2>${w(key)}</h2>`;
      const li = (key: string) => `<li>${w(key)}</li>`;
      const order = [
        h2('legal.deletion.how.title'), `<li>${w('legal.deletion.step1')}<br>${w('legal.deletion.viaUs')}</li>`,
        li('legal.deletion.step2'), li('legal.deletion.step3'), li('legal.deletion.step4'),
        h2('legal.deletion.erased.title'), li('legal.deletion.erased.identity'), li('legal.deletion.erased.messages'),
        li('legal.deletion.erased.prepared'), li('legal.deletion.erased.notes'), li('legal.deletion.erased.conversations'),
        h2('legal.deletion.kept.title'), li('legal.deletion.kept.orders'), li('legal.deletion.kept.doNotContact'),
        li('legal.deletion.kept.record'), li('legal.deletion.kept.meta'), li('legal.deletion.kept.elsewhere'),
        li('legal.deletion.kept.backups'),
      ];
      const positions = order.map((needle) => html.indexOf(needle));
      for (const [i, p] of positions.entries()) expect(p, `${l} is missing ${order[i]}`).toBeGreaterThan(-1);
      expect(positions, `${l}: out of order`).toEqual([...positions].sort((a, b) => a - b));
    }
  });

  it('"write to us" is offered only where there is an address to write to', () => {
    for (const l of LOCALES) {
      expect(page(l, 'privacy@nomi.test')).toContain(esc(t(l, 'legal.deletion.viaUs')));
      expect(page(l, 'privacy@nomi.test')).toContain('mailto:privacy@nomi.test');
      expect(page(l, null)).not.toContain(esc(t(l, 'legal.deletion.viaUs')));
    }
  });

  it('the old keys are gone, and neither public page makes the old promise anywhere', () => {
    for (const l of LOCALES) {
      expect(Object.keys(messages[l])).not.toContain('legal.deletion.revoked');
      for (const [k, v] of Object.entries(messages[l])) {
        if (!k.startsWith('legal.deletion.') && !k.startsWith('legal.privacy.')) continue;
        for (const re of NEVER[l]) expect(re.test(v), `${l}/${k} says ${re}`).toBe(false);
      }
    }
  });

  it('the privacy page no longer ties keeping to "as long as the business uses Nomi", and points to the deletion page', () => {
    const facts = { processor: DEFAULT_PROCESSOR, hosting: HOSTING };
    expect(messages.en['legal.privacy.howLong.body']).not.toMatch(/as long as the business uses Nomi/i);
    expect(messages.en['legal.privacy.howLong.body']).toMatch(/Until the business asks for its records to be deleted, or you ask for yours/);
    expect(messages.en['legal.privacy.choices.body']).toMatch(/as the deletion page describes/);
    for (const l of LOCALES) {
      expect(withoutIsolates(renderPrivacy(l, null, facts))).toContain('href="/data-deletion"');
      expect(withoutIsolates(renderPrivacy(l, null, facts))).toContain(esc(t(l, 'legal.privacy.howLong.body')));
    }
  });
});

describe('CC-02a · one number, three places', () => {
  it('the page, the code and the migration agree on 30 days and a 7-day warning', () => {
    expect(DELETION_DAYS).toBe(30);
    for (const l of LOCALES) {
      expect(messages[l]['legal.deletion.step3'], l).toContain(String(DELETION_DAYS));
      expect(messages[l]['conv.deletion.lead'], l).toContain(String(DELETION_DAYS));
      expect(messages[l]['data.buyers.lead'], l).toContain(String(DELETION_DAYS));
      expect(messages[l]['notify.deletion_due'], l).toContain('7');
    }
    const m = read('migrations/0073_buyer_deletion_requests.sql');
    expect(m).toContain(`r.asked_at + interval '${DELETION_DAYS} days' <= now() + interval '7 days'`);
    expect(m).toMatch(/security definer set search_path = public/);
    expect(m).toContain('revoke all on function deletion_requests_due() from public;');
    expect(m).toContain('grant execute on function deletion_requests_due() to nomi_app;');
    // It answers three things, never the buyer or the note.
    expect(m).toMatch(/returns table \(business_name text, scope text, asked_at timestamptz\)/);
    expect(m).toMatch(/on deletion_requests \(client_id\) where scope = 'buyer' and state = 'open'/);
  });

  it('the due date is the asked date plus 30 days; late is after it, not on it', () => {
    const asked = new Date('2026-09-01T10:00:00Z');
    expect(deletionDueBy(asked).toISOString()).toBe('2026-10-01T10:00:00.000Z');
    expect(deletionOverdue(asked, new Date('2026-10-01T10:00:00Z'))).toBe(false);
    expect(deletionOverdue(asked, new Date('2026-10-01T10:00:01Z'))).toBe(true);
  });
});

describe('CC-02a · the operator is told, by e-mail, once a day', () => {
  it('it is an operator alert, with a subject and words in every language', () => {
    expect([...OPERATOR_ALERT_KINDS]).toContain('deletion_due');
    for (const l of LOCALES) {
      expect(messages[l]['notify.deletion_due.subject'].length, l).toBeGreaterThan(0);
    }
  });

  it('names each request — whose, what, asked and due — marks the late ones, and cuts a long list', () => {
    const asked = new Date('2026-09-01T10:00:00Z');
    const lines = Array.from({ length: 12 }, (_, i) => ({
      business: `Shop ${i + 1}`, scope: i === 0 ? 'workspace' as const : 'buyer' as const, askedAt: asked, overdue: i === 1,
    }));
    for (const l of LOCALES) {
      const s = withoutIsolates(renderOwnerAlert(l, 'deletion_due', null, { deletionsDue: lines }));
      expect(s.split('\n')[0], l).toBe(t(l, 'notify.deletion_due', { n: 12 }));
      expect(s, l).toContain(t(l, 'notify.deletion_due.soon', {
        business: 'Shop 1', what: t(l, 'data.deletion.scope.workspace'),
        asked: formatDate(l, asked), due: formatDate(l, deletionDueBy(asked)),
      }));
      expect(s, l).toContain(t(l, 'notify.deletion_due.late', {
        business: 'Shop 2', what: t(l, 'data.deletion.scope.buyer'),
        asked: formatDate(l, asked), due: formatDate(l, deletionDueBy(asked)),
      }));
      expect(s, l).toContain('Shop 10');
      expect(s, l).not.toContain('Shop 11');
      expect(s, l).toContain(t(l, 'notify.deletion_due.more', { n: 2 }));
      expect(s.endsWith(t(l, 'notify.deletion_due.how')), l).toBe(true);
    }
  });

  it('carries no technical vocabulary, and no pronoun for anyone', () => {
    const keys = (Object.keys(messages.en) as MessageKey[]).filter((k) => k.startsWith('notify.deletion_due'));
    expect(keys.length).toBe(6);
    for (const l of LOCALES) {
      for (const key of keys) {
        const s = messages[l][key].toLowerCase();
        for (const w of ['server', 'database', 'cron', 'job', 'railway', 'bucket', 'api', 'sql', 'uuid']) {
          expect(new RegExp(`\\b${w}\\b`).test(s), `${l}/${key}: ${w}`).toBe(false);
        }
        expect(s).not.toMatch(/\b(she|her|he|his|him)\b/);
      }
    }
  });

  it('is scheduled daily on its own queue, and sent at most once a day', () => {
    expect(QUEUES.deletions).toBe('ops.deletions');
    const main = read('src/main.ts');
    expect(main).toMatch(/boss\.schedule\(QUEUES\.deletions, '0 7 \* \* \*'/);
    expect(main).toMatch(/deletionDueAlert\(db, job\.data\.businessId, new Date\(\)\)/);
    expect(main).toMatch(/singletonKey: 'deletion_due', singletonSeconds: 24 \* 3600/);
  });
});

describe('CC-02a · the buyer\'s page and Your data', () => {
  const NOW = new Date('2026-09-27T02:30:00Z');
  const asked = new Date('2026-09-20T02:00:00Z');
  const file: CustomerFile = {
    conversationId: 'c1', buyer: 'Ahmed', country: 'AE', channel: 'whatsapp',
    status: { t: 'talking' }, statusTone: 'ok', needsOwner: false,
    profile: { firstContact: null, products: [], quoteCount: 0, orderCount: 0 },
    timeline: [],
    context: { products: [], latestQuote: null, order: null, corrections: [] },
  };
  const STAFF = { isOwner: false };

  it('never asked: the owner gets the form — what goes, what stays, a required note; staff get whose decision it is', () => {
    for (const l of LOCALES) {
      const owner = withoutIsolates(renderCustomerFile(file, l, NOW, null, OWNER_VIEW));
      expect(owner, l).toContain('action="/app/conversations/c1/deletion"');
      expect(owner, l).toContain(esc(t(l, 'conv.deletion.erased')));
      expect(owner, l).toContain(esc(t(l, 'conv.deletion.kept')));
      expect(owner, l).toContain(esc(t(l, 'conv.deletion.tell')));
      expect(owner, l).toMatch(new RegExp(`name="note" rows="2" required maxlength="${BUYER_NOTE_MAX}"`));
      const staff = withoutIsolates(renderCustomerFile(file, l, NOW, null, STAFF));
      expect(staff, l).not.toContain('/deletion"');
      expect(staff, l).toContain(esc(t(l, 'staff.ownerDecides')));
      expect(staff, l).toContain(esc(t(l, 'conv.deletion.title')));
    }
  });

  it('open: everyone sees when it was asked and the date it must be done by; no second form', () => {
    const open = { ...file, deletion: { state: 'open' as const, askedAt: asked, closedAt: null, closedNote: null } };
    for (const l of LOCALES) {
      const line = esc(t(l, 'conv.deletion.open', { asked: formatDate(l, asked), due: formatDate(l, deletionDueBy(asked)) }));
      for (const viewer of [OWNER_VIEW, STAFF]) {
        const html = withoutIsolates(renderCustomerFile(open, l, NOW, null, viewer));
        expect(html, l).toContain(line);
        expect(html, l).not.toContain('action="/app/conversations/c1/deletion"');
      }
      // The way back is the owner's, on Your data.
      expect(withoutIsolates(renderCustomerFile(open, l, NOW, null, OWNER_VIEW))).toContain('href="/app/settings/data"');
      expect(withoutIsolates(renderCustomerFile(open, l, NOW, null, STAFF))).not.toContain('href="/app/settings/data"');
    }
  });

  it('done: the date it was done, and nothing to press', () => {
    const done = new Date('2026-09-25T09:00:00Z');
    const f = { ...file, deletion: { state: 'done' as const, askedAt: asked, closedAt: done, closedNote: null } };
    const html = withoutIsolates(renderCustomerFile(f, 'en', NOW));
    expect(html).toContain(esc(t('en', 'conv.deletion.done', { date: formatDate('en', done) })));
    expect(html).not.toContain('<form method="post" action="/app/conversations/c1/deletion"');
  });

  it('not carried out: says so with the operator\'s reason, and may be asked again', () => {
    const f = { ...file, deletion: { state: 'refused' as const, askedAt: asked, closedAt: NOW, closedNote: 'Could not be matched to anyone who wrote' } };
    const html = withoutIsolates(renderCustomerFile(f, 'en', NOW));
    expect(html).toContain(esc(t('en', 'conv.deletion.refused', { date: formatDate('en', asked) })));
    expect(html).toContain('Could not be matched to anyone who wrote');
    expect(html).toContain('action="/app/conversations/c1/deletion"');
  });

  it('a note is required, collapsed and bounded — and never cut silently', () => {
    expect(buyerDeletionNote('   ')).toEqual({ ok: false, reason: 'missing' });
    expect(buyerDeletionNote('  On WhatsApp,\n\n 27 Sep ')).toEqual({ ok: true, value: 'On WhatsApp, 27 Sep' });
    expect(buyerDeletionNote('x'.repeat(BUYER_NOTE_MAX))).toEqual({ ok: true, value: 'x'.repeat(BUYER_NOTE_MAX) });
    expect(buyerDeletionNote('x'.repeat(BUYER_NOTE_MAX + 1))).toEqual({ ok: false, reason: 'long' });
  });

  it('Your data lists each buyer\'s request: due date while open, a way back, the done date after', () => {
    const base = { scope: 'buyer' as const, askedBy: 'p1', askedAt: asked, closedNote: null, conversationId: 'c1' };
    const buyers: BuyerDeletionRequest[] = [
      { ...base, id: 'r-open', buyer: 'Ahmed <b>', subjectNote: 'On WhatsApp, 20 Sep', state: 'open', closedAt: null },
      { ...base, id: 'r-done', buyer: null, subjectNote: 'By e-mail', state: 'done', closedAt: NOW },
    ];
    for (const l of LOCALES) {
      const html = withoutIsolates(renderDataRights({ businessName: 'Atlas', requests: [], buyers }, l, null, OWNER_VIEW, 'x'));
      expect(html, l).toContain(esc(t(l, 'data.buyers.title')));
      expect(html, l).toContain(esc(t(l, 'data.buyers.due', { asked: formatDate(l, asked), due: formatDate(l, deletionDueBy(asked)) })));
      expect(html, l).toContain(esc(t(l, 'data.buyers.done', { asked: formatDate(l, asked), done: formatDate(l, NOW) })));
      expect(html, l).toContain('name="id" value="r-open"');
      expect(html, `${l}: a done request offered back`).not.toContain('name="id" value="r-done"');
      expect(html, l).toContain('Ahmed &lt;b&gt;');
      expect(html, l).toContain(esc(t(l, 'common.buyer')));
    }
    const none = withoutIsolates(renderDataRights({ businessName: 'Atlas', requests: [], buyers: [] }, 'en', null, OWNER_VIEW, 'x'));
    expect(none).toContain(t('en', 'data.buyers.none'));
  });

  it('the owner is told the buyer is not written to — the owner tells them', () => {
    expect(messages.en['conv.deletion.tell']).toMatch(/Tell the buyer then — Nomi does not write to them about it/);
    expect(messages.en['data.buyers.lead']).toMatch(/Nomi does not write to them about it/);
    for (const l of LOCALES) {
      for (const k of ['conv.deletion.tell', 'data.buyers.lead', 'conv.deletion.lead', 'conv.deletion.flash.asked'] as const) {
        for (const re of NEVER[l]) expect(re.test(messages[l][k]), `${l}/${k} says ${re}`).toBe(false);
      }
    }
  });
});

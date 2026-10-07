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
  // UI-es: Spanish never had the old page; this is that page as it would have read, for the negative controls.
  es: 'Borrar tus datos Puedes pedir que se borre todo lo que un negocio guardó sobre ti a través de Nomi. '
    + 'Pídelo. Desde la cuenta de Instagram, Facebook o WhatsApp desde la que escribiste, envía al negocio un mensaje diciendo que quieres que se borren tus datos. '
    + 'Una persona del negocio recibe la solicitud y borra tus registros a mano. Se hace en un plazo de 30 días, y te avisamos por el mismo canal cuando esté hecho. '
    + 'Lo que se conserva: lo que el negocio debe guardar por ley, como la factura de un pedido; y las copias que guarda la propia Meta.',
  // Phase 9: French never had the old page either; this is that page as it would have read, for the negative controls.
  fr: 'Supprimer vos données Vous pouvez faire supprimer tout ce qu’une entreprise a gardé sur vous via Nomi. '
    + 'Demandez-le. Depuis le compte Instagram, Facebook ou WhatsApp d’où vous avez écrit, envoyez à l’entreprise un message disant que vous voulez faire supprimer vos données. '
    + 'Une personne de l’entreprise reçoit la demande et efface vos données à la main. C’est fait sous 30 jours, et nous vous prévenons sur le même canal une fois terminé. '
    + 'Ce qui reste : ce que l’entreprise doit garder selon la loi, comme la facture d’une commande ; et les copies gardées par Meta.',
};

/**
 * What the page must state, per language (0126): the business deletes, at
 * once, for good; there is no form, and why; a closed workspace is erased;
 * what goes and what stays — the contract `erase_customer` carries out, named
 * by the words that carry it — and the owner's backup sentence, unchanged.
 */
const MUST: Record<Locale, Record<string, RegExp>> = {
  en: {
    businessDeletes: /The business sees your request in Nomi and deletes your data there/,
    gone: /It is deleted at once: gone, not hidden/,
    notWritten: /Nomi does not write to you about it/,
    noForm: /There is no form on this page, on purpose/,
    closedWorkspace: /If the business closes its Nomi workspace, everything in it is erased, your data included/,
    erasedIdentity: /Who you are on every channel/,
    // w4-public-02 — the photo 0123 keeps, which erase-buyer erases.
    erasedPhoto: /Your profile photo, as Instagram or Messenger showed it to the business/,
    erasedMessages: /Every message between you and the business/,
    // The positioning rewrite: "quotes" became "price offers" — still the rows erase-buyer erases.
    erasedPrepared: /Replies prepared for you, and any price offers or sample requests/,
    // Phase 9 (V1-070) — "signals" was the product's word; the same records, in the reader's.
    erasedNotes: /Notes and markers about your conversations/,
    erasedConversations: /except what is needed to keep an order/,
    keptOrders: /Orders you placed[^.]*without your contact details or your messages/,
    keptDoNotContact: /never written to again/,
    keptRecord: /A record that you asked, and when it was done\. It holds nothing that was deleted/,
    // public-missed-21 — the owner's sentence, word for word; and a restore brings nobody back (0126).
    keptBackups: /A backup is not changed to remove one person; your data leaves it when that backup is deleted/,
    keptRestored: /restored from a backup, every deletion made since that backup is carried out again/,
    keptMeta: /copies Meta itself holds/,
  },
  zh: {
    businessDeletes: /商家在 Nomi 里看到你的要求，并在那里删除你的数据/,
    gone: /删除立即生效：数据被真正删掉，而不是隐藏起来/,
    notWritten: /Nomi 不会就此另外联系你/,
    noForm: /这一页上故意没有表单/,
    closedWorkspace: /如果商家关闭自己的 Nomi 工作台，其中的一切都会被清除，包括你的数据/,
    erasedIdentity: /你在各个渠道上的身份/,
    erasedPhoto: /你在 Instagram 或 Messenger 上的头像/,
    erasedMessages: /往来的每一条消息/,
    erasedPrepared: /为你准备的回复，以及任何给你的价格或样品申请/,
    erasedNotes: /备注和标记/,
    erasedConversations: /为保留你下过的订单所必需的部分除外/,
    keptOrders: /你下过的订单[^。]*不再关联你的联系方式和消息/,
    keptDoNotContact: /不会再向这个地址发送/,
    keptRecord: /你提出过删除要求，以及何时完成。其中不含任何被删除的内容/,
    keptBackups: /备份不会为删除某一个人而修改；你的数据会随该备份被删除而消失/,
    keptRestored: /该备份之后做过的每一次删除，都会在服务运行之前重新执行/,
    keptMeta: /Meta 自己保存的副本/,
  },
  ar: {
    businessDeletes: /ترى الشركة الطلب في Nomi وتحذف بياناتك من هناك/,
    gone: /تزول البيانات فعلًا، ولا تُخفى فحسب/,
    notWritten: /لا يراسلك Nomi بهذا الشأن/,
    noForm: /لا توجد استمارة في هذه الصفحة/,
    closedWorkspace: /إن أغلقت الشركة مساحة عملها في Nomi، يُمحى كل ما فيها/,
    erasedIdentity: /هويتك على كل قناة/,
    erasedPhoto: /صورة ملفك الشخصي كما ظهرت للشركة/,
    erasedMessages: /كل رسالة متبادلة بينك وبين الشركة/,
    erasedPrepared: /الردود المُعدّة لك، وأي عروض أسعار أو طلبات عيّنات/,
    erasedNotes: /الملاحظات والعلامات/,
    erasedConversations: /إلا ما يلزم للاحتفاظ بطلب شراء/,
    keptOrders: /طلبات الشراء المقدَّمة منك[^.]*دون بيانات التواصل معك ودون رسائلك/,
    keptDoNotContact: /عدم المراسلة/,
    keptRecord: /سجلّ بتقديم الطلب وتاريخ تنفيذه، لا يحوي شيئًا مما حُذف/,
    keptBackups: /لا تُعدَّل النسخة الاحتياطية لإزالة شخص واحد؛ وتزول بياناتك منها بحذف تلك النسخة/,
    keptRestored: /يُعاد تنفيذ كل حذف جرى بعد تلك النسخة/,
    keptMeta: /النسخ التي تحتفظ بها Meta نفسها/,
  },
  es: {
    businessDeletes: /El negocio ve tu solicitud en Nomi y borra allí tus datos/,
    gone: /se eliminan de verdad, no se ocultan/,
    notWritten: /Nomi no te escribe por esto/,
    noForm: /Esta página no tiene formulario, a propósito/,
    closedWorkspace: /Si el negocio cierra su espacio de trabajo en Nomi, se borra todo lo que contiene, también tus datos/,
    erasedIdentity: /Quién eres en cada canal/,
    erasedPhoto: /Tu foto de perfil, tal como Instagram o Messenger/,
    erasedMessages: /Todos los mensajes entre tú y el negocio/,
    erasedPrepared: /Las respuestas preparadas para ti, y cualquier oferta de precio o solicitud de muestra/,
    erasedNotes: /notas y marcas/,
    erasedConversations: /salvo lo necesario para conservar un pedido/,
    keptOrders: /Los pedidos que hiciste[^.]*sin tus datos de contacto ni tus mensajes/,
    keptDoNotContact: /nunca se le vuelva a escribir/,
    keptRecord: /Un registro de que lo pediste y de cuándo se hizo, sin nada de lo borrado/,
    keptBackups: /Una copia de seguridad no se cambia para quitar a una persona; tus datos desaparecen cuando se borra esa copia de seguridad/,
    keptRestored: /cada borrado hecho después de esa copia se vuelve a hacer/,
    keptMeta: /copias que guarda la propia Meta/,
  },
  fr: {
    businessDeletes: /L’entreprise voit votre demande dans Nomi et y supprime vos données/,
    gone: /les données sont réellement effacées, pas seulement masquées/,
    notWritten: /Nomi ne vous écrit pas à ce sujet/,
    noForm: /Cette page n’a pas de formulaire, et c’est voulu/,
    closedWorkspace: /Si l’entreprise ferme son espace Nomi, tout son contenu est effacé, vos données comprises/,
    erasedIdentity: /Qui vous êtes sur chaque canal/,
    erasedPhoto: /Votre photo de profil, telle qu’Instagram ou Messenger/,
    erasedMessages: /Tous les messages échangés entre vous et l’entreprise/,
    erasedPrepared: /Les réponses préparées pour vous, ainsi que les devis et les demandes d’échantillons/,
    erasedNotes: /notes et repères/,
    erasedConversations: /sauf ce qui est nécessaire pour conserver une commande/,
    keptOrders: /Les commandes que vous avez passées[^.]*sans vos coordonnées ni vos messages/,
    keptDoNotContact: /plus rien n’y soit jamais envoyé/,
    keptRecord: /Une trace de votre demande et de la date[^.]*qui ne contient rien de ce qui a été supprimé/,
    keptBackups: /Une sauvegarde n’est pas modifiée pour en retirer une seule personne ; vos données en disparaissent quand cette sauvegarde est supprimée/,
    keptRestored: /chaque suppression faite depuis cette sauvegarde est refaite/,
    keptMeta: /copies que Meta conserve/,
  },
};

/**
 * What the page must never say again: a confirmation sent to the customer,
 * "the same channel", anything automatic — and, since 0126, the operator
 * working by hand within 30 days, which is no longer what happens. (Deleting
 * IS at once now, when the business acts: the page says so, so "at once" is
 * no longer on this list. Nothing is automatic: the business acts.)
 */
const NEVER: Record<Locale, readonly RegExp[]> = {
  en: [/same channel/i, /we will (tell|notify|confirm|let you know)/i, /you (are|will be|get) (told|notified)/i,
       /(receive|get|are sent) a confirmation/i, /confirm(ed|ation)? (to you|on the)/i, /automatic/i,
       /by hand/i, /within 30 days/i],
  zh: [/同一个渠道/, /同一渠道/, /会(通知|告诉)你/, /给你确认/, /自动/, /手动/, /30 天内/],
  ar: [/القناة نفسها/, /نفس القناة/, /يصل إشعار/, /سنبلغك|سنخبرك|سنعلمك/, /تلقائي/, /يدويًا|يدويا/, /خلال 30 يومًا/],
  es: [/mismo canal/i, /te (avisamos|avisaremos|confirmaremos|notificaremos|diremos)/i, /recibir[áa]s una confirmaci[óo]n/i,
       /autom[áa]tic/i, /a mano/i, /30 días/i],
  fr: [/même canal/i, /nous vous (informerons|confirmerons|préviendrons|prévenons|dirons)/i, /vous recevrez une confirmation/i,
       /automatique/i, /à la main/i, /30 jours/i],
};

/** The one promise the old page made in every language: a confirmation on "the same channel". */
const SAME_CHANNEL: Record<Locale, RegExp> = { en: /same channel/i, zh: /同一个渠道/, ar: /القناة نفسها/, es: /mismo canal/i, fr: /même canal/i };

describe('CC-02a · /data-deletion states the contract, in every language', () => {
  for (const l of LOCALES) {
    it(`${l}: the business deletes it, at once and for good; no form, and why; a closed workspace; what goes and what stays`, () => {
      const body = text(page(l));
      for (const [what, re] of Object.entries(MUST[l])) {
        expect(re.test(body), `${l} does not state ${what}`).toBe(true);
      }
    });

    it(`${l}: no confirmation to the customer, no "same channel", nothing automatic, no operator by hand — and the checks can fire`, () => {
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
      for (const what of ['businessDeletes', 'keptDoNotContact', 'keptRecord', 'noForm'] as const) {
        expect(MUST[l][what]!.test(OLD[l]), `${l}: the old copy already satisfied ${what}`).toBe(false);
      }
    });
  }

  it('the patterns for automatic deletion, a confirmation and the operator by hand fire on the sentences they exist for', () => {
    // Synthetic controls for the promises the old copy happened not to make.
    expect(NEVER.en.some((re) => re.test('You receive a confirmation when it is done.'))).toBe(true);
    expect(NEVER.en.some((re) => re.test('Removal is automatic.'))).toBe(true);
    expect(NEVER.en.some((re) => re.test('We will tell you when it is done.'))).toBe(true);
    expect(NEVER.zh.some((re) => re.test('完成后我们会通知你。'))).toBe(true);
    expect(NEVER.ar.some((re) => re.test('يتم الحذف بشكل تلقائي.'))).toBe(true);
    // 0126 — the page CC-02a wrote: an operator, by hand, within 30 days. Not what happens now.
    expect(NEVER.en.some((re) => re.test('Nomi’s operator carries out the deletion by hand, within 30 days of the business recording the request.'))).toBe(true);
    expect(NEVER.zh.some((re) => re.test('Nomi 的运营方在商家记录要求后的 30 天内，由人手动执行删除。'))).toBe(true);
    expect(NEVER.ar.some((re) => re.test('ينفّذ مشغّل Nomi الحذفَ يدويًا خلال 30 يومًا من تسجيل الشركة للطلب.'))).toBe(true);
    expect(NEVER.es.some((re) => re.test('Quien opera Nomi hace el borrado a mano, en un plazo de 30 días.'))).toBe(true);
    expect(NEVER.fr.some((re) => re.test('L’exploitant de Nomi effectue la suppression à la main, dans les 30 jours.'))).toBe(true);
  });

  it('every step and every item is on the page, in order: how, what is deleted, what is kept', () => {
    for (const l of LOCALES) {
      const html = page(l);
      const w = (key: string) => esc(t(l, key as MessageKey));
      // Each looked for as the element it must be — a heading, a list item —
      // because a short heading ("What is kept") also occurs inside the intro.
      const h2 = (key: string) => `<h2>${w(key)}</h2>`;
      const li = (key: string) => `<li>${w(key)}</li>`;
      // Phase 9 (V1-071) — step 1 is one route; writing to us is its own sentence after the steps.
      const order = [
        h2('legal.deletion.how.title'), li('legal.deletion.step1'),
        li('legal.deletion.step2'), li('legal.deletion.step3'), `<p>${w('legal.deletion.viaUs')}</p>`,
        // 0126 — why there is no form, and what closing a workspace does.
        `<p>${w('legal.deletion.noForm')}</p>`, `<p>${w('legal.deletion.closed')}</p>`,
        h2('legal.deletion.erased.title'), li('legal.deletion.erased.identity'), li('legal.deletion.erased.photo'),
        li('legal.deletion.erased.messages'),
        li('legal.deletion.erased.prepared'), li('legal.deletion.erased.notes'), li('legal.deletion.erased.conversations'),
        h2('legal.deletion.kept.title'), li('legal.deletion.kept.orders'), li('legal.deletion.kept.doNotContact'),
        li('legal.deletion.kept.record'), li('legal.deletion.kept.meta'), li('legal.deletion.kept.elsewhere'),
        li('legal.deletion.kept.backups'), li('legal.deletion.kept.restored'),
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
        // The advisor's history (2026-10-07) — a provider's own retention, as its terms state it
        // (`legal.privacy.provider.openai`: "…for up to 30 days to monitor abuse"), is not a promise
        // about when a deletion happens: the bare "30 days" patterns pass it by, every other one holds.
        const providerLine = k.startsWith('legal.privacy.provider.');
        for (const re of NEVER[l]) {
          if (providerLine && re.source.includes('30')) continue;
          expect(re.test(v), `${l}/${k} says ${re}`).toBe(false);
        }
      }
    }
  });

  it('the privacy page says how long, as the owner decided (0126): while the business uses Nomi, until you ask or it closes — and points to the deletion page', () => {
    const facts = { processor: DEFAULT_PROCESSOR, hosting: HOSTING };
    // The retention model is not "delete after 90 days": kept while the workspace is active,
    // deleted when the customer asks, or when the workspace closes.
    expect(messages.en['legal.privacy.howLong.body']).toMatch(/^For as long as the business uses Nomi/);
    expect(messages.en['legal.privacy.howLong.body']).toMatch(/deleted when you ask the business to delete yours, or when the business closes its workspace, which erases everything in it/);
    for (const l of LOCALES) expect(messages[l]['legal.privacy.howLong.body'], l).not.toMatch(/90/);
    // Phase 9 (public-missed-15) — the deletion page by its own name, and a link wherever it is named.
    expect(messages.en['legal.privacy.choices.body']).toMatch(/as the page “\{deletion\}” describes/);
    for (const l of LOCALES) {
      const html = withoutIsolates(renderPrivacy(l, null, facts));
      const link = `<a href="/data-deletion">${esc(t(l, 'legal.deletion.title'))}</a>`;
      for (const key of ['legal.privacy.howLong.body', 'legal.privacy.choices.body'] as const) {
        expect(html, `${l} ${key}`).toContain(esc(t(l, key, { deletion: '\u0000' })).replace('\u0000', link));
      }
      expect(html.split(link).length - 1, l).toBe(3);
    }
  });
});

describe('CC-02a · the operator\'s safety net: a request still open', () => {
  it('the code and the migration agree on 30 days and a 7-day warning; no page promises a delay any more (0126)', () => {
    expect(DELETION_DAYS).toBe(30);
    for (const l of LOCALES) {
      // The owner deletes at once: no public or owner sentence counts days to a deletion.
      for (const k of ['legal.deletion.step2', 'legal.deletion.step3', 'conv.deletion.lead', 'data.buyers.lead'] as const) {
        expect(messages[l][k], `${l} ${k}`).not.toContain(String(DELETION_DAYS));
      }
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
        asked: formatDate(l, asked, 'Asia/Shanghai'), due: formatDate(l, deletionDueBy(asked), 'Asia/Shanghai'),
      }));
      expect(s, l).toContain(t(l, 'notify.deletion_due.late', {
        business: 'Shop 2', what: t(l, 'data.deletion.scope.buyer'),
        asked: formatDate(l, asked, 'Asia/Shanghai'), due: formatDate(l, deletionDueBy(asked), 'Asia/Shanghai'),
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

  // 0126 — the owner's one act: "Delete this customer's data now". It asks first (data-confirm), and with
  // no script the form arrives with asked=0 and the route answers with a page that asks.
  const ERASE = 'action="/app/conversations/c1/deletion/erase"';

  it('never asked: the owner deletes — what goes, what stays, a required note, asked first; staff get whose decision it is', () => {
    for (const l of LOCALES) {
      const owner = withoutIsolates(renderCustomerFile(file, l, NOW, null, OWNER_VIEW));
      expect(owner, l).toContain(ERASE);
      expect(owner, l).toContain('<input type="hidden" name="asked" value="0" />');
      expect(owner, l).toContain(`onclick="return confirm(this.dataset.confirm)"\n            data-confirm="${esc(t(l, 'conv.deletion.eraseConfirm'))}">${esc(t(l, 'conv.deletion.erase'))}</button>`);
      expect(owner, l).toContain(esc(t(l, 'conv.deletion.erased')));
      expect(owner, l).toContain(esc(t(l, 'conv.deletion.kept')));
      expect(owner, l).toContain(esc(t(l, 'conv.deletion.tell')));
      expect(owner, l).toMatch(new RegExp(`name="note" rows="2" required maxlength="${BUYER_NOTE_MAX}"`));
      const staff = withoutIsolates(renderCustomerFile(file, l, NOW, null, STAFF));
      expect(staff, l).not.toContain('/deletion/erase"');
      expect(staff, l).toContain(esc(t(l, 'staff.ownerDecides')));
      expect(staff, l).toContain(esc(t(l, 'conv.deletion.title')));
    }
  });

  it('open (recorded before deleting was one act): when it was asked, and the owner deletes it now — no note asked again', () => {
    const open = { ...file, deletion: { state: 'open' as const, askedAt: asked, closedAt: null, closedNote: null } };
    for (const l of LOCALES) {
      const line = esc(t(l, 'conv.deletion.open', { asked: formatDate(l, asked, 'Asia/Shanghai') }));
      const owner = withoutIsolates(renderCustomerFile(open, l, NOW, null, OWNER_VIEW));
      expect(owner, l).toContain(line);
      expect(owner, l).toContain(ERASE);
      expect(owner, l).not.toContain('name="note"');
      // The way back is the owner's, on Your data.
      expect(owner, l).toContain('href="/app/settings/data#buyers"');
      const staff = withoutIsolates(renderCustomerFile(open, l, NOW, null, STAFF));
      expect(staff, l).toContain(line);
      expect(staff, l).not.toContain(ERASE);
      expect(staff, l).not.toContain('href="/app/settings/data');
    }
  });

  it('done: the date it was done, and nothing to press', () => {
    const done = new Date('2026-09-25T09:00:00Z');
    const f = { ...file, deletion: { state: 'done' as const, askedAt: asked, closedAt: done, closedNote: null } };
    const html = withoutIsolates(renderCustomerFile(f, 'en', NOW));
    expect(html).toContain(esc(t('en', 'conv.deletion.done', { date: formatDate('en', done, 'Asia/Shanghai') })));
    expect(html).not.toContain(ERASE);
  });

  it('not carried out: says so with the operator\'s reason, and may be asked again', () => {
    const f = { ...file, deletion: { state: 'refused' as const, askedAt: asked, closedAt: NOW, closedNote: 'Could not be matched to anyone who wrote' } };
    const html = withoutIsolates(renderCustomerFile(f, 'en', NOW));
    expect(html).toContain(esc(t('en', 'conv.deletion.refused', { date: formatDate('en', asked, 'Asia/Shanghai') })));
    expect(html).toContain('Could not be matched to anyone who wrote');
    expect(html).toContain(ERASE);
  });

  it('a note is required, collapsed and bounded — and never cut silently', () => {
    expect(buyerDeletionNote('   ')).toEqual({ ok: false, reason: 'missing' });
    expect(buyerDeletionNote('  On WhatsApp,\n\n 27 Sep ')).toEqual({ ok: true, value: 'On WhatsApp, 27 Sep' });
    expect(buyerDeletionNote('x'.repeat(BUYER_NOTE_MAX))).toEqual({ ok: true, value: 'x'.repeat(BUYER_NOTE_MAX) });
    expect(buyerDeletionNote('x'.repeat(BUYER_NOTE_MAX + 1))).toEqual({ ok: false, reason: 'long' });
  });

  it('Your data lists each customer\'s request: open ones deleted from here or taken back; done ones say when, and what stayed', () => {
    const base = { scope: 'buyer' as const, askedBy: 'p1', askedAt: asked, closedNote: null, conversationId: 'c1' };
    const buyers: BuyerDeletionRequest[] = [
      { ...base, id: 'r-open', buyer: 'Ahmed <b>', subjectNote: 'On WhatsApp, 20 Sep', state: 'open', closedAt: null },
      { ...base, id: 'r-done', buyer: null, subjectNote: 'By e-mail', state: 'done', closedAt: NOW },
    ];
    for (const l of LOCALES) {
      const html = withoutIsolates(renderDataRights({ businessName: 'Atlas', requests: [], buyers }, l, null, OWNER_VIEW, 'x'));
      expect(html, l).toContain(esc(t(l, 'data.buyers.title')));
      expect(html, l).toContain(esc(t(l, 'data.buyers.open', { asked: formatDate(l, asked, 'Asia/Shanghai') })));
      expect(html, l).toContain(esc(t(l, 'data.buyers.done', { asked: formatDate(l, asked, 'Asia/Shanghai'), done: formatDate(l, NOW, 'Asia/Shanghai') })));
      expect(html, l).toContain(esc(t(l, 'data.buyers.kept')));
      expect(html, l).toContain('name="id" value="r-open"');
      // The one act, from here too, back to here after.
      expect(html, l).toMatch(/action="\/app\/conversations\/c1\/deletion\/erase" class="inline">\s*<input type="hidden" name="asked" value="0" \/>\s*<input type="hidden" name="from" value="data" \/>/);
      expect(html, `${l}: a done request offered back`).not.toContain('name="id" value="r-done"');
      expect(html, l).toContain('Ahmed &lt;b&gt;');
      expect(html, l).toContain(esc(t(l, 'common.buyer')));
      // Staff see the list, and nothing to press.
      const staff = withoutIsolates(renderDataRights({ businessName: 'Atlas', requests: [], buyers }, l, null, { isOwner: false }, 'x'));
      expect(staff, l).not.toContain('/deletion/erase');
    }
    const none = withoutIsolates(renderDataRights({ businessName: 'Atlas', requests: [], buyers: [] }, 'en', null, OWNER_VIEW, 'x'));
    expect(none).toContain(t('en', 'data.buyers.none'));
  });

  it('the owner is told the customer is not written to — the owner tells them, if they wish', () => {
    expect(messages.en['conv.deletion.tell']).toMatch(/Nomi does not write to the customer about it\. Tell them it is done, if you wish/);
    expect(messages.en['data.buyers.lead']).toMatch(/Nomi does not write to them about it/);
    for (const l of LOCALES) {
      for (const k of ['conv.deletion.tell', 'data.buyers.lead', 'conv.deletion.lead', 'data.flash.erased', 'data.flash.erasedRecord'] as const) {
        for (const re of NEVER[l]) expect(re.test(messages[l][k]), `${l}/${k} says ${re}`).toBe(false);
      }
    }
  });
});

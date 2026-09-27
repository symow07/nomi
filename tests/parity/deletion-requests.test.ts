import { describe, it, expect } from 'vitest';
import { asksForDeletion, promisesDeletion } from '../../src/core/safety/deletion.js';

/**
 * A buyer who asks for their data to be deleted is answered by a person; a
 * buyer who merely mentions deleting something is answered as usual
 * (src/core/safety/deletion.ts, decided by the owner 2026-09-27).
 *
 * The NOT lists are the point of this file: the owner asked for them to be
 * reported. Each is a real way a buyer uses a deletion word without asking for
 * their data to go — a line, a logo, an item, an order, a photo sent by
 * mistake, an address typed wrong — and each must reach the assistant as a
 * normal message. The traps the patterns were narrowed for are marked.
 */

const REQUESTS: Record<string, readonly string[]> = {
  en: [
    'Please delete my data.',
    'Can you delete all of my personal information?',
    'I want my data deleted',
    "I'd like my details to be removed from your records.",
    'Remove my number from your list please',
    'Please erase everything you have on me',
    'Delete my account',
    'Remove me from your database',
    'I am exercising my right to be forgotten',
    'Under GDPR, please delete my information.',
    'wipe all my messages',
    'Please remove my contact details',
    'Forget everything you know about me',
    'Could you delete the data you have about me?',
    'DELETE MY DATA',
    'delete my number.',
  ],
  zh: [
    '请删除我的数据',
    '删掉我所有的资料',
    '把我的信息删了',
    '我的个人信息请删除',
    '请清除我的聊天记录',
    '麻烦把我的电话号码删掉',
    '我要求行使被遗忘权',
    '你们保存的我的资料都删了吧',
    '删除我的账号',
  ],
  ar: [
    'أرجو حذف بياناتي',
    'احذفوا كل معلوماتي',
    'امسح رقمي من فضلك',
    'أريد إزالة بياناتي الشخصية',
    'من فضلك احذف حسابي',
    'أطالب بالحق في النسيان',
    'بياناتي أرجو أن تحذف',
    'امسحوا جميع رسائلي',
    'أرجو حَذْف بياناتي',   // with diacritics
  ],
  fr: ['Merci de supprimer mes données personnelles', "J'invoque mon droit à l'oubli"],
  es: ['Por favor borren mis datos', 'Quiero que mis datos sean eliminados'],
  pt: ['Por favor apaguem os meus dados'],
  de: ['Bitte löschen Sie meine Daten'],
  ru: ['Удалите мои данные, пожалуйста'],
  tr: ['Lütfen kişisel verilerimi silin', 'LÜTFEN KİŞİSEL VERİLERİMİ SİLİN'],
};

/** Passing mentions: a deletion word, and nothing about the buyer's own data. */
const NOT_REQUESTS: Record<string, readonly string[]> = {
  en: [
    'delete that line from the quote',                          // the owner's own example
    'Please remove the logo from the bag',
    'Can you delete item 3?',
    'Erase the old price and send the new one',
    'Remove the handles and add a zip',
    'Delete my previous order and make a new one',              // an order is not their data
    'I deleted the photo by mistake, sending it again',
    'Please delete the last message I sent, wrong photo',       // a correction, not erasure
    'My details are in the email — remove the logo please',     // trap: "remove" near "my details"
    'I emailed my details and removed the logo',                // trap: "my details … removed"
    "Don't forget me when the new colours arrive",              // trap: "forget me"
    'Is your company GDPR compliant? Also please delete the duplicate line.', // trap: GDPR + delete, two clauses
    'Remove my name from the bag print',
    'Can you remove my account manager from the cc?',           // trap: "my account" + manager
    'Remove my email from the cc and add my colleague',         // trap: "my email" from a cc list
    'Delete the watermark from the mockup',
    'Remove the number 3 from the quote',
    'Please take the old address off the invoice',
    'What happens to my data if I order?',
    'Your privacy page says you delete data after 30 days?',
    'Can you remove the extra spaces in my details?',
    'Thanks, you can delete the draft',
  ],
  zh: [
    '把报价里那一行删掉',                  // "delete that line from the quote"
    '删除logo',
    '把第三项删了',
    '删掉旧的价格，发新的',
    '我的订单删了吧，重新下一个',          // an order, not their data
    '照片发错了，删了吧',
    '把把手去掉，加拉链',
    '我的邮箱写错了，删掉重发',            // trap: "my e-mail" … "delete", across a comma
    '我的电话写错了，删掉重写',            // same trap, "my phone"
    '别忘了我，新颜色到了告诉我',          // "don't forget me"
    '我的名字不要印在包上，删掉',
    '你们的隐私政策说会删除数据吗？',
    '把我的号码加到群里',
  ],
  ar: [
    'احذف السطر من عرض السعر',                 // "delete the line from the quote"
    'امسح الشعار من الحقيبة',                  // "remove the logo from the bag"
    'احذف البند الثالث',
    'احذف الطلب القديم وأرسل واحدا جديدا',     // an order
    'أزل المقابض وأضف سحابا',
    'لا تنسني عندما تصل الألوان الجديدة',       // "don't forget me"
    'احذف رسالتي الأخيرة، أرسلت الصورة الخطأ',   // a correction, one message
    'رقمي هو 0551234567، احذف السطر الأخير',    // trap: "my number" near "delete"
    'هل تحذفون البيانات بعد الطلب؟',            // a question about practice
    'أرسل رقمي إلى المندوب',
  ],
};

const PROMISES: readonly string[] = [
  "Done! I've deleted your data.",
  'We will delete your personal information within 30 days.',
  'Your data has been removed.',
  'I can remove your number from our list right away.',
  'All the data we hold about you has been deleted.',
  '已为您删除所有数据。',
  '我们会删除您的个人信息。',
  '您的资料已删除。',
  '我已经帮您把数据删除了',
  'تم حذف بياناتك.',
  'سنحذف جميع معلوماتك',
  'سيتم حذف حسابك',
  'Nous allons supprimer vos données.',
  'Hemos eliminado sus datos.',
  'Wir werden Ihre Daten löschen.',
  'Мы удалили ваши данные.',
  'Verilerinizi sildik.',
];

const NOT_PROMISES: readonly string[] = [
  "I'll remove the number 3 from the quote.",
  "I've removed the logo from the mockup.",
  'A colleague will reply to you shortly.',
  "I've passed your request to the team.",
  'Sure — I deleted the duplicate line.',
  'Your order has been updated.',
  '已删除报价里的那一行。',
  '我帮您把logo去掉了。',
  'تم حذف السطر من عرض السعر.',
  'سنزيل الشعار.',
];

describe('layer 1 — a buyer asking for their data to be deleted', () => {
  for (const [lang, list] of Object.entries(REQUESTS)) {
    for (const text of list) {
      it(`${lang}: hands off — ${JSON.stringify(text)}`, () => {
        expect(asksForDeletion(text), text).not.toBeNull();
      });
    }
  }
});

describe('layer 1 — a passing mention does NOT hand off', () => {
  for (const [lang, list] of Object.entries(NOT_REQUESTS)) {
    for (const text of list) {
      it(`${lang}: answered as usual — ${JSON.stringify(text)}`, () => {
        expect(asksForDeletion(text), `${text} → matched ${asksForDeletion(text)}`).toBeNull();
      });
    }
  }
});

describe('layer 2 — a reply that promises a deletion is caught', () => {
  for (const reply of PROMISES) {
    it(`caught — ${JSON.stringify(reply)}`, () => {
      expect(promisesDeletion(reply), reply).not.toBeNull();
    });
  }
  for (const reply of NOT_PROMISES) {
    it(`passes — ${JSON.stringify(reply)}`, () => {
      expect(promisesDeletion(reply), `${reply} → matched ${promisesDeletion(reply)}`).toBeNull();
    });
  }
});

describe('the corpus covers what the owner asked for', () => {
  it('each of the owner\'s three languages has requests and passing mentions', () => {
    for (const lang of ['en', 'zh', 'ar']) {
      expect(REQUESTS[lang]!.length, lang).toBeGreaterThanOrEqual(8);
      expect(NOT_REQUESTS[lang]!.length, lang).toBeGreaterThanOrEqual(8);
    }
  });
});

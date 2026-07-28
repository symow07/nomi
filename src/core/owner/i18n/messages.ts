import { type Locale, DEFAULT_LOCALE } from './locale.js';

/**
 * ADR-0008 — The owner-surface message catalog. English is the SOURCE OF TRUTH:
 * `MessageKey = keyof typeof EN`, and zh/ar are typed `Record<MessageKey,string>`
 * so a missing or extra key fails the type-check (the completeness test is the
 * runtime backstop). Owner language only — no technical vocabulary in any locale.
 * Interpolation is `{name}` / `{buyer}` only. Keys grow per phase (P1: layout,
 * login, home).
 */

const EN = {
  // nav
  'nav.home': 'Home',
  'nav.inbox': 'Inbox',
  'nav.conversations': 'Conversations',
  'nav.channels': 'Channels',
  'nav.products': 'Products',
  'nav.employee': 'Employee',
  'nav.analytics': 'Business',
  // shell
  'app.tagline': "{name}'s workspace",
  'header.stage': "Probation · you're mentoring her",
  'header.logout': 'Log out',
  'switcher.aria': 'Language',
  // login
  'login.title': 'Log in',
  'login.brandTagline': "Your digital employee's workspace",
  'login.passwordLabel': 'Access code',
  'login.submit': 'Enter workspace',
  'login.error': 'Wrong code, please try again.',
  'login.footer': 'Owner only · your employee still works in WhatsApp',
  // home
  'home.summaryFor': "{name}'s summary today",
  'home.stat.inquiries': 'Inquiries',
  'home.stat.replied': 'Replied',
  'home.stat.waiting': 'Awaiting you',
  'home.stat.closed': 'Deals',
  'home.pending.title': 'Needs you',
  'home.pending.product': 'Product',
  'home.pending.qty': 'Qty',
  'home.pending.price': 'Quote',
  'home.pending.qtyUnit': 'pcs',
  'home.pending.view': 'View',
  'home.allNormal.title': 'All good — nothing to do',
  'home.allNormal.body': '{name} is handling customers. Nothing needs your attention.',
  'home.status.title': "{name}'s status",
  'home.status.learning': 'Learning',
  'home.status.night': 'Night shift',
  'home.status.promoted': 'Promoted',
  'home.week.handled': 'Handled this week',
  'home.week.handledUnit': 'inquiries',
  'home.week.edits': 'You corrected',
  'home.week.editsUnit': 'times',
  'home.week.learning': 'Learning',
  'home.week.updated': 'Updated',
  'home.week.noChange': 'No change',
  'home.events.title': "What's new",
  'home.event.quoteSent': 'Quote sent · {buyer}',
  'home.event.buyerImage': 'Buyer sent a photo · {buyer}',
  'home.event.waiting': 'Customer waiting · {buyer}',
  'common.buyer': 'Buyer',
  'greeting.morning': 'Good morning',
  'greeting.afternoon': 'Good afternoon',
  'greeting.evening': 'Good evening',
  // countries
  'country.AE': 'UAE',
  'country.SA': 'Saudi Arabia',
  'country.RU': 'Russia',
  'country.EG': 'Egypt',
  'country.MA': 'Morocco',
  'country.NG': 'Nigeria',
  'country.CN': 'China',
  'country.US': 'USA',
  'country.TR': 'Turkey',
  'country.IN': 'India',
};

export type MessageKey = keyof typeof EN;

const ZH: Record<MessageKey, string> = {
  'nav.home': '主页',
  'nav.inbox': '收件箱',
  'nav.conversations': '对话记录',
  'nav.channels': '销售渠道',
  'nav.products': '产品目录',
  'nav.employee': '员工档案',
  'nav.analytics': '经营数据',
  'app.tagline': '{name}的工作台',
  'header.stage': '试用期 · 你在带她',
  'header.logout': '退出',
  'switcher.aria': '语言',
  'login.title': '登录',
  'login.brandTagline': '你的数字员工工作台',
  'login.passwordLabel': '进入密码',
  'login.submit': '进入工作台',
  'login.error': '密码不对，再试一次。',
  'login.footer': '仅限老板本人 · 员工的接待仍在 WhatsApp',
  'home.summaryFor': '{name}的今日总结',
  'home.stat.inquiries': '询盘',
  'home.stat.replied': '已回复',
  'home.stat.waiting': '等你审批',
  'home.stat.closed': '成交',
  'home.pending.title': '等你处理',
  'home.pending.product': '产品',
  'home.pending.qty': '数量',
  'home.pending.price': '报价',
  'home.pending.qtyUnit': '个',
  'home.pending.view': '查看',
  'home.allNormal.title': '一切正常，不用管',
  'home.allNormal.body': '没有需要你处理的事，{name}在正常接待。',
  'home.status.title': '{name}工作状态',
  'home.status.learning': '学习中',
  'home.status.night': '夜班中',
  'home.status.promoted': '已晋升',
  'home.week.handled': '本周已处理',
  'home.week.handledUnit': '个询盘',
  'home.week.edits': '你修改过',
  'home.week.editsUnit': '次',
  'home.week.learning': '学习',
  'home.week.updated': '已更新',
  'home.week.noChange': '无变化',
  'home.events.title': '重要动态',
  'home.event.quoteSent': '报价已发送 · {buyer}',
  'home.event.buyerImage': '买家发来产品图 · {buyer}',
  'home.event.waiting': '客户在等回复 · {buyer}',
  'common.buyer': '买家',
  'greeting.morning': '早上好',
  'greeting.afternoon': '下午好',
  'greeting.evening': '晚上好',
  'country.AE': '阿联酋',
  'country.SA': '沙特',
  'country.RU': '俄罗斯',
  'country.EG': '埃及',
  'country.MA': '摩洛哥',
  'country.NG': '尼日利亚',
  'country.CN': '中国',
  'country.US': '美国',
  'country.TR': '土耳其',
  'country.IN': '印度',
};

const AR: Record<MessageKey, string> = {
  'nav.home': 'الرئيسية',
  'nav.inbox': 'الوارد',
  'nav.conversations': 'المحادثات',
  'nav.channels': 'القنوات',
  'nav.products': 'المنتجات',
  'nav.employee': 'الموظفة',
  'nav.analytics': 'الأداء',
  'app.tagline': 'مساحة عمل {name}',
  'header.stage': 'فترة تجربة · أنت تدرّبها',
  'header.logout': 'تسجيل الخروج',
  'switcher.aria': 'اللغة',
  'login.title': 'تسجيل الدخول',
  'login.brandTagline': 'مساحة عمل موظفتك الرقمية',
  'login.passwordLabel': 'رمز الدخول',
  'login.submit': 'دخول',
  'login.error': 'رمز غير صحيح، حاول مجددًا.',
  'login.footer': 'للمالك فقط · موظفتك تعمل عبر واتساب',
  'home.summaryFor': 'ملخص {name} اليوم',
  'home.stat.inquiries': 'استفسارات',
  'home.stat.replied': 'تم الرد',
  'home.stat.waiting': 'بانتظارك',
  'home.stat.closed': 'صفقات',
  'home.pending.title': 'تحتاج إليك',
  'home.pending.product': 'المنتج',
  'home.pending.qty': 'الكمية',
  'home.pending.price': 'السعر',
  'home.pending.qtyUnit': 'قطعة',
  'home.pending.view': 'عرض',
  'home.allNormal.title': 'كل شيء على ما يرام',
  'home.allNormal.body': 'لا شيء يحتاج انتباهك، {name} تستقبل العملاء.',
  'home.status.title': 'حالة {name}',
  'home.status.learning': 'تتعلّم',
  'home.status.night': 'مناوبة ليلية',
  'home.status.promoted': 'تمت ترقيتها',
  'home.week.handled': 'أنجزت هذا الأسبوع',
  'home.week.handledUnit': 'استفسار',
  'home.week.edits': 'صحّحت لها',
  'home.week.editsUnit': 'مرة',
  'home.week.learning': 'التعلّم',
  'home.week.updated': 'مُحدّث',
  'home.week.noChange': 'دون تغيير',
  'home.events.title': 'المستجدّات',
  'home.event.quoteSent': 'تم إرسال عرض السعر · {buyer}',
  'home.event.buyerImage': 'أرسل العميل صورة · {buyer}',
  'home.event.waiting': 'العميل بانتظار الرد · {buyer}',
  'common.buyer': 'عميل',
  'greeting.morning': 'صباح الخير',
  'greeting.afternoon': 'نهارك سعيد',
  'greeting.evening': 'مساء الخير',
  'country.AE': 'الإمارات',
  'country.SA': 'السعودية',
  'country.RU': 'روسيا',
  'country.EG': 'مصر',
  'country.MA': 'المغرب',
  'country.NG': 'نيجيريا',
  'country.CN': 'الصين',
  'country.US': 'أمريكا',
  'country.TR': 'تركيا',
  'country.IN': 'الهند',
};

export const messages: Record<Locale, Record<MessageKey, string>> = { en: EN, zh: ZH, ar: AR };

/** Employee identity — a product constant per locale (not env/DB-configurable). */
export const EMPLOYEE_NAME: Record<Locale, string> = { en: 'Lily', zh: '小雅', ar: 'ياسمين' };

/** Translate. Falls back to English, then the raw key. `{param}` interpolation. */
export function t(locale: Locale, key: MessageKey, params?: Record<string, string | number>): string {
  const table = messages[locale] ?? messages[DEFAULT_LOCALE];
  let s = table[key] ?? messages[DEFAULT_LOCALE][key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** Owner-facing name for a country code, localized; the raw code if unknown. */
export function countryName(locale: Locale, code: string | null): string | null {
  if (!code) return null;
  const key = `country.${code}` as MessageKey;
  return key in messages[DEFAULT_LOCALE] ? t(locale, key) : null;
}

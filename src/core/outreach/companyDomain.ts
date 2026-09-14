/**
 * C5 · M41 — which company an address belongs to, if any.
 *
 * A company lookup is keyed by domain and COSTS HER A CREDIT. Looking up
 * `gmail.com` would spend one to learn that Google exists, and then show the
 * owner that her buyer in Dubai "works at Google, 180,000 staff" — a confident
 * wrong answer on the one screen meant to tell her who is real. So a personal
 * mailbox has no company here, and the page says there is nothing to look up
 * rather than offering a button that would buy that sentence.
 *
 * The list is the providers her buyers actually use — the global ones, and the
 * Chinese, Gulf and Russian ones a Yiwu factory hears from. A missing entry
 * costs one wasted credit and a wrong line she can see; it cannot send anything.
 *
 * Pure per ADR-0002.
 */

const PERSONAL = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com', 'ymail.com', 'rocketmail.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com',
  'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.net', 'gmx.de', 'mail.com', 'zoho.com',
  'yandex.com', 'yandex.ru', 'mail.ru', 'bk.ru', 'inbox.ru', 'list.ru', 'rambler.ru',
  'qq.com', 'foxmail.com', '163.com', '126.com', 'yeah.net', 'sina.com', 'sina.cn', 'sohu.com',
  '139.com', 'aliyun.com', 'naver.com', 'daum.net', 'web.de', 't-online.de', 'libero.it',
  'orange.fr', 'free.fr', 'laposte.net', 'rediffmail.com', 'yahoo.co.in', 'yahoo.co.uk',
  'yahoo.co.jp', 'hotmail.co.uk', 'outlook.sa', 'windowslive.com',
]);

/** The domain of an address, lower-cased, or null when it is not an address. */
export function domainOfAddress(address: string): string | null {
  const at = address.lastIndexOf('@');
  if (at <= 0) return null;
  const domain = address.slice(at + 1).trim().toLowerCase();
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) ? domain : null;
}

/**
 * The company domain behind an address — null for a personal mailbox, which
 * has none to look up.
 */
export function companyDomainOf(address: string): string | null {
  const domain = domainOfAddress(address);
  if (!domain) return null;
  if (PERSONAL.has(domain)) return null;
  // Regional variants of the big personal providers: yahoo.com.sg, hotmail.fr.
  if (/^(yahoo|hotmail|outlook|live|gmx|yandex)\.[a-z.]+$/.test(domain)) return null;
  return domain;
}

/**
 * How long a company lookup stays good. A company's size and country change
 * slowly; a second credit for the same domain within this window buys nothing.
 */
export const ENRICHMENT_REUSE_DAYS = 90;

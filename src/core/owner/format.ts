import { type Money, currencySymbol } from '../types/money.js';
/**
 * M1 — Chinese business formatting. ￥, 万, GMT+8. Pure; clock injected.
 */

const TZ = 'Asia/Shanghai';

/** ￥1,234.50 — RMB always with the sign the owner writes on paper. */
export const formatRmb = (n: number): string =>
  `￥${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Trade money, grouped normally. M43a — the symbol comes from the currency. */
export const formatMoney = (m: Money): string =>
  `${currencySymbol(m.currency)}${m.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Summary money: whole units — minor units are noise on a phone digest line. */
export const formatMoneyCompact = (m: Money): string =>
  `${currencySymbol(m.currency)}${Math.round(m.amount).toLocaleString('en-US')}`;

/**
 * Quantities the way a Yiwu owner says them: ≥10,000 in 万.
 * 5000 → "5000" · 12000 → "1.2万" · 200000 → "20万"
 */
export function formatQtyZh(n: number): string {
  if (n >= 10_000) {
    const wan = n / 10_000;
    const s = Number.isInteger(wan) ? String(wan) : wan.toFixed(1).replace(/\.0$/, '');
    return `${s}万`;
  }
  return String(n);
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

const partsIn = (d: Date) => {
  const p = new Intl.DateTimeFormat('zh-CN', {
    timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return { month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), weekday: get('weekday') };
};

/** 7月17日 周四 */
export function formatDateZh(d: Date): string {
  const p = partsIn(d);
  const wd = p.weekday || WEEKDAYS[new Date(d).getDay()] || '';
  return `${p.month}月${p.day}日 ${wd}`;
}

/** 09:15 （北京时间, implied — the owner has exactly one timezone） */
export function formatTimeZh(d: Date): string {
  const p = partsIn(d);
  return `${p.hour}:${p.minute}`;
}

/** 昨晚23:40 / 今天09:15 — relative day words the way people actually talk. */
export function formatWhenZh(d: Date, now: Date): string {
  const day = (x: Date) =>
    new Intl.DateTimeFormat('zh-CN', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric' }).format(x);
  const t = formatTimeZh(d);
  if (day(d) === day(now)) return `今天${t}`;
  const yesterday = new Date(now.getTime() - 24 * 3600 * 1000);
  if (day(d) === day(yesterday)) {
    const hour = Number(partsIn(d).hour);
    return `${hour >= 18 || hour < 6 ? '昨晚' : '昨天'}${t}`;
  }
  return `${formatDateZh(d)} ${t}`;
}

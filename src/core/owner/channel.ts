import { MARK } from './tokens.js';
import { box, joinLines, joinSections, labeled } from './components.js';
import { formatWhenZh } from './format.js';
import { TERM } from './vocabulary.js';
import type { ChannelHealth, OwnerProblem } from '../channel/health.js';
import { CHANNEL_STATUS_ZH } from '../channel/health.js';

/**
 * M3 — 对话渠道: everything the owner sees about the WhatsApp connection.
 * Composed from the M2 kit; problem states use the three-part structure.
 * No provider vocabulary, no codes — ever.
 */

export type ChannelCardInput = {
  readonly health: ChannelHealth;
  readonly displayPhone: string | null;      // e.g. +86 138****1234 (pre-masked)
  readonly lastMessageAt: Date | null;       // last successful message either way
  readonly lastCheckAt: Date | null;
  readonly now: Date;
};

const yesNo = (ok: boolean): string => (ok ? `${MARK.ok} 正常` : `${MARK.warn} 暂时不行`);

export function renderChannelCard(c: ChannelCardInput): string {
  const h = c.health;
  const card = box('对话渠道', [
    labeled('WhatsApp', c.displayPhone ?? '还没连接'),
    labeled('状态', CHANNEL_STATUS_ZH[h.status]),
    c.lastMessageAt ? labeled('最近消息', formatWhenZh(c.lastMessageAt, c.now)) : null,
    c.lastCheckAt ? labeled('上次检查', formatWhenZh(c.lastCheckAt, c.now)) : null,
    labeled('收消息', yesNo(h.inboundOk)),
    labeled('发消息', yesNo(h.outboundOk)),
  ]);
  return joinSections([card, h.problem ? renderOwnerProblem(h.problem) : null]);
}

/** The three-part problem block, one line each. */
export function renderOwnerProblem(p: OwnerProblem): string {
  return joinLines([p.whatHappened, p.beingDone, p.whatYouDo]);
}

/** ── 测试连接 result, owner version ─────────────────────────────────────── */

export type TestVerdict = 'all_good' | 'inbound_only' | 'outbound_only' | 'reconnect';

export const TEST_RESULT_ZH: Record<TestVerdict, string> = {
  all_good: '连接正常，可以开始接待客户',
  inbound_only: '可以收到消息，但暂时无法发送',
  outbound_only: '可以发送消息，但还没有收到客户消息',
  reconnect: '连接需要重新确认',
};

export function renderTestResult(verdict: TestVerdict, employeeName: string): string {
  const head = `${verdict === 'all_good' ? MARK.ok : MARK.warn} ${TEST_RESULT_ZH[verdict]}`;
  const tail =
    verdict === 'all_good' ? `${employeeName}随时可以上岗。`
    : verdict === 'outbound_only' ? '让一个客户发条消息试试，收到就全通了。'
    : verdict === 'inbound_only' ? '正在自动修复发送，好了会告诉你。'
    : '点「重新连接」，两分钟搞定。';
  return joinLines([head, tail]);
}

/** ── 权限: what this connection can and cannot do (trust copy) ──────────── */

export function renderPermissions(employeeName: string): string {
  return joinLines([
    '这个连接能做什么：',
    `${MARK.ok} 收${TERM.buyer}发来的消息`,
    `${MARK.ok} 用你的号码回复${TERM.buyer}`,
    `${MARK.ok} 看消息有没有送到`,
    '不能做什么：',
    `✗ 看你手机里的其他聊天`,
    `✗ 不经${TERM.approval}动你的价格`,
    `随时可以断开，${employeeName}马上停。`,
  ]);
}

/** ── Connect wizard copy: three steps, validated as you type ────────────── */

export const CONNECT_STEPS = [
  {
    id: 'phone',
    title: '第一步 · 你的 WhatsApp 号码',
    prompt: '输入接待客户用的 WhatsApp 号码',
    help: '就是买家平时加的那个号',
  },
  {
    id: 'code',
    title: '第二步 · 粘贴连接码',
    prompt: '把我们发给你的连接码粘贴到这里',
    help: '连接码在我们发你的开通短信里，复制整段即可',
  },
  {
    id: 'verify',
    title: '第三步 · 确认连接',
    prompt: '正在确认，一般不到一分钟',
    help: '确认好会自动发一条测试消息',
  },
] as const;

/** Owner-facing field validation — instant, specific, no jargon. */
export function validatePhoneZh(raw: string): { ok: true; value: string } | { ok: false; errorZh: string } {
  const cleaned = raw.replace(/[\s\-()]/g, '');
  if (cleaned === '') return { ok: false, errorZh: '请输入号码' };
  if (!/^\+?\d{8,15}$/.test(cleaned)) {
    return { ok: false, errorZh: '号码看起来不对——只要数字，带不带 + 都行' };
  }
  return { ok: true, value: cleaned };
}

export function validateConnectCodeZh(raw: string): { ok: true; value: string } | { ok: false; errorZh: string } {
  const t = raw.trim();
  if (t === '') return { ok: false, errorZh: '请粘贴连接码' };
  if (/\s/.test(t)) return { ok: false, errorZh: '连接码中间不能有空格——请完整复制' };
  if (t.length < 10) return { ok: false, errorZh: '连接码太短了——请完整复制整段' };
  if (/[^\x21-\x7e]/.test(t)) return { ok: false, errorZh: '连接码里混进了别的字符——请重新复制' };
  return { ok: true, value: t };
}

/** ── Coming-soon channels: real demand research, no fake integrations ───── */

export const COMING_SOON_CHANNELS_ZH: readonly string[] = [
  'Instagram', 'Messenger', '微信', '小红书', 'Telegram', 'LINE', '邮件', '网站聊天',
];

export function renderComingSoon(): string {
  return joinLines([
    '即将支持的渠道：',
    COMING_SOON_CHANNELS_ZH.slice(0, 4).join('、'),
    COMING_SOON_CHANNELS_ZH.slice(4).join('、'),
    '想先用哪个？回复告诉我们。',
  ]);
}

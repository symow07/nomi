import { TERM } from './vocabulary.js';
import { MARK } from './tokens.js';
import { joinLines, joinSections, numberedList } from './components.js';
import { SUCCESS } from './states.js';
import { YIWU_DEFAULTS, EMPLOYEE_AVATARS, type OnboardStep } from '../onboard/flow.js';
import type { ValidatedImport } from '../onboard/catalogImport.js';

/**
 * M6 — Onboarding copy: hiring, not configuring. Five steps, each one
 * message, defaults confirmed rather than forms filled. Ten minutes to the
 * first approved draft.
 */

export const ONBOARD_STEP_COPY: Record<Exclude<OnboardStep, 'done'>, {
  readonly title: string;
  readonly prompt: string;
}> = {
  name_employee: {
    title: '第一步 · 给你的员工起个名字',
    prompt: `以后她就用这个名字接待买家。\n挑个头像：${EMPLOYEE_AVATARS.slice(0, 4).join(' ')}`,
  },
  business_basics: {
    title: '第二步 · 确认几个默认设置',
    prompt: `义乌外贸的常规：人民币记账、美元报价、\n${YIWU_DEFAULTS.incoterms.join('/')} 宁波、北京时间。\n对的话回「对」，要改直接说。`,
  },
  catalog_import: {
    title: '第三步 · 让她认识你的产品',
    prompt: '把价格表发过来就行——\nExcel、截图、照片、转发的消息都可以。\n乱一点没关系，整理好会先给你确认。',
  },
  connect_whatsapp: {
    title: '第四步 · 接上你的 WhatsApp',
    prompt: '三步连好，两分钟。连好后买家的消息她就能看到了。',
  },
  first_conversation: {
    title: '第五步 · 看她接待第一个买家',
    prompt: '我们安排了一条测试询盘。\n她起草，你看一眼，点「发送」——就这么用。',
  },
};

/** The catalog confirm card — extraction is proposed, never silently saved. */
export function renderCatalogConfirm(v: ValidatedImport, employeeName: string): string {
  const items = v.accepted.map((p) => {
    const bits = [
      p.priceUsd !== null ? `$${p.priceUsd}` : '价格待补',
      p.moq !== null ? `${p.moq}起` : null,
    ].filter(Boolean).join('，');
    return `${p.name}（${bits}）`;
  });
  return joinSections([
    `${employeeName}认出了 ${v.accepted.length} 个产品：`,
    joinLines([...numberedList(items, 8)]),
    v.rejected.length
      ? joinLines([
          `${MARK.warn} 有 ${v.rejected.length} 条没认出来：`,
          ...v.rejected.slice(0, 3).map((r) => `· ${r.product.name || '（空行）'}——${r.reasonZh}`),
        ])
      : null,
    '回复「对」入册 ｜ 写编号删掉 ｜ 重发也行',
  ]);
}

/** Minute-10 moment: the first draft went out — name the feeling, once. */
export function renderActivation(employeeName: string, minutes: number): string {
  return joinLines([
    SUCCESS.firstSend(employeeName),
    `从入职到第一条回复，用了 ${minutes} 分钟。`,
    `以后就这样：她起草，你${TERM.approval}。放心交给她练。`,
  ]);
}

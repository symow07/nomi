import { joinLines } from './components.js';

/**
 * M8 — In-product support: 联系我们. One promise, one channel, no ticket
 * numbers. The support group link is configuration (set at deploy);
 * the copy is product.
 */

export function renderContactUs(cfg: { readonly wechatGroupNote: string }): string {
  return joinLines([
    '【联系我们】',
    '遇到问题直接说，人会回你——不是机器转圈。',
    cfg.wechatGroupNote,               // e.g. 微信群：扫开通短信里的二维码进群
    '工作日 9:00–21:00 当天回，其余次日上午回。',
    '数据、账单、发票的问题也在这里问。',
  ]);
}

/** Ten KB articles — titles fixed now, bodies revised with real pilot
 * questions before public launch (docs/kb/). */
export const KB_ARTICLES: readonly { readonly slug: string; readonly titleZh: string }[] = [
  { slug: '01-first-ten-minutes', titleZh: '前10分钟：从注册到第一条回复' },
  { slug: '02-connect-whatsapp', titleZh: '连接 WhatsApp：三步连好' },
  { slug: '03-approve-edit-skip', titleZh: '审批：发送、改、不回，就三个词' },
  { slug: '04-catalog-import', titleZh: '让她认识你的产品：价格表怎么发都行' },
  { slug: '05-night-shift', titleZh: '夜班：睡觉时她怎么接待' },
  { slug: '06-promotion-revoke', titleZh: '晋升和收回：放权你说了算' },
  { slug: '07-mistakes-repair', titleZh: '她出错了怎么办：修复是怎么运作的' },
  { slug: '08-pricing-billing', titleZh: '价格、付款和发票' },
  { slug: '09-data-export', titleZh: '你的数据：导出、删除、带走' },
  { slug: '10-buyer-privacy', titleZh: '买家会知道在跟谁聊吗' },
];

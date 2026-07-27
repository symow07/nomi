import { describe, it, expect } from 'vitest';
import { renderChannels, renderConnectGuide, type ChannelsData } from '../../src/api/web/channels.js';

const comingSoon = ['Instagram', 'Messenger', 'Telegram', '企业微信', '小红书'];

const connected: ChannelsData = {
  whatsapp: {
    kind: 'whatsapp', nameZh: 'WhatsApp', descZh: '接收客户消息并自动回复',
    connected: true, statusZh: '已连接', healthOk: true,
    displayId: '+86 579****0001', lastActivityZh: '今天09:15', problem: null,
  },
  comingSoon,
};

const disconnected: ChannelsData = {
  whatsapp: {
    kind: 'whatsapp', nameZh: 'WhatsApp', descZh: '接收客户消息并自动回复',
    connected: false, statusZh: '未连接', healthOk: false,
    displayId: null, lastActivityZh: null, problem: null,
  },
  comingSoon,
};

const needsAttention: ChannelsData = {
  whatsapp: {
    kind: 'whatsapp', nameZh: 'WhatsApp', descZh: '接收客户消息并自动回复',
    connected: false, statusZh: '需要处理', healthOk: false, displayId: '+86 579****0001',
    lastActivityZh: null,
    problem: { whatHappened: 'WhatsApp 需要重新登录。', beingDone: '小雅暂时收不到新消息。', whatYouDo: '点「重新连接」，两分钟搞定。' },
  },
  comingSoon,
};

describe('M9.4 · channel center (pure)', () => {
  it('connected: shows status, masked number, last activity, health, and manage actions', () => {
    const html = renderChannels(connected, null);
    expect(html).toContain('销售渠道');
    expect(html).toContain('WhatsApp');
    expect(html).toContain('已连接 ✓');
    expect(html).toContain('+86 579****0001');   // MASKED — not a full number/secret
    expect(html).toContain('今天09:15');
    expect(html).toContain('健康');
    expect(html).toContain('action="/app/channels/whatsapp/test"');
    expect(html).toContain('action="/app/channels/whatsapp/disconnect"');
  });

  it('not connected: shows description and a connect entry (no fake credential form)', () => {
    const html = renderChannels(disconnected, null);
    expect(html).toContain('接收客户消息并自动回复');
    expect(html).toContain('href="/app/channels/whatsapp/connect"');
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain('token');
  });

  it('needs attention: three-part problem in owner language, reconnect implied', () => {
    const html = renderChannels(needsAttention, null);
    expect(html).toContain('WhatsApp 需要重新登录');
    expect(html).toContain('小雅暂时收不到新消息');
    expect(html).toContain('点「重新连接」');
  });

  it('coming-soon channels are shown honestly, never as connected', () => {
    const html = renderChannels(connected, null);
    expect(html).toContain('即将支持');
    for (const c of comingSoon) expect(html).toContain(c);
    expect(html).toContain('想先用哪个');
    // Instagram etc. must not appear with a connected marker.
    expect(html).not.toMatch(/Instagram[^<]*已连接/);
  });

  it('flash message renders after an action', () => {
    expect(renderChannels(connected, '已断开。')).toContain('已断开。');
  });

  it('connect guide never asks for secrets or shows technical setup', () => {
    const html = renderConnectGuide();
    expect(html).toContain('连接 WhatsApp');
    expect(html).toContain('WhatsApp 号码');
    expect(html).not.toContain('token');
    expect(html).not.toContain('app secret');
    expect(html).not.toContain('phone number id');
  });
});

describe('M9.4 · security + language', () => {
  const all = renderChannels(connected, null) + renderChannels(needsAttention, null) + renderConnectGuide();

  it('no technical / AI vocabulary or secret-shaped content', () => {
    const lower = all.toLowerCase();
    for (const banned of ['ai', 'llm', 'model', 'api', 'token', 'webhook', 'app secret', 'phone number id',
      'access_token', 'meta', '360dialog', 'database', '模型', '人工智能', 'sk-', 'bearer']) {
      const needle = banned.toLowerCase();
      const hit = /^[a-z_ -]+$/.test(needle) ? new RegExp(`\\b${needle.replace(/[-]/g, '\\-')}\\b`).test(lower) : lower.includes(needle);
      expect(hit, `"${banned}"`).toBe(false);
    }
  });

  it('mobile-first: no tables', () => {
    expect(all).not.toContain('<table');
  });
});
